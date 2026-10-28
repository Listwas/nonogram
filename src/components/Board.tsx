import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attempt } from "../core/session";
import { completedLines } from "../core/session";
interface Props {
  attempt: Attempt;
  onLayout: (layout: { width: number; gutter: number }) => void;
  paused: boolean;
  onMove: (index: number) => boolean;
  onStroke: (indices: number[]) => boolean;
  onGesture: () => void;
  mistake: number | null;
}
export function Board({
  attempt: a,
  onLayout,
  paused,
  onMove,
  onStroke,
  onGesture,
  mistake,
}: Props) {
  const n = a.puzzle.size,
    done = useMemo(() => completedLines(a), [a.cells, a.puzzle]),
    viewport = useRef<HTMLDivElement>(null),
    board = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(-1),
    [space, setSpace] = useState({ width: 400, height: Infinity });
  const available = space.width;
  const geometry = useRef<DOMRect | null>(null);
  const pointers = useRef(new Set<number>());
  const stroke = useRef<{
    first: number;
    axis: string;
    visited: Set<number>;
    stopped: boolean;
  } | null>(null);
  const multiTouch = useRef(false);
  const maxCols = Math.max(...a.puzzle.cols.map((c) => Math.max(c.length, 1)));
  const maxDigits = Math.max(
    ...a.puzzle.rows.map((clue) =>
      (clue.length ? clue : [0]).reduce(
        (sum, value) => sum + String(value).length,
        0,
      ),
    ),
  );
  const clueFont = Math.max(
    11,
    Math.min(
      22,
      Math.floor(
        Math.min(available, space.height) / (n + maxDigits * 0.7 + 2),
      ) * 0.65,
    ),
  );
  const clueGap = Math.max(3, Math.round(clueFont * 0.32));
  const gutter = Math.ceil(
    Math.max(
      ...a.puzzle.rows.map((clue) => {
        const values = clue.length ? clue : [0];
        return (
          values.reduce(
            (sum, value) => sum + String(value).length * clueFont * 0.64,
            0,
          ) +
          (values.length - 1) * clueGap
        );
      }),
    ) + 16,
  );
  const top = Math.ceil(maxCols * (clueFont * 1.25 + 2) + 8);
  // Snap native cell pitches to the display density.
  const pixelRatio = window.devicePixelRatio || 1;
  const widthSide = Math.max(
    1,
    Math.floor(((available - gutter - 2) * pixelRatio) / n) / pixelRatio,
  );
  const heightSide = Math.max(1, (space.height - top) / n);
  const side =
    Math.floor(Math.max(12, Math.min(widthSide, heightSide)) * pixelRatio) /
    pixelRatio;
  const width = gutter + n * side,
    height = top + n * side;
  useLayoutEffect(() => {
    onLayout({ width, gutter });
  }, [width, gutter, onLayout]);
  useLayoutEffect(() => {
    const el = viewport.current!;
    const content = el.closest<HTMLElement>(".game-content")!;
    const container = el.closest<HTMLElement>(".game-viewport")!;
    const measure = () => {
      geometry.current = null;
      const group = container.querySelector<HTMLElement>(".game-group")!;
      const overhead = group.offsetHeight - el.offsetHeight;
      const height = Math.max(
        0,
        Math.floor(container.clientHeight - overhead - 4),
      );
      const width = el.clientWidth;
      setSpace((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(content);
    observer.observe(container);
    window.addEventListener("resize", measure);
    measure();
    stroke.current = null;
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [a.status]);
  useLayoutEffect(() => {
    setFocus(-1);
    geometry.current = null;
    stroke.current = null;
    pointers.current.clear();
    multiTouch.current = false;
  }, [a.id, paused]);
  useEffect(() => {
    const contacts = new Set<number>();
    const cancel = () => {
      geometry.current = null;
      stroke.current = null;
      pointers.current.clear();
      multiTouch.current = false;
      contacts.clear();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      contacts.add(e.pointerId);
      if (contacts.size > 1) {
        multiTouch.current = true;
        stroke.current = null;
      }
    };
    const up = (e: PointerEvent) => {
      contacts.delete(e.pointerId);
      if (!contacts.size) multiTouch.current = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, []);
  const hit = (x: number, y: number) => {
    const rect = (geometry.current ??= board.current!.getBoundingClientRect()),
      c = Math.floor((((x - rect.left) * width) / rect.width - gutter) / side),
      r = Math.floor((((y - rect.top) * height) / rect.height - top) / side);
    return c >= 0 && c < n && r >= 0 && r < n ? r * n + c : -1;
  };
  const pointerDown = (e: React.PointerEvent) => {
    if (paused || a.status !== "playing" || e.button !== 0) return;
    onGesture();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      multiTouch.current = true;
      stroke.current = null;
      return;
    }
    if (pointers.current.size !== 1) return;
    geometry.current = board.current!.getBoundingClientRect();
    const index = hit(e.clientX, e.clientY);
    if (index < 0) return;
    stroke.current = {
      first: index,
      axis: "",
      visited: new Set(),
      stopped: false,
    };
    setFocus(index);
  };
  const paint = (index: number) => {
    const s = stroke.current;
    if (!s || s.stopped || s.visited.has(index)) return;
    s.visited.add(index);
    if (!onMove(index)) s.stopped = true;
  };
  const pointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || paused) return;
    if (multiTouch.current) return;
    const index = hit(e.clientX, e.clientY),
      s = stroke.current;
    if (index < 0 || !s || s.stopped) return;
    setFocus(index);
    const fr = Math.floor(s.first / n),
      fc = s.first % n,
      r = Math.floor(index / n),
      c = index % n;
    if (index !== s.first && !s.axis)
      s.axis = Math.abs(r - fr) > Math.abs(c - fc) ? "col" : "row";
    if (s.axis) {
      if ((s.axis === "row" && r !== fr) || (s.axis === "col" && c !== fc))
        return;
      const offset = s.axis === "row" ? 1 : n,
        start = s.axis === "row" ? fc : fr,
        end = s.axis === "row" ? c : r;
      const direction = end >= start ? 1 : -1;
      const indices: number[] = [];
      for (let v = start; ; v += direction) {
        const cell = s.first + (v - start) * offset;
        if (!s.visited.has(cell)) {
          s.visited.add(cell);
          indices.push(cell);
        }
        if (v === end) break;
      }
      if (indices.length && !onStroke(indices)) s.stopped = true;
    }
  };
  const pointerUp = (e: React.PointerEvent) => {
    if (paused) {
      stroke.current = null;
      pointers.current.clear();
      return;
    }
    pointerMove(e);
    if (pointers.current.size === 1 && !multiTouch.current && stroke.current) {
      const index = hit(e.clientX, e.clientY);
      if (index === stroke.current.first) paint(index);
    }
    pointers.current.delete(e.pointerId);
    stroke.current = null;
    if (!pointers.current.size) multiTouch.current = false;
  };
  return (
    <section className="board-section" aria-label={`${n} by ${n} nonogram`}>
      <div
        className={"board-viewport " + (paused ? "concealed" : "")}
        ref={viewport}
        style={{ height }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          stroke.current = null;
          if (!pointers.current.size) multiTouch.current = false;
        }}
      >
        <div style={{ width, height }} className="board-space">
          <div
            ref={board}
            className="puzzle-grid"
            role="grid"
            aria-label="Puzzle board"
            style={
              {
                width,
                height,
                fontSize: clueFont,
                gridTemplateColumns: `${gutter}px repeat(${n}, ${side}px)`,
                gridTemplateRows: `${top}px repeat(${n}, ${side}px)`,
                "--cell-side": `${side}px`,
              } as React.CSSProperties
            }
          >
            <div className="clue-corner" aria-hidden="true" />
            {a.puzzle.cols.map((clue, c) => (
              <div
                key={"c" + c}
                aria-label={`Column ${c + 1}: ${clue.join(", ") || "0"}`}
                className={
                  "clue column " +
                  ((c + 1) % 5 === 0 && c < n - 1 ? "group-end " : "") +
                  (done.cols[c] ? "done " : "") +
                  (focus % n === c ? "highlight" : "")
                }
              >
                <div className="clue-values">
                  {(clue.length ? clue : [0]).map((v, i) => (
                    <span key={i}>{v}</span>
                  ))}
                </div>
              </div>
            ))}
            {a.puzzle.rows.flatMap((clue, r) => [
              <div
                key={"r" + r}
                aria-label={`Row ${r + 1}: ${clue.join(", ") || "0"}`}
                className={
                  "clue row " +
                  ((r + 1) % 5 === 0 && r < n - 1 ? "group-end " : "") +
                  (done.rows[r] ? "done " : "") +
                  (Math.floor(focus / n) === r ? "highlight" : "")
                }
              >
                <div className="clue-values" style={{ gap: clueGap }}>
                  {(clue.length ? clue : [0]).map((v, i) => (
                    <span key={i}>{v}</span>
                  ))}
                </div>
              </div>,
              ...Array.from({ length: n }, (_, c) => {
                const index = r * n + c,
                  value = a.cells[index];
                return (
                  <button
                    key={index}
                    role="gridcell"
                    data-cell={index}
                    aria-label={`Row ${r + 1}, column ${c + 1}, ${value === 1 ? "filled" : value === 2 ? "crossed" : "unanswered"}`}
                    aria-disabled={paused || !!value || a.status !== "playing"}
                    tabIndex={
                      !paused &&
                      index ===
                        (focus >= 0
                          ? focus
                          : Math.max(
                              0,
                              a.cells.findIndex((v) => v === 0),
                            ))
                        ? 0
                        : -1
                    }
                    className={
                      "cell " +
                      (value === 1
                        ? "filled "
                        : value === 2
                          ? "crossed "
                          : "") +
                      (mistake === index ? "mistake " : "") +
                      (focus === index ? "active-cell " : "") +
                      ""
                    }
                    style={{ fontSize: Math.max(12, side * 0.65) }}
                    onKeyDown={(e) => {
                      if (["Enter", " "].includes(e.key) && !paused) {
                        e.preventDefault();
                        onGesture();
                        onMove(index);
                      }
                      if (e.key.startsWith("Arrow")) {
                        e.preventDefault();
                        const d = (
                          {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowUp: -n,
                            ArrowDown: n,
                          } as Record<string, number>
                        )[e.key];
                        const next = index + d;
                        if (
                          next >= 0 &&
                          next < n * n &&
                          (e.key !== "ArrowLeft" || c > 0) &&
                          (e.key !== "ArrowRight" || c < n - 1)
                        )
                          board.current
                            ?.querySelector<HTMLButtonElement>(
                              `[data-cell="${next}"]`,
                            )
                            ?.focus();
                      }
                    }}
                    onFocus={() => setFocus(index)}
                  >
                    {value === 2 ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m7 7 10 10M17 7 7 17" />
                      </svg>
                    ) : null}
                  </button>
                );
              }),
            ])}
            <svg
              className="grid-lines"
              aria-hidden="true"
              width={n * side}
              height={n * side}
              style={{ left: gutter, top }}
              shapeRendering="crispEdges"
            >
              {Array.from({ length: n - 1 }, (_, index) => {
                const i = index + 1;
                return (
                  <g key={i} className={i % 5 === 0 ? "major" : undefined}>
                    <line
                      x1={i * side}
                      y1={0}
                      x2={i * side}
                      y2={n * side}
                      vectorEffect="non-scaling-stroke"
                    />
                    <line
                      x1={0}
                      y1={i * side}
                      x2={n * side}
                      y2={i * side}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
              <rect
                className="major"
                x={1}
                y={1}
                width={n * side - 2}
                height={n * side - 2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
