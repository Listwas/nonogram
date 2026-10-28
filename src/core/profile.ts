import { SaveScheduler } from "./saveScheduler";
import { validPuzzle, type Difficulty, type Rules } from "./puzzle";
import type { Attempt } from "./session";
export interface Preferences {
  theme: "system" | "light" | "dark";
  reduceMotion: boolean;
  effects: boolean;
  effectsVolume: number;
  rules: Rules;
  tutorialSeen: boolean;
}
export interface Stats {
  completed: number;
  wins: number;
  losses: number;
  playtime: number;
  winTime: number;
  best: number | null;
}
export interface Profile {
  version: 1;
  active: Attempt | null;
  preferences: Preferences;
  stats: Record<string, Stats>;
  recent: string[];
}
export const emptyStats = (): Stats => ({
  completed: 0,
  wins: 0,
  losses: 0,
  playtime: 0,
  winTime: 0,
  best: null,
});
export function freshProfile(): Profile {
  return {
    version: 1,
    active: null,
    preferences: {
      theme: "system",
      reduceMotion: false,
      effects: true,
      effectsVolume: 1,
      rules: "standard",
      tutorialSeen: false,
    },
    stats: {},
    recent: [],
  };
}
export function statKey(difficulty: Difficulty, rules: Rules) {
  return `${rules}:${difficulty}`;
}
export function addTime(p: Profile, delta: number) {
  if (!p.active || p.active.status !== "playing" || delta <= 0) return;
  const k = statKey(p.active.puzzle.difficulty, p.active.rules);
  p.stats[k] ??= emptyStats();
  p.stats[k].playtime += delta;
  p.active.elapsed += delta;
}
export function finalize(p: Profile) {
  const a = p.active;
  if (!a || a.status === "playing" || a.counted) return;
  const k = statKey(a.puzzle.difficulty, a.rules);
  const s = (p.stats[k] ??= emptyStats());
  if (a.status === "won") {
    s.wins++;
    if (!a.completedBefore) s.completed++;
    s.winTime += a.elapsed;
    s.best = s.best === null ? a.elapsed : Math.min(s.best, a.elapsed);
    a.completedBefore = true;
  } else s.losses++;
  a.counted = true;
}
function validAttempt(a: unknown): a is Attempt {
  if (!a || typeof a !== "object") return false;
  const x = a as Attempt;
  if (
    !validPuzzle(x.puzzle) ||
    typeof x.id !== "string" ||
    !["standard", "relaxed"].includes(x.rules) ||
    !["random", "easy", "medium", "hard"].includes(x.selection) ||
    !Array.isArray(x.cells) ||
    x.cells.length !== x.puzzle.size ** 2 ||
    ![1, 2].includes(x.mode) ||
    !Number.isInteger(x.lives) ||
    x.lives < 0 ||
    x.lives > 3 ||
    !Number.isFinite(x.elapsed) ||
    x.elapsed < 0 ||
    !["playing", "won", "lost"].includes(x.status) ||
    typeof x.counted !== "boolean" ||
    typeof x.completedBefore !== "boolean"
  )
    return false;
  if (
    !x.cells.every(
      (v, i) =>
        v === 0 ||
        (v === 1 && x.puzzle.answer[i] === 1) ||
        (v === 2 && x.puzzle.answer[i] === 0),
    )
  )
    return false;
  return (
    (x.status !== "won" || x.cells.every(Boolean)) &&
    (x.status !== "playing" || (x.lives > 0 && !x.cells.every(Boolean))) &&
    (x.status !== "lost" || (x.rules === "standard" && x.lives === 0))
  );
}
export function validateProfile(input: unknown): Profile | null {
  if (!input || typeof input !== "object") return null;
  const x = input as Profile;
  if (
    x.version !== 1 ||
    !x.preferences ||
    !x.stats ||
    typeof x.stats !== "object" ||
    !Array.isArray(x.recent)
  )
    return null;
  if (x.active !== null && !validAttempt(x.active)) return null;
  const d = freshProfile();
  const pref = x.preferences;
  for (const k of ["reduceMotion", "effects", "tutorialSeen"] as const)
    if (typeof pref[k] !== "boolean") return null;
  if (
    !["system", "light", "dark"].includes(pref.theme) ||
    !["standard", "relaxed"].includes(pref.rules) ||
    !Number.isFinite(pref.effectsVolume) ||
    pref.effectsVolume < 0 ||
    pref.effectsVolume > 1
  )
    return null;
  for (const [key, s] of Object.entries(x.stats))
    if (
      !/^(standard|relaxed):(easy|medium|hard)$/.test(key) ||
      !s ||
      ![s.completed, s.wins, s.losses, s.playtime, s.winTime].every(
        (v) => Number.isFinite(v) && v >= 0,
      ) ||
      ![s.completed, s.wins, s.losses].every(Number.isInteger) ||
      s.completed > s.wins ||
      !(s.best === null || (Number.isFinite(s.best) && s.best >= 0))
    )
      return null;
  return {
    ...d,
    ...x,
    preferences: {
      theme: pref.theme,
      reduceMotion: pref.reduceMotion,
      effects: pref.effects,
      effectsVolume: pref.effectsVolume,
      tutorialSeen: pref.tutorialSeen,
      rules: pref.rules,
    },
    recent: x.recent.filter((v) => typeof v === "string").slice(-128),
  };
}
export class ProfileStore {
  db: IDBDatabase | null = null;
  notice = "";
  private writer = new SaveScheduler<Profile>((copy) => this.write(copy));
  flush() {
    return this.writer.flush();
  }
  async open(): Promise<Profile> {
    try {
      this.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("nonogram-profile", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("profile");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const tx = this.db!.transaction("profile", "readonly"),
          s = tx.objectStore("profile"),
          a = s.get("current"),
          b = s.get("backup");
        tx.oncomplete = () => resolve([a.result, b.result]);
        tx.onerror = () => reject(tx.error);
      });
      if (values[0] === undefined) return freshProfile();
      const current = validateProfile(values[0]);
      if (current) {
        await this.save(current);
        return current;
      }
      const backup = validateProfile(values[1]);
      this.notice = backup
        ? "Your save was recovered from its backup."
        : "Your save could not be read. A fresh profile is in use.";
      if (backup) await this.save(backup);
      return backup ?? freshProfile();
    } catch {
      this.notice =
        "Saving is unavailable. Keep this tab open to retain your progress.";
      return freshProfile();
    }
  }
  save(profile: Profile) {
    return this.writer.save(profile);
  }
  private write(copy: Profile): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.db) {
        reject(new Error("Storage unavailable"));
        return;
      }
      const tx = this.db.transaction("profile", "readwrite"),
        s = tx.objectStore("profile");
      const old = s.get("current");
      old.onsuccess = () => {
        if (validateProfile(old.result)) s.put(old.result, "backup");
        s.put(copy, "current");
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
