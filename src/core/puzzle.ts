export type Size = 5 | 10 | 15;
export type Difficulty = "easy" | "medium" | "hard";
export type Selection = Difficulty | "random";
export type Rules = "standard" | "relaxed";
export type Cell = 0 | 1 | 2; // unknown, filled, crossed
export type Mode = 1 | 2;
export const SIZES: Record<Difficulty, Size> = {
  easy: 5,
  medium: 10,
  hard: 15,
};
export interface Puzzle {
  version: 1;
  id: string;
  size: Size;
  difficulty: Difficulty;
  answer: number[];
  rows: number[][];
  cols: number[][];
  seed: string;
}
export function runs(line: readonly number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const v of [...line, 0]) {
    if (v === 1) run++;
    else if (run) {
      out.push(run);
      run = 0;
    }
  }
  return out;
}
export function clues(answer: readonly number[], size: number) {
  return {
    rows: Array.from({ length: size }, (_, r) =>
      runs(answer.slice(r * size, (r + 1) * size)),
    ),
    cols: Array.from({ length: size }, (_, c) =>
      runs(Array.from({ length: size }, (_, r) => answer[r * size + c])),
    ),
  };
}
export function hash(text: string): string {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function makePuzzle(
  answer: number[],
  size: Size,
  seed = "authored",
): Puzzle {
  return {
    version: 1,
    id: `n1-${size}-${hash(answer.join(""))}`,
    size,
    difficulty: ({ 5: "easy", 10: "medium", 15: "hard" } as const)[size],
    answer: [...answer],
    ...clues(answer, size),
    seed,
  };
}
export function validPuzzle(p: unknown): p is Puzzle {
  if (!p || typeof p !== "object") return false;
  const x = p as Puzzle;
  if (
    x.version !== 1 ||
    ![5, 10, 15].includes(x.size) ||
    SIZES[x.difficulty] !== x.size ||
    typeof x.seed !== "string" ||
    !Array.isArray(x.answer) ||
    x.answer.length !== x.size * x.size ||
    !x.answer.every((v) => v === 0 || v === 1)
  )
    return false;
  const expected = makePuzzle(x.answer, x.size, x.seed);
  return (
    x.id === expected.id &&
    JSON.stringify(x.rows) === JSON.stringify(expected.rows) &&
    JSON.stringify(x.cols) === JSON.stringify(expected.cols)
  );
}
const patternCache = new Map<string, number[]>();
export function patterns(size: number, clue: readonly number[]): number[] {
  const key = size + ":" + clue.join(",");
  const cached = patternCache.get(key);
  if (cached) return cached;
  const out: number[] = [];
  if (!clue.length) out.push(0);
  else {
    const place = (k: number, start: number, mask: number) => {
      const needed =
        clue.slice(k).reduce((a, b) => a + b, 0) + (clue.length - k - 1);
      for (let pos = start; pos <= size - needed; pos++) {
        const next = mask | (((1 << clue[k]) - 1) << pos);
        if (k === clue.length - 1) out.push(next);
        else place(k + 1, pos + clue[k] + 1, next);
      }
    };
    if (clue.every((v) => Number.isInteger(v) && v > 0)) place(0, 0, 0);
  }
  if (patternCache.size > 2048) patternCache.clear();
  patternCache.set(key, out);
  return out;
}
export function deduct(
  size: number,
  rows: number[][],
  cols: number[][],
  initial?: Cell[],
) {
  const cells: Cell[] = initial ? [...initial] : Array(size * size).fill(0);
  let rounds = 0;
  while (rounds < size * size) {
    let changed = false;
    rounds++;
    for (let axis = 0; axis < 2; axis++)
      for (let line = 0; line < size; line++) {
        const ids = Array.from({ length: size }, (_, i) =>
          axis ? i * size + line : line * size + i,
        );
        const options = patterns(size, (axis ? cols : rows)[line]).filter((p) =>
          ids.every(
            (id, i) =>
              !cells[id] || Boolean(p & (1 << i)) === (cells[id] === 1),
          ),
        );
        if (!options.length)
          return { solved: false, valid: false, cells, rounds };
        let all = (1 << size) - 1,
          any = 0;
        for (const p of options) {
          all &= p;
          any |= p;
        }
        ids.forEach((id, i) => {
          if (!cells[id] && (all & (1 << i) || !(any & (1 << i)))) {
            cells[id] = all & (1 << i) ? 1 : 2;
            changed = true;
          }
        });
      }
    if (!changed) break;
  }
  return { solved: cells.every(Boolean), valid: true, cells, rounds };
}
// Exact solution counting only consumes public clues. It never reads an answer key.
export function solve(
  size: number,
  rows: number[][],
  cols: number[][],
  deadline = Infinity,
  limit = 2,
) {
  let count = 0,
    complete = true,
    nodes = 0;
  let solution: number[] | null = null;
  const search = (rd: number[][], cd: number[][]) => {
    if (count >= limit || !complete) return;
    if (++nodes > 100000 || performance.now() > deadline) {
      complete = false;
      return;
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < size; r++) {
        const next = rd[r].filter((p) =>
          cd.every((domain, c) =>
            domain.some((q) => Boolean(p & (1 << c)) === Boolean(q & (1 << r))),
          ),
        );
        if (!next.length) return;
        if (next.length !== rd[r].length) {
          rd[r] = next;
          changed = true;
        }
      }
      for (let c = 0; c < size; c++) {
        const next = cd[c].filter((q) =>
          rd.every((domain, r) =>
            domain.some((p) => Boolean(p & (1 << c)) === Boolean(q & (1 << r))),
          ),
        );
        if (!next.length) return;
        if (next.length !== cd[c].length) {
          cd[c] = next;
          changed = true;
        }
      }
      if (performance.now() > deadline) {
        complete = false;
        return;
      }
    }
    let branch = -1;
    for (let r = 0; r < size; r++)
      if (rd[r].length > 1 && (branch < 0 || rd[r].length < rd[branch].length))
        branch = r;
    if (branch < 0) {
      count++;
      solution = rd.flatMap((d) =>
        Array.from({ length: size }, (_, c) => (d[0] >> c) & 1),
      );
      return;
    }
    for (const p of rd[branch]) {
      const next = rd.map((d) => d.slice());
      next[branch] = [p];
      search(
        next,
        cd.map((d) => d.slice()),
      );
      if (count >= limit || !complete) break;
    }
  };
  search(
    rows.map((c) => [...patterns(size, c)]),
    cols.map((c) => [...patterns(size, c)]),
  );
  return { count, complete, solution, nodes };
}
export function rng(seed: string) {
  let state = parseInt(hash(seed), 16) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
export function generate(
  size: Size,
  seed: string,
  budget = 2800,
  exclude: string[] = [],
): Puzzle | null {
  const rand = rng(seed),
    end = performance.now() + budget;
  let attempt = 0;
  while (performance.now() < end) {
    const density = 0.5 + rand() * 0.25;
    const answer = Array.from({ length: size * size }, () =>
      rand() < density ? 1 : 0,
    );
    if (
      answer.filter(Boolean).length < size * size * 0.3 ||
      answer.every(Boolean)
    )
      continue;
    const p = makePuzzle(answer, size, seed + ":" + attempt++);
    if (exclude.includes(p.id)) continue;
    const d = deduct(size, p.rows, p.cols);
    if (!d.solved) continue;
    const proof = solve(size, p.rows, p.cols, end);
    if (
      proof.complete &&
      proof.count === 1 &&
      JSON.stringify(proof.solution) === JSON.stringify(answer)
    )
      return p;
  }
  return null;
}
