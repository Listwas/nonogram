import { FullscreenButton } from "./components/FullscreenButton";
import { PortraitGuard, phoneLandscape } from "./PortraitGuard";
import { useEffect, useRef, useState } from "react";
import { Board } from "./components/Board";
import { GameClock } from "./components/GameClock";
import { Brand, Icon } from "./components/Icon";
import { SettingsPanel } from "./components/SettingsPanel";
import { useOffline, OfflineStatus } from "./offline";
import { Dialog } from "./components/Dialog";
import { Tutorial } from "./components/Tutorial";
import {
  SIZES,
  validPuzzle,
  type Difficulty,
  type Puzzle,
  type Rules,
  type Selection,
} from "./core/puzzle";
import { begin, move } from "./core/session";
import {
  addTime,
  emptyStats,
  finalize,
  statKey,
  type Preferences,
  type Profile,
  type ProfileStore,
  type Stats,
} from "./core/profile";
import { AudioEngine } from "./audio";
import { applyAppearance } from "./platform";
import type { GenerateResult } from "./generator.worker";
const TITLES = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  random: "Random",
};
const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
};
const formatDuration = (ms: number) =>
  ms >= 3600000
    ? `${(ms / 3600000).toFixed(1)} h`
    : ms >= 60000
      ? `${Math.floor(ms / 60000)} min`
      : `${Math.floor(ms / 1000)} sec`;
type Modal = "settings" | "tutorial" | "replace" | "stats" | null;
export function App({
  profile: p,
  store,
}: {
  profile: Profile;
  store: ProfileStore;
}) {
  const [boardLayout, setBoardLayout] = useState({ width: 0, gutter: 0 });
  const [, setRevision] = useState(0);
  const render = () => setRevision((v) => v + 1);
  const [ui] = useState(() => ({
    screen: "home" as "home" | "difficulty" | "game",
    paused: false,
    modal: null as Modal,
    busy: false,
    error: "",
    notice: store.notice,
    pending: "random" as Selection,
    statsDifficulty: "all",
    statsRules: "standard" as Rules,
    mistake: null as number | null,
  }));
  const offline = useOffline();
  const audioRef = useRef<AudioEngine | null>(null);
  if (!audioRef.current) audioRef.current = new AudioEngine(p.preferences);
  const audio = audioRef.current;
  const worker = useRef<Worker | null>(null),
    generationDeadline = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    request = useRef(0),
    bank = useRef<Puzzle[]>([]),
    clock = useRef(performance.now()),
    saveClock = useRef(0),
    saveFailed = useRef(false),
    saveRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    saveBackoff = useRef(5000),
    mounted = useRef(true);
  const active = (includeHidden = false) =>
    !phoneLandscape() &&
    ui.screen === "game" &&
    !ui.paused &&
    !ui.modal &&
    !ui.busy &&
    (!document.hidden || includeHidden) &&
    p.active?.status === "playing";
  const collect = (includeHidden = false) => {
    const now = performance.now();
    if (active(includeHidden)) addTime(p, Math.max(0, now - clock.current));
    clock.current = now;
  };
  const persist = () => {
    clearTimeout(saveRetry.current);
    saveClock.current = performance.now();
    void store
      .save(p)
      .then(() => {
        clearTimeout(saveRetry.current);
        saveBackoff.current = 5000;
        if (!mounted.current) return;
        if (saveFailed.current) {
          saveFailed.current = false;
          ui.notice = "";
          render();
        }
      })
      .catch(() => {
        if (!mounted.current) return;
        const firstFailure = !saveFailed.current;
        saveFailed.current = true;
        ui.notice =
          "Progress could not be saved. We’ll keep trying; leave this tab open.";
        if (firstFailure) render();
        if (!document.hidden) {
          saveRetry.current = setTimeout(persist, saveBackoff.current);
          saveBackoff.current = Math.min(60000, saveBackoff.current * 2);
        }
      });
  };
  const tick = () => {
    collect();
    if (performance.now() - saveClock.current >= 5000) persist();
  };
  const navigate = (screen: typeof ui.screen) => {
    collect();
    ui.screen = screen;
    window.scrollTo(0, 0);
    ui.modal = null;
    ui.paused = false;
    clock.current = performance.now();
    persist();
    render();
  };
  const closeModal = () => {
    ui.modal = null;
    clock.current = performance.now();
    render();
  };
  const openModal = (modal: Modal) => {
    collect();
    ui.modal = modal;
    persist();
    render();
  };
  const preference = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    p.preferences = { ...p.preferences, [key]: value };
    audio.setPreferences(p.preferences);
    persist();
    render();
  };

  const stopGeneration = () => {
    clearTimeout(generationDeadline.current);
    generationDeadline.current = undefined;
    worker.current?.terminate();
    worker.current = null;
    request.current++;
  };
  const cancelGeneration = () => {
    stopGeneration();
    ui.busy = false;
    ui.error = "";
    render();
  };
  const acceptPuzzle = (puzzle: Puzzle, selection: Selection) => {
    if (!validPuzzle(puzzle)) {
      ui.error = "This puzzle could not be verified. Please try again.";
      ui.busy = false;
      render();
      return;
    }
    p.active = begin(puzzle, p.preferences.rules, selection);
    p.recent = [...p.recent.filter((id) => id !== puzzle.id), puzzle.id].slice(
      -128,
    );
    ui.busy = false;
    ui.error = "";
    ui.screen = "game";
    window.scrollTo(0, 0);
    ui.paused = false;
    ui.modal = null;
    clock.current = performance.now();
    audio.effect("start");
    persist();
    render();
  };
  const generatePuzzle = (selection: Selection) => {
    collect();
    cancelGeneration();
    ui.pending = selection;
    ui.busy = true;
    ui.modal = null;
    ui.error = "";
    render();
    const difficulty =
      selection === "random"
        ? (["easy", "medium", "hard"] as Difficulty[])[
            Math.floor(Math.random() * 3)
          ]
        : selection;
    const size = SIZES[difficulty],
      id = ++request.current;
    const fallback = () => {
      if (id !== request.current) return;
      stopGeneration();
      const candidates = bank.current.filter(
        (b) => b.size === size && !p.recent.includes(b.id),
      );
      if (candidates.length)
        acceptPuzzle(
          candidates[Math.floor(Math.random() * candidates.length)],
          selection,
        );
      else {
        ui.busy = false;
        ui.error =
          "Could not prepare a fresh puzzle. Your saved game is safe. Try again.";
        render();
      }
    };
    try {
      const w = new Worker(new URL("./generator.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      generationDeadline.current = setTimeout(fallback, 3000);
      w.onmessage = (e: MessageEvent<GenerateResult>) => {
        if (worker.current !== w || id !== request.current || e.data.id !== id)
          return;
        clearTimeout(generationDeadline.current);
        generationDeadline.current = undefined;
        w.terminate();
        worker.current = null;
        if (e.data.type === "result" && e.data.puzzle)
          acceptPuzzle(e.data.puzzle, selection);
        else fallback();
      };
      w.onerror = (event) => {
        event.preventDefault();
        fallback();
      };
      w.postMessage({
        type: "generate",
        id,
        size,
        seed: crypto.randomUUID(),
        exclude: p.recent,
      });
    } catch {
      fallback();
    }
  };
  const requestNew = () => {
    if (p.active?.status === "playing") openModal("replace");
    else navigate("difficulty");
  };
  const discardPrevious = () => {
    collect();
    p.active = null;
    navigate("difficulty");
  };
  const replay = () => {
    collect();
    if (!p.active) return;
    p.active = begin(
      p.active.puzzle,
      p.active.rules,
      p.active.selection,
      p.active.completedBefore,
    );
    window.scrollTo(0, 0);
    ui.paused = false;
    clock.current = performance.now();
    audio.effect("start");
    persist();
    render();
  };
  const playMany = (indices: number[]) => {
    if (!active() || !p.active) return false;
    collect();
    let changed = false,
      safe = true;
    let effect: "mistake" | "lose" | "win" | "clear" | "fill" | "cross" =
      p.active.mode === 1 ? "fill" : "cross";
    for (const index of indices) {
      const result = move(p.active, index, p.active.mode);
      if (result.kind === "ignored") continue;
      changed = true;
      p.active = result.attempt;
      if (result.kind === "mistake") {
        ui.mistake = index;
        effect = p.active.status === "lost" ? "lose" : "mistake";
        safe = false;
        setTimeout(() => {
          ui.mistake = null;
          render();
        }, 300);
        break;
      }
      if (result.cleared) effect = "clear";
      if (p.active.status === "won") {
        effect = "win";
        break;
      }
    }
    if (changed) {
      audio.effect(effect);
      finalize(p);
      persist();
      render();
    }
    return safe;
  };
  const play = (index: number) => playMany([index]);
  const refreshApp = () => {
    collect();
    ui.paused = true;
    render();
    void offline.refresh(() => store.save(p));
  };
  const pause = () => {
    collect();
    ui.paused = true;
    persist();
    void store.flush().catch(() => {});
    render();
  };
  useEffect(() => {
    mounted.current = true;
    const gesture = () => void audio.unlock();
    ["pointerdown", "pointerup", "touchend", "keydown"].forEach((event) =>
      document.addEventListener(event, gesture, { passive: true }),
    );
    const background = () => {
      collect(true);
      if (ui.busy) cancelGeneration();
      if (ui.screen === "game" && p.active?.status === "playing")
        ui.paused = true;
      audio.background(true);
      persist();
      void store.flush().catch(() => {});
      render();
    };
    const visibility = () => {
      if (document.hidden) background();
      else {
        clock.current = performance.now();
        audio.background(false);
        if (saveFailed.current) persist();
        render();
      }
    };
    const pageShow = () => {
      if (!document.hidden) {
        clock.current = performance.now();
        audio.background(false);
        render();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.fullscreenElement) return;
      if (e.key === "Escape") {
        if (ui.modal) closeModal();
        else if (ui.busy) cancelGeneration();
        else if (
          ui.screen === "game" &&
          !ui.paused &&
          p.active?.status === "playing"
        )
          pause();
        else if (ui.screen !== "home") navigate("home");
      }
      if (
        ui.screen === "game" &&
        !ui.modal &&
        !ui.paused &&
        p.active?.status === "playing" &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "x") {
          const mode = e.key.toLowerCase() === "f" ? 1 : 2;
          if (p.active.mode === mode) return;
          p.active.mode = mode;
          persist();
          render();
        }
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", background);
    window.addEventListener("pageshow", pageShow);
    document.addEventListener("keydown", key);
    void fetch("/data/reserves.json")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) bank.current = data.filter(validPuzzle);
      })
      .catch(() => {});

    return () => {
      mounted.current = false;
      clearTimeout(saveRetry.current);
      collect();
      persist();
      stopGeneration();
      audio.dispose();
      ["pointerdown", "pointerup", "touchend", "keydown"].forEach((event) =>
        document.removeEventListener(event, gesture),
      );
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", background);
      window.removeEventListener("pageshow", pageShow);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = p.preferences.reduceMotion
      ? "reduced"
      : "full";
    const update = () => applyAppearance(p.preferences.theme);
    const media = matchMedia("(prefers-color-scheme: dark)");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [p.preferences.theme, p.preferences.reduceMotion]);

  const a = p.active,
    totalCompleted = Object.values(p.stats).reduce(
      (sum, s) => sum + s.completed,
      0,
    );
  const summary = (): Stats => {
    const items = Object.entries(p.stats).filter(
      ([k]) =>
        k.startsWith(ui.statsRules + ":") &&
        (ui.statsDifficulty === "all" || k.endsWith(":" + ui.statsDifficulty)),
    );
    return items.reduce(
      (s, [, v]) => ({
        completed: s.completed + v.completed,
        wins: s.wins + v.wins,
        losses: s.losses + v.losses,
        playtime: s.playtime + v.playtime,
        winTime: s.winTime + v.winTime,
        best:
          v.best === null
            ? s.best
            : s.best === null
              ? v.best
              : Math.min(s.best, v.best),
      }),
      emptyStats(),
    );
  };
  const stats = summary();
  return (
    <main className={"app screen-" + ui.screen}>
      {ui.notice || offline.error ? (
        <div className="notice" role="status">
          {ui.notice || offline.error}
          <button
            className="icon small"
            aria-label="Dismiss notice"
            onClick={() => {
              ui.notice = "";
              offline.dismissError();
              render();
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
      {ui.screen === "home" ? (
        <>
          <div className="home-middle">
            <div className="home-group">
              <header className="home-header">
                <Brand />
                <div className="header-actions">
                  <FullscreenButton />
                  <button
                    className="icon"
                    aria-label="Settings"
                    onClick={() => openModal("settings")}
                  >
                    <Icon name="settings" />
                  </button>
                </div>
              </header>
              <section className="home-intro">
                <span className="eyebrow">A quiet logic game</span>
                <h1>Nonogram</h1>
                <p>A picture hidden in the numbers.</p>
                <small>
                  {totalCompleted} {totalCompleted === 1 ? "puzzle" : "puzzles"}{" "}
                  completed
                </small>
              </section>
              <section className="home-actions">
                {a?.status === "playing" ? (
                  <button
                    className="primary full resume-card"
                    onClick={() => navigate("game")}
                  >
                    <span className="resume-title">Continue puzzle</span>
                    <span className="resume-detail">
                      {TITLES[a.puzzle.difficulty]} · {a.puzzle.size} ×{" "}
                      {a.puzzle.size} · {formatTime(a.elapsed)}
                    </span>
                  </button>
                ) : null}
                <button
                  className={
                    (a?.status === "playing" ? "secondary" : "primary") +
                    " full"
                  }
                  onClick={requestNew}
                >
                  New game
                </button>
              </section>
              <nav className="home-nav">
                <button onClick={() => openModal("stats")}>Statistics</button>
                <button onClick={() => openModal("tutorial")}>
                  {p.preferences.tutorialSeen ? "How to play" : "Learn to play"}
                </button>
              </nav>
              <footer className="home-footer">
                <OfflineStatus offline={offline} onRefresh={refreshApp} />
              </footer>
            </div>
          </div>
        </>
      ) : null}
      {ui.screen === "difficulty" ? (
        <div className="selection-middle">
          <section className="selection-group">
            <header className="page-header">
              <button
                className="icon"
                aria-label="Back to home"
                onClick={() => navigate("home")}
              >
                <Icon name="back" />
              </button>
              <span>New game</span>
              <button
                className="icon"
                aria-label="Settings"
                onClick={() => openModal("settings")}
              >
                <Icon name="settings" />
              </button>
            </header>
            <section className="page-title">
              <h1>Choose a puzzle</h1>
              <p>Three sizes. No time limit.</p>
            </section>
            <div className="difficulty-list">
              {(["random", "easy", "medium", "hard"] as Selection[]).map(
                (d) => (
                  <button
                    className="difficulty-row"
                    key={d}
                    onClick={() => generatePuzzle(d)}
                  >
                    <span className="difficulty-symbol" aria-hidden="true">
                      {d === "random" ? (
                        <Icon name="shuffle" />
                      ) : (
                        <span className={"grid-symbol " + d} />
                      )}
                    </span>
                    <span>
                      <strong>{TITLES[d]}</strong>
                      <small>
                        {d === "random"
                          ? "A different size each time"
                          : `${SIZES[d]} × ${SIZES[d]} squares`}
                      </small>
                    </span>
                    <Icon name="back" size={18} />
                  </button>
                ),
              )}
            </div>
            <div className="difficulty-rules">
              <div className="setting-row">
                <span>
                  Relaxed mode
                  <small>No life limit. Applies to your next puzzle.</small>
                </span>
                <button
                  role="switch"
                  aria-label="Relaxed mode"
                  aria-checked={p.preferences.rules === "relaxed"}
                  disabled={ui.busy}
                  className={
                    "switch " +
                    (p.preferences.rules === "relaxed" ? "checked" : "")
                  }
                  onClick={() =>
                    preference(
                      "rules",
                      p.preferences.rules === "relaxed"
                        ? "standard"
                        : "relaxed",
                    )
                  }
                >
                  <span />
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {ui.screen === "game" && a ? (
        <>
          <div className="game-viewport">
            <div className="game-group">
              <header className="page-header game-header">
                <button
                  className="icon"
                  aria-label="Menu"
                  onClick={() => navigate("home")}
                >
                  <Icon name="back" />
                </button>
                <span>
                  {TITLES[a.puzzle.difficulty]}
                  <small>{a.rules === "relaxed" ? "Relaxed" : ""}</small>
                </span>
                <div>
                  <button
                    className="icon"
                    aria-label="Pause puzzle"
                    disabled={a.status !== "playing"}
                    onClick={pause}
                  >
                    <Icon name="pause" />
                  </button>
                  <button
                    className="icon"
                    aria-label="How to play"
                    onClick={() => openModal("tutorial")}
                  >
                    <Icon name="help" size={21} />
                  </button>
                </div>
              </header>
              <div className="game-meta">
                <div
                  className="lives"
                  aria-label={
                    a.rules === "relaxed"
                      ? "Unlimited lives"
                      : `${a.lives} lives remaining`
                  }
                >
                  {a.rules === "standard" ? (
                    [0, 1, 2].map((i) => (
                      <span key={i} className={i < a.lives ? "full-heart" : ""}>
                        <Icon name="heart" size={20} />
                      </span>
                    ))
                  ) : (
                    <span className="relaxed-label">No life limit</span>
                  )}
                </div>
                <span
                  className="grid-size"
                  aria-label={`${a.puzzle.size} by ${a.puzzle.size} grid`}
                >
                  {a.puzzle.size} × {a.puzzle.size}
                </span>
                <GameClock attempt={a} running={!!active()} onTick={tick} />
              </div>
              <div
                className="game-content"
                style={
                  {
                    "--board-width": boardLayout.width
                      ? `${boardLayout.width}px`
                      : "100%",
                    "--board-gutter": `${boardLayout.gutter}px`,
                  } as React.CSSProperties
                }
              >
                <Board
                  attempt={a}
                  onLayout={setBoardLayout}
                  paused={ui.paused || !!ui.modal || ui.busy}
                  onMove={play}
                  onStroke={playMany}
                  onGesture={() => void audio.unlock()}
                  mistake={ui.mistake}
                />
                {a.status === "playing" ? (
                  <div
                    className={"play-dock " + (ui.paused ? "concealed" : "")}
                  >
                    <div className="segmented">
                      <span
                        className="selection"
                        style={{
                          transform: `translateX(${a.mode === 1 ? 100 : 0}%)`,
                        }}
                      />
                      <button
                        aria-pressed={a.mode === 2}
                        disabled={a.status !== "playing" || ui.paused}
                        onClick={() => {
                          if (a.mode === 2) return;
                          a.mode = 2;
                          persist();
                          render();
                        }}
                      >
                        <Icon name="cross" size={18} />
                        Cross
                      </button>
                      <button
                        aria-pressed={a.mode === 1}
                        disabled={a.status !== "playing" || ui.paused}
                        onClick={() => {
                          if (a.mode === 1) return;
                          a.mode = 1;
                          persist();
                          render();
                        }}
                      >
                        <Icon name="fill" size={18} />
                        Fill
                      </button>
                    </div>
                  </div>
                ) : null}
                {ui.paused && a.status === "playing" ? (
                  <section className="pause-panel">
                    <Icon name="pause" size={28} />
                    <h2>Paused</h2>
                    <p>Your progress is saved.</p>
                    <button
                      className="primary full"
                      onClick={() => {
                        ui.paused = false;
                        clock.current = performance.now();
                        render();
                      }}
                    >
                      Resume
                    </button>
                    <button className="secondary full" onClick={replay}>
                      Restart puzzle
                    </button>
                    <button
                      className="text-button full"
                      onClick={() => navigate("home")}
                    >
                      Home
                    </button>
                  </section>
                ) : null}
                {a.status !== "playing" ? (
                  <section className="result-panel" aria-live="polite">
                    <span className="result-symbol">
                      <Icon
                        name={a.status === "won" ? "check" : "heart"}
                        size={28}
                      />
                    </span>
                    <h2>
                      {a.status === "won" ? "Puzzle complete" : "Out of lives"}
                    </h2>
                    <p>
                      {a.status === "won"
                        ? `${TITLES[a.puzzle.difficulty]} · ${formatTime(a.elapsed)}`
                        : "No lives left. Try this pattern again."}
                    </p>
                    <div>
                      <button
                        className={a.status === "won" ? "secondary" : "primary"}
                        onClick={replay}
                      >
                        {a.status === "won" ? "Replay" : "Retry"}
                      </button>
                      {a.status === "won" ? (
                        <button
                          className="primary"
                          onClick={() => generatePuzzle(a.selection)}
                        >
                          Next puzzle
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
      {ui.modal ? (
        <Dialog
          title={
            ui.modal === "stats"
              ? "Statistics"
              : ui.modal === "settings"
                ? "Settings"
                : ui.modal === "replace"
                  ? "Start a new puzzle?"
                  : "How to play"
          }
          onClose={closeModal}
        >
          {ui.modal === "stats" ? (
            <>
              <div
                className="filter-tabs"
                role="group"
                aria-label="Statistics game mode"
              >
                {(["standard", "relaxed"] as Rules[]).map((rule) => (
                  <button
                    key={rule}
                    aria-pressed={ui.statsRules === rule}
                    onClick={() => {
                      ui.statsRules = rule;
                      render();
                    }}
                  >
                    {rule === "standard" ? "Standard" : "Relaxed"}
                  </button>
                ))}
              </div>
              <label className="stats-select">
                Difficulty
                <select
                  aria-label="Statistics difficulty"
                  value={ui.statsDifficulty}
                  onChange={(e) => {
                    ui.statsDifficulty = e.target.value;
                    render();
                  }}
                >
                  <option value="all">All sizes</option>
                  {Object.entries(SIZES).map(([d, size]) => (
                    <option key={d} value={d}>
                      {TITLES[d as Difficulty]} · {size}×{size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="stats-grid">
                {[
                  ["Completed", String(stats.completed)],
                  ["Wins", String(stats.wins)],
                  [
                    "Win rate",
                    stats.wins + stats.losses
                      ? `${Math.round((stats.wins / (stats.wins + stats.losses)) * 100)}%`
                      : "-",
                  ],
                  ["Playtime", formatDuration(stats.playtime)],
                  [
                    "Average time",
                    stats.wins ? formatTime(stats.winTime / stats.wins) : "-",
                  ],
                  [
                    "Best time",
                    stats.best === null ? "-" : formatTime(stats.best),
                  ],
                ].map(([label, value]) => (
                  <div className="stat" key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p className="subtle">
                Completed counts different puzzles. Replays count as wins. Time
                includes active play only.
              </p>
            </>
          ) : null}
          {ui.modal === "settings" ? (
            <SettingsPanel
              preferences={p.preferences}
              onPreference={preference}
              offline={offline}
              onRefresh={refreshApp}
              notice={ui.notice}
            />
          ) : null}
          {ui.modal === "tutorial" ? (
            <Tutorial
              onFinish={() => {
                preference("tutorialSeen", true);
                closeModal();
                if (ui.screen === "home")
                  navigate(
                    p.active?.status === "playing" ? "game" : "difficulty",
                  );
              }}
            />
          ) : null}
          {ui.modal === "replace" ? (
            <>
              <p>
                Continue your saved puzzle, or discard it to choose a new one.
                Your statistics are kept.
              </p>
              <button className="primary full" onClick={() => navigate("game")}>
                Continue puzzle
              </button>
              <button className="text-button full" onClick={discardPrevious}>
                Discard previous run
              </button>
            </>
          ) : null}
        </Dialog>
      ) : null}
      {ui.busy || ui.error ? (
        <Dialog
          title={ui.busy ? "Preparing puzzle…" : "Not quite ready"}
          onClose={cancelGeneration}
        >
          <p>
            {ui.busy ? "Checking that the clues give one solution." : ui.error}
          </p>
          {ui.busy ? (
            <div className="loading-pattern" aria-label="Generating puzzle">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          ) : (
            <button
              className="primary full"
              onClick={() => generatePuzzle(ui.pending)}
            >
              Retry
            </button>
          )}
          <button className="text-button full" onClick={cancelGeneration}>
            Cancel
          </button>
        </Dialog>
      ) : null}
      <PortraitGuard onRotate={pause} />
    </main>
  );
}
