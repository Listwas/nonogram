import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["src/core/puzzle.ts"],
  outfile: "/tmp/nonogram-audit-core.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { generate, deduct, solve } = await import(
  "/tmp/nonogram-audit-core.mjs"
);
const boards = [],
  timings = [];
for (const size of [5, 10, 15]) {
  const seen = [];
  for (let i = 0; i < 300; i++) {
    const start = performance.now(),
      p = generate(size, `audit-v1-${size}-${i}`, 2800, seen);
    if (!p) throw Error("Generation timed out " + size);
    timings.push(performance.now() - start);
    seen.push(p.id);
    const d = deduct(size, p.rows, p.cols),
      s = solve(size, p.rows, p.cols);
    if (
      !d.solved ||
      !s.complete ||
      s.count !== 1 ||
      JSON.stringify(s.solution) !== JSON.stringify(p.answer)
    )
      throw Error("Invalid board");
    boards.push(p);
  }
  console.log("Verified 300 generated boards at", size + "×" + size);
}
await writeFile("/tmp/nonogram-audit.json", JSON.stringify(boards));
const proof = spawnSync(
  "python3",
  ["tools/independent_solver.py", "/tmp/nonogram-audit.json"],
  { stdio: "inherit" },
);
if (proof.status) process.exit(proof.status);
timings.sort((a, b) => a - b);
console.log(
  "Generation p95",
  timings[Math.floor(timings.length * 0.95)].toFixed(2),
  "ms; max",
  timings.at(-1).toFixed(2),
  "ms",
);
