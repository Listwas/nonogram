import {
  runs,
  type Cell,
  type Mode,
  type Puzzle,
  type Rules,
  type Selection,
} from "./puzzle";
export interface Attempt {
  id: string;
  puzzle: Puzzle;
  cells: Cell[];
  lives: number;
  rules: Rules;
  selection: Selection;
  mode: Mode;
  elapsed: number;
  status: "playing" | "won" | "lost";
  counted: boolean;
  completedBefore: boolean;
}
export function completedLines(a: Attempt) {
  const n = a.puzzle.size;
  const equal = (v: number[], target: number[]) =>
    JSON.stringify(runs(v)) === JSON.stringify(target);
  return {
    rows: a.puzzle.rows.map((clue, r) =>
      equal(a.cells.slice(r * n, (r + 1) * n), clue),
    ),
    cols: a.puzzle.cols.map((clue, c) =>
      equal(
        Array.from({ length: n }, (_, r) => a.cells[r * n + c]),
        clue,
      ),
    ),
  };
}
function autoCross(a: Attempt) {
  const n = a.puzzle.size,
    done = completedLines(a);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (!a.cells[r * n + c] && (done.rows[r] || done.cols[c]))
        a.cells[r * n + c] = 2;
}
export function begin(
  puzzle: Puzzle,
  rules: Rules,
  selection: Selection,
  completedBefore = false,
): Attempt {
  const a: Attempt = {
    id: crypto.randomUUID(),
    puzzle,
    cells: Array(puzzle.size ** 2).fill(0),
    lives: 3,
    rules,
    selection,
    mode: 1,
    elapsed: 0,
    status: "playing",
    counted: false,
    completedBefore,
  };
  autoCross(a);
  return a;
}
export function move(attempt: Attempt, index: number, mode: Mode) {
  if (
    attempt.status !== "playing" ||
    index < 0 ||
    index >= attempt.cells.length ||
    attempt.cells[index]
  )
    return { attempt, kind: "ignored" as const, cleared: false };
  const a = { ...attempt, cells: [...attempt.cells] },
    before = completedLines(a);
  if ((mode === 1) !== Boolean(a.puzzle.answer[index])) {
    if (a.rules === "standard" && --a.lives === 0) a.status = "lost";
    return { attempt: a, kind: "mistake" as const, cleared: false };
  }
  a.cells[index] = mode;
  autoCross(a);
  const after = completedLines(a);
  if (a.cells.every(Boolean)) a.status = "won";
  return {
    attempt: a,
    kind: "correct" as const,
    cleared:
      after.rows.some((v, i) => v && !before.rows[i]) ||
      after.cols.some((v, i) => v && !before.cols[i]),
  };
}
