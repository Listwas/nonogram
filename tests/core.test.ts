import { describe, it, expect } from "vitest";
import {
  runs,
  patterns,
  clues,
  makePuzzle,
  validPuzzle,
  solve,
  deduct,
  generate,
} from "../src/core/puzzle";
import { begin, move, completedLines } from "../src/core/session";
import {
  freshProfile,
  addTime,
  finalize,
  statKey,
  validateProfile,
} from "../src/core/profile";
const cross = makePuzzle(
  [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
  5,
);
describe("public clues and independent proof", () => {
  it("counts separated runs and empty lines", () => {
    expect(runs([1, 1, 0, 1, 0, 1, 1, 1])).toEqual([2, 1, 3]);
    expect(runs([0, 0])).toEqual([]);
    expect(runs([1, 1])).toEqual([2]);
  });
  it("enumerates only placements with the required gaps", () => {
    expect(patterns(3, [1, 1])).toEqual([5]);
    expect(patterns(3, [3])).toEqual([7]);
    expect(patterns(5, [])).toEqual([0]);
    expect(patterns(3, [2, 2])).toEqual([]);
  });
  it("detects a second solution without seeing an answer", () => {
    expect(solve(2, [[1], [1]], [[1], [1]]).count).toBe(2);
    expect(deduct(2, [[1], [1]], [[1], [1]]).solved).toBe(false);
  });
  it("distinguishes impossible, unique and budget-limited proofs", () => {
    expect(solve(2, [[2], [2]], [[], []]).count).toBe(0);
    expect(solve(5, cross.rows, cross.cols)).toMatchObject({
      complete: true,
      count: 1,
      solution: cross.answer,
    });
    expect(solve(5, cross.rows, cross.cols, -1).complete).toBe(false);
  });
  it("derives a full logical path from public clues alone", () => {
    const d = deduct(5, cross.rows, cross.cols);
    expect(d.solved).toBe(true);
    expect(d.cells.map((v) => (v === 1 ? 1 : 0))).toEqual(cross.answer);
  });
  it("rejects altered answers, clues, dimensions and identifiers", () => {
    expect(validPuzzle(cross)).toBe(true);
    for (const change of [
      { answer: [1] },
      { rows: [] },
      { id: "bad" },
      { size: 20 },
      { version: 2 },
      { difficulty: "hard" },
    ])
      expect(validPuzzle({ ...cross, ...change })).toBe(false);
  });
  it("validates seeded generation for each size and excludes played IDs", () => {
    for (const size of [5, 10, 15] as const) {
      const a = generate(size, "same-seed")!,
        b = generate(size, "same-seed")!;
      expect(a).toEqual(b);
      expect(validPuzzle(a)).toBe(true);
      expect(deduct(size, a.rows, a.cols).solved).toBe(true);
      expect(solve(size, a.rows, a.cols)).toMatchObject({
        complete: true,
        count: 1,
        solution: a.answer,
      });
      expect(generate(size, "same-seed", 2800, [a.id])!.id).not.toBe(a.id);
    }
  });
});
describe("attempt rules", () => {
  it("locks correct choices and leaves wrong cells unchanged", () => {
    let a = begin(cross, "standard", "easy");
    const wrong = move(a, 0, 1);
    expect(wrong.kind).toBe("mistake");
    expect(wrong.attempt.cells[0]).toBe(0);
    expect(wrong.attempt.lives).toBe(2);
    a = move(a, 0, 2).attempt;
    expect(move(a, 0, 1).kind).toBe("ignored");
    expect(a.cells[0]).toBe(2);
  });
  it("ends standard mode at three mistakes and rejects further moves", () => {
    let a = begin(cross, "standard", "easy");
    for (let i = 0; i < 3; i++) a = move(a, 0, 1).attempt;
    expect(a.status).toBe("lost");
    expect(move(a, 2, 1).kind).toBe("ignored");
  });
  it("allows unlimited mistakes in relaxed mode but still checks answers", () => {
    let a = begin(cross, "relaxed", "random");
    for (let i = 0; i < 20; i++) a = move(a, 0, 1).attempt;
    expect(a.lives).toBe(3);
    expect(a.status).toBe("playing");
    expect(a.cells[0]).toBe(0);
  });
  it("does not complete a line merely from its filled count", () => {
    const p = makePuzzle([1, 0, 1, 0, 0, ...Array(20).fill(0)], 5);
    const a = begin(p, "standard", "easy");
    a.cells = [0, 1, 1, 0, 0, ...Array(20).fill(0)];
    expect(completedLines(a).rows[0]).toBe(false);
  });
  it("crosses remaining gaps only after exact runs match", () => {
    const a = begin(cross, "standard", "easy");
    const after = move(a, 2, 1).attempt;
    expect(after.cells.slice(0, 5)).toEqual([2, 2, 1, 2, 2]);
  });
  it("resolves empty clue lines on initialization", () => {
    const p = makePuzzle([1, 1, 1, 1, 1, ...Array(20).fill(0)], 5),
      a = begin(p, "standard", "easy");
    expect(a.cells.slice(5).every((v) => v === 2)).toBe(true);
  });
  it("finishes once and retains selection mode for next puzzle", () => {
    let a = begin(cross, "standard", "random");
    for (let i = 0; i < 25; i++)
      a = move(a, i, cross.answer[i] ? 1 : 2).attempt;
    expect(a.status).toBe("won");
    expect(a.cells.every(Boolean)).toBe(true);
    expect(a.selection).toBe("random");
  });
  it("ignores invalid indices", () => {
    const a = begin(cross, "standard", "easy");
    expect(move(a, -1, 1).attempt).toBe(a);
    expect(move(a, 100, 1).attempt).toBe(a);
  });
});
describe("profiles, timing and statistics", () => {
  it("starts with requested audio defaults and isolated mode statistics", () => {
    const p = freshProfile();
    expect(p.preferences).toMatchObject({
      effects: true,
      effectsVolume: 1,
    });
    expect(p.stats).toEqual({});
  });
  it("counts active time including time before an abandoned attempt", () => {
    const p = freshProfile();
    p.active = begin(cross, "standard", "easy");
    addTime(p, 1500);
    p.active = begin(cross, "standard", "easy");
    expect(p.stats[statKey("easy", "standard")].playtime).toBe(1500);
    expect(p.active.elapsed).toBe(0);
  });
  it("finalizes wins once and does not duplicate completion on replay", () => {
    const p = freshProfile();
    p.active = begin(cross, "standard", "easy");
    addTime(p, 2000);
    for (let i = 0; i < 25; i++)
      p.active = move(p.active, i, cross.answer[i] ? 1 : 2).attempt;
    finalize(p);
    finalize(p);
    expect(p.stats["standard:easy"]).toMatchObject({
      completed: 1,
      wins: 1,
      winTime: 2000,
      best: 2000,
    });
    p.active = begin(cross, "standard", "easy", true);
    for (let i = 0; i < 25; i++)
      p.active = move(p.active, i, cross.answer[i] ? 1 : 2).attempt;
    finalize(p);
    expect(p.stats["standard:easy"]).toMatchObject({ completed: 1, wins: 2 });
  });
  it("keeps losses and relaxed wins separate", () => {
    const p = freshProfile();
    p.active = begin(cross, "standard", "easy");
    for (let i = 0; i < 3; i++) p.active = move(p.active, 0, 1).attempt;
    finalize(p);
    p.active = begin(cross, "relaxed", "easy");
    for (let i = 0; i < 25; i++)
      p.active = move(p.active, i, cross.answer[i] ? 1 : 2).attempt;
    finalize(p);
    expect(p.stats["standard:easy"].losses).toBe(1);
    expect(p.stats["relaxed:easy"].wins).toBe(1);
  });
  it("accepts valid progress and rejects corrupted snapshots", () => {
    const p = freshProfile();
    p.active = begin(cross, "standard", "easy");
    expect(validateProfile(p)).toEqual(p);
    for (const change of [
      { cells: [0] },
      { cells: Array(25).fill(1) },
      { lives: -1 },
      { elapsed: NaN },
      { status: "won" },
      { mode: 3 },
    ])
      expect(
        validateProfile({ ...p, active: { ...p.active, ...change } }),
      ).toBeNull();
    expect(
      validateProfile({
        ...p,
        preferences: { ...p.preferences, effectsVolume: 2 },
      }),
    ).toBeNull();
  });
});
