import assert from "node:assert/strict";
import { harness } from "./support.mjs";
import { build } from "esbuild";
await build({
  entryPoints: [
    "src/core/profile.ts",
    "src/core/puzzle.ts",
    "src/core/session.ts",
  ],
  outdir: "/tmp/nonogram-edge",
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
});
const { freshProfile } = await import("/tmp/nonogram-edge/profile.mjs"),
  { makePuzzle } = await import("/tmp/nonogram-edge/puzzle.mjs"),
  { begin } = await import("/tmp/nonogram-edge/session.mjs");
const h = await harness(),
  b = h.browser,
  context = await b.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
  }),
  page = await context.newPage();
let count = 0;
function check(condition, message) {
  assert.ok(condition, message);
  console.log("PASS", message);
  count++;
}
async function read() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("nonogram-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            get = db
              .transaction("profile")
              .objectStore("profile")
              .get("current");
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
        };
      }),
  );
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    const p = await read();
    if (p && predicate(p)) return p;
    await page.waitForTimeout(25);
  }
  throw Error("Timeout");
}
async function write(profile) {
  await page.evaluate(
    (p) =>
      new Promise((resolve) => {
        const r = indexedDB.open("nonogram-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("profile", "readwrite");
          tx.objectStore("profile").put(p, "current");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    profile,
  );
  await page.reload();
  await page.getByRole("button", { name: /^Continue/ }).tap();
}
const pattern = [
  0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0,
];
const fixture = () => {
  const p = freshProfile();
  p.preferences.effects = false;
  p.active = begin(makePuzzle(pattern, 5), "standard", "easy");
  return p;
};
try {
  await page.addInitScript(() => {
    const Original = window.Audio;
    window.testAudio = [];
    window.Audio = function () {
      const a = new Original();
      window.testAudio.push(a);
      return a;
    };
  });
  await page.goto(h.base);
  await page
    .getByText("Ready offline", { exact: true })
    .waitFor({ timeout: 60000 });
  await write(fixture());
  let rect = await page.locator('[data-cell="10"]').boundingBox(),
    last = await page.locator('[data-cell="14"]').boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, {
    steps: 1,
  });
  await page.mouse.up();
  let p = await until((p) =>
    p.active.cells.slice(10, 15).every((v) => v === 1),
  );
  check(
    p.active.lives === 3,
    "drag fills a contiguous row without duplicate moves",
  );
  await write(fixture());
  rect = await page.locator('[data-cell="0"]').boundingBox();
  last = await page.locator('[data-cell="4"]').boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, {
    steps: 1,
  });
  await page.mouse.up();
  p = await until((p) => p.active.lives === 2);
  check(
    p.active.cells.every((v) => v === 0),
    "first mistake stops a stroke and costs one life",
  );
  await write(fixture());
  rect = await page.locator('[data-cell="4"]').boundingBox();
  last = await page.locator('[data-cell="2"]').boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
  await page.mouse.up();
  p = await until((p) => p.active.lives === 2);
  check(
    p.active.cells.every((v) => v === 0),
    "right-to-left stroke checks its starting square first",
  );
  const v = await page.locator(".board-viewport").boundingBox();
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })),
    });
  await touch("touchStart", [
    [v.x + 100, v.y + 100],
    [v.x + 200, v.y + 100],
  ]);
  await touch("touchMove", [
    [v.x + 70, v.y + 100],
    [v.x + 230, v.y + 100],
  ]);
  await touch("touchEnd", []);
  await page.waitForTimeout(150);
  check(
    await page
      .locator(".puzzle-grid")
      .evaluate((e) => getComputedStyle(e).transform === "none"),
    "two-finger gesture does not zoom the board",
  );
  check(
    (await read()).active.lives === 2,
    "two-finger gesture does not play squares",
  );

  await write(fixture());
  rect = await page.locator('[data-cell="10"]').boundingBox();
  const point = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  await touch("touchStart", [point]);
  await touch("touchStart", [point, [210, 30]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(100);
  check(
    (await read()).active.cells.every((v) => v === 0),
    "second finger outside the board cancels the pending stroke",
  );
  await page.mouse.click(point[0], point[1], { button: "right" });
  check(
    (await read()).active.cells.every((v) => v === 0),
    "right mouse button does not play a square",
  );
  await page.mouse.move(...point);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  check(
    (await read()).active.cells.every((v) => v === 0),
    "interrupted stroke does not commit on release",
  );
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  p = await read();
  const previousId = p.active.id;
  await page.evaluate(() => {
    window.RealWorker = window.Worker;
    window.Worker = class {
      constructor() {
        throw new Error("Worker unavailable");
      }
    };
  });
  await page.getByRole("button", { name: "New game", exact: true }).tap();
  await page
    .getByRole("button", { name: "Discard previous run", exact: true })
    .tap();
  await page.getByRole("button", { name: /Medium/ }).tap();
  p = await until((p) => p.active?.puzzle.size === 10);
  check(
    p.active.puzzle.seed.startsWith("reserve-"),
    "verified reserve handles unavailable workers",
  );
  await page.getByRole("button", { name: "Menu", exact: true }).tap();
  await page.evaluate(() => {
    window.Worker = class {
      terminate() {}
      postMessage() {}
    };
  });
  await page.getByRole("button", { name: "New game", exact: true }).tap();
  await page
    .getByRole("button", { name: "Discard previous run", exact: true })
    .tap();
  await page.getByRole("button", { name: /Hard/ }).tap();
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await page.waitForTimeout(3200);
  check(
    (await read()).active === null,
    "cancelled and stale generation do not restore the discarded attempt",
  );
  await page.getByRole("button", { name: "Back to home" }).tap();
  await page.waitForTimeout(100);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("nonogram-profile", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("profile", "readwrite"),
            s = tx.objectStore("profile");
          s.put({ broken: true }, "current");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page
    .getByText("Your save was recovered from its backup.", { exact: true })
    .waitFor();
  check(true, "damaged primary save recovers from backup");
  const separate = await b.newContext();
  const noStorage = await separate.newPage();
  await noStorage.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await noStorage.goto(h.base);
  await noStorage
    .getByText(
      "Saving is unavailable. Keep this tab open to retain your progress.",
      { exact: true },
    )
    .waitFor();
  await noStorage
    .getByRole("button", { name: "New game", exact: true })
    .click();
  check(
    await noStorage.getByRole("button", { name: /Easy/ }).isVisible(),
    "storage failure reports limitation without blocking play",
  );
  await separate.close();
  console.log(count + " edge browser checks passed");
} finally {
  await h.close();
}
