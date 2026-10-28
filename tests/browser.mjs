import assert from "node:assert/strict";
import {
  harness,
  fit,
  instrumentInput,
  instrumentEffects,
} from "./support.mjs";
import { mkdirSync } from "node:fs";

const output = "/tmp/nonogram-browser";
mkdirSync(output, { recursive: true });
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
  console.log("PASS", message);
};
async function profile(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("nonogram-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("profile"),
            get = tx.objectStore("profile").get("current");
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}
async function waitProfile(page, predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const p = await profile(page);
    if (p && predicate(p)) return p;
    await page.waitForTimeout(30);
  }
  throw Error(
    "Profile condition timeout " + JSON.stringify(await profile(page)),
  );
}
async function start(page, size) {
  if (await page.getByRole("button", { name: "Menu", exact: true }).count())
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await page.getByRole("button", { name: "New game", exact: true }).tap();
  if (
    await page
      .getByRole("button", { name: "Discard previous run", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Discard previous run", exact: true })
      .tap();
  await page
    .getByRole("button", {
      name: new RegExp(size === 5 ? "Easy" : size === 10 ? "Medium" : "Hard"),
    })
    .tap();
  await page.getByRole("grid").waitFor();
  return waitProfile(page, (p) => p.active?.puzzle.size === size);
}
async function mode(page, fill) {
  await page
    .getByRole("button", { name: fill ? "Fill" : "Cross", exact: true })
    .tap();
}
async function solve(page) {
  let p = await profile(page);
  const answer = p.active.puzzle.answer;
  for (let i = 0; i < answer.length; i++) {
    p = await profile(page);
    if (p.active.cells[i]) continue;
    await mode(page, !!answer[i]);
    await page.locator(`[data-cell="${i}"]`).tap();
    await waitProfile(page, (q) => q.active.cells[i] !== 0);
  }
  return waitProfile(page, (p) => p.active.status === "won");
}
function audioInstrumentation() {
  window.audioMeters = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    if (args[0] === this.context.destination) {
      const meter = this.context.createAnalyser();
      meter.fftSize = 256;
      connect.call(this, meter);
      connect.call(meter, this.context.destination);
      window.audioMeters.push(meter);
      return args[0];
    }
    return connect.apply(this, args);
  };
}
async function rms(page) {
  return page.evaluate(() =>
    Math.max(
      0,
      ...(window.audioMeters || []).map((m) => {
        const v = new Float32Array(m.fftSize);
        m.getFloatTimeDomainData(v);
        return Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
      }),
    ),
  );
}
const h = await harness(),
  { browser, engine: name, base: url } = h;
{
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(audioInstrumentation);
  await context.addInitScript(instrumentEffects);
  await context.addInitScript(instrumentInput);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  try {
    await page.goto(url);
    await page
      .getByRole("heading", { name: "Nonogram", exact: true })
      .waitFor();
    await page
      .getByText("Ready offline", { exact: true })
      .waitFor({ timeout: 60000 });
    check(true, name + " loads and caches all resources");
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${output}/${name}-home.png` });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name + " home fits phone width",
    );
    await page.getByRole("button", { name: "Learn to play" }).tap();
    for (let i = 1; i <= 3; i++)
      await page.getByRole("button", { name: "Practice square " + i }).tap();
    await page.getByRole("button", { name: "Next", exact: true }).tap();
    await page.getByRole("button", { name: "Practice square 1" }).tap();
    await mode(page, false);
    await page.getByRole("button", { name: "Practice square 2" }).tap();
    await mode(page, true);
    await page.getByRole("button", { name: "Practice square 3" }).tap();
    await page.getByRole("button", { name: "Next", exact: true }).tap();
    await page.getByRole("button", { name: "Ready to play" }).tap();
    check(true, name + " interactive tutorial completes");
    const rows = page.locator(".difficulty-row");
    check(
      (await rows.first().innerText()).includes("Random"),
      name + " random is first",
    );
    await page.getByRole("button", { name: /Easy/ }).tap();
    await page.getByRole("grid").waitFor();
    let p = await waitProfile(page, (p) => p.active?.puzzle.size === 5);
    check(
      p.preferences.effects &&
        p.preferences.effectsVolume === 1 &&
        !("music" in p.preferences),
      name + " fresh effects defaults, no music",
    );
    await page.waitForTimeout(1700);
    p = await profile(page);
    const wrong = p.active.cells.findIndex(
      (v, i) => !v && !p.active.puzzle.answer[i],
    );
    await mode(page, true);
    await page.evaluate(() => {
      window.effectEvents = [];
    });
    await page.locator(`[data-cell="${wrong}"]`).tap();
    p = await waitProfile(page, (p) => p.active.lives === 2);
    check(
      !p.active.cells[wrong],
      name + " wrong move costs life and preserves square",
    );
    let awakenedEffect = 0;
    for (let i = 0; i < 20 && awakenedEffect <= 0.00001; i++) {
      awakenedEffect = await rms(page);
      await page.waitForTimeout(10);
    }
    check(
      awakenedEffect > 0.00001,
      name + " first effect after idle wakes audio and produces real samples",
    );
    let effect = 0;
    await page.locator(`[data-cell="${wrong}"]`).tap();
    for (let i = 0; i < 6; i++) {
      effect = Math.max(effect, await rms(page));
      await page.waitForTimeout(10);
    }
    check(effect > 0.00001, name + " accepted moves emit real sound effects");
    await page.waitForTimeout(100);
    await page.locator(`[data-cell="${wrong}"]`).tap();
    await page
      .getByRole("heading", { name: "Out of lives", exact: true })
      .waitFor();
    check(
      await page.evaluate(
        () =>
          window.effectEvents.some(
            (e) => e.hz > 680 && e.hz < 720 && e.duration > 0.2,
          ) &&
          window.effectEvents.filter(
            (e) => e.hz > 380 && e.hz < 405 && e.duration > 0.15,
          ).length === 1,
      ),
      name + " mistakes and terminal loss play distinct audible cues once",
    );
    await page.getByRole("button", { name: "Retry", exact: true }).tap();

    await page.getByRole("button", { name: "Pause puzzle" }).tap();
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    const time = (await profile(page)).active.elapsed;
    await page.waitForTimeout(1100);
    check(
      Math.abs((await profile(page)).active.elapsed - time) < 80,
      name + " pause stops time",
    );
    check(
      await page
        .locator(".play-dock")
        .evaluate((e) => getComputedStyle(e).visibility === "hidden"),
      name + " pause covers play controls",
    );
    const pausedId = (await profile(page)).active.puzzle.seed;
    await page.getByRole("button", { name: "Home", exact: true }).tap();
    await page.getByRole("button", { name: /Continue puzzle/ }).tap();
    check(
      (await profile(page)).active.puzzle.seed === pausedId,
      name + " pause Home preserves the saved puzzle",
    );
    await page.getByRole("button", { name: "Pause puzzle" }).tap();
    await page
      .getByRole("button", { name: "Restart puzzle", exact: true })
      .tap();
    p = await waitProfile(page, (p) => p.active.lives === 3);
    check(p.active.elapsed < 500, name + " restart resets time and lives");
    const target = p.active.cells.findIndex((v) => !v);
    await mode(page, !!p.active.puzzle.answer[target]);
    await page.locator(`[data-cell="${target}"]`).tap();
    p = await waitProfile(page, (p) => p.active.cells[target] !== 0);
    await page
      .waitForFunction(
        () => window.inputFrames.some((f) => /filled|crossed/.test(f.after)),
        null,
        { timeout: 2000 },
      )
      .catch(async (error) => {
        console.log(
          "FRAME DEBUG",
          await page.evaluate(() => window.inputFrames),
        );
        throw error;
      });
    check(
      await page.evaluate(() =>
        window.inputFrames.some((f) => /filled|crossed/.test(f.after)),
      ),
      name + " accepted input is visible in the first two animation frames",
    );
    const id = p.active.id,
      cells = p.active.cells;
    await page.reload();
    await page.getByRole("button", { name: /^Continue/ }).tap();
    p = await profile(page);
    check(
      p.active.id === id &&
        JSON.stringify(p.active.cells) === JSON.stringify(cells),
      name + " exact saved attempt restores",
    );
    await page.screenshot({ path: `${output}/${name}-game.png` });
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    await page.waitForTimeout(700);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await page.getByRole("button", { name: "Resume", exact: true }).tap();
    check(true, name + " interruptions require resume");
    p = await solve(page);
    check(
      p.active.counted && p.stats["standard:easy"].wins === 1,
      name + " winning finalizes statistics once",
    );
    check(
      (await page.locator(".result-panel button").count()) === 2,
      name + " completion offers replay and next only",
    );
    await page.waitForTimeout(300);
    const nextRect = await page
      .getByRole("button", { name: "Next puzzle", exact: true })
      .boundingBox();
    check(
      nextRect.y + nextRect.height <= 932,
      name + " completion actions visible without scrolling",
    );
    await page.screenshot({ path: `${output}/${name}-complete.png` });
    await page.getByRole("button", { name: "Replay", exact: true }).tap();
    await waitProfile(
      page,
      (p) =>
        p.active.status === "playing" &&
        p.active.cells.every((cell) => cell === 0),
    );
    await solve(page);
    p = await profile(page);
    check(
      p.stats["standard:easy"].completed === 1 &&
        p.stats["standard:easy"].wins === 2,
      name + " replay does not duplicate unique completion",
    );
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await page.getByRole("button", { name: "Statistics", exact: true }).tap();
    check(
      (await page.locator(".stat").count()) === 6,
      name + " six statistics fit layout",
    );
    await page.screenshot({ path: `${output}/${name}-stats.png` });
    await page.getByRole("button", { name: "Close dialog" }).tap();
    await page.getByRole("button", { name: "Settings", exact: true }).tap();
    await page
      .getByRole("switch", { name: "Reduce motion", exact: true })
      .tap();
    check(
      await page.getByRole("switch", { name: "Reduce motion" }).isVisible(),
      name + " reduce motion remains visible",
    );

    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page.getByRole("button", { name: "Close dialog" }).tap();
    await page.getByRole("button", { name: "New game", exact: true }).tap();
    const completedBeforeRuleChange = await profile(page);
    await page.getByRole("switch", { name: "Relaxed mode" }).tap();
    check(
      (await profile(page)).active.id === completedBeforeRuleChange.active.id,
      name + " difficulty rule switch preserves the completed attempt",
    );
    await page.getByRole("button", { name: "Back to home" }).tap();
    for (const size of [10, 15]) {
      p = await start(page, size);
      check(
        p.active.rules === "relaxed",
        name + " relaxed rule applies to new " + size + " board",
      );
      check(
        (await page.getByRole("gridcell").count()) === size * size,
        name + " " + size + " board renders",
      );
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name + " " + size + " board fits phone",
      );
      check(
        (await page.getByRole("button", { name: /zoom/i }).count()) === 0,
        name + " board has no zoom controls",
      );
      check(
        await page
          .locator(".clue")
          .first()
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 11),
        name + " clues retain a readable native font",
      );
    }
    await page.screenshot({ path: `${output}/${name}-hard-dark.png` });
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("button", { name: /^Continue/ }).tap();
    p = await profile(page);
    check(
      p.active.puzzle.size === 15,
      name + " offline launch restores large puzzle",
    );
    await start(page, 5);
    check(
      (await profile(page)).active.puzzle.size === 5,
      name + " fresh generation works offline",
    );
    await page.screenshot({ path: `${output}/${name}-offline.png` });
    const manifest = await page.evaluate(() =>
      fetch("/manifest.webmanifest").then((r) => r.json()),
    );
    check(
      manifest.display === "fullscreen" && manifest.orientation === "any",
      name + " home screen manifest",
    );
    await page.setViewportSize({ width: 320, height: 640 });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name + " 320px narrow screen has no overflow",
    );
    check(
      errors.length === 0,
      name + " no browser errors: " + errors.join("; "),
    );
  } finally {
    await h.close();
  }
}
console.log(checks + " browser checks passed");
