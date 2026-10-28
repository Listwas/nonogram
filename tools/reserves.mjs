import { build } from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";
await build({
  entryPoints: ["src/core/puzzle.ts"],
  outfile: "/tmp/nonogram-core.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { generate } = await import("/tmp/nonogram-core.mjs");
const bank = [];
for (const size of [5, 10, 15]) {
  const ids = [];
  const start = performance.now();
  for (let i = 0; i < 32; i++) {
    const p = generate(size, `reserve-1-${size}-${i}`, 3000, ids);
    if (!p) throw Error("Reserve generation failed " + size);
    bank.push(p);
    ids.push(p.id);
  }
  console.log(
    size,
    32,
    "verified reserves in",
    Math.round(performance.now() - start),
    "ms",
  );
}
await mkdir("public/data", { recursive: true });
await writeFile("public/data/reserves.json", JSON.stringify(bank));
