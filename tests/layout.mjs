import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { harness, fit } from "./support.mjs";
const generated = await mkdtemp(tmpdir() + "/nonogram-layout-");
await build({
  entryPoints: ["src/core/profile.ts", "src/core/session.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: generated,
  outExtension: { ".js": ".mjs" },
});
const profiles = await import(pathToFileURL(generated + "/profile.mjs")),
  sessions = await import(pathToFileURL(generated + "/session.mjs"));
const reserves = JSON.parse(
    await readFile("public/data/reserves.json", "utf8"),
  ),
  boards = [5, 10, 15].map((size) => reserves.find((p) => p.size === size));
const h = await harness();
let checks = 0;
try {
  await mkdir("docs/previews", { recursive: true });
  for (const [width, height, dpr, touch] of [
    [375, 667, 3, true],
    [390, 844, 3, true],
    [430, 932, 3, true],
    [768, 1024, 2, true],
    [1024, 768, 2, true],
    [1366, 768, 1, false],
    [1920, 1080, 1.25, false],
    [2560, 1440, 2, false],
    [3840, 2160, 1, false],
  ]) {
    const context = await h.browser.newContext({
      serviceWorkers: "block",
      viewport: { width, height },
      deviceScaleFactor: dpr,
      hasTouch: touch,
      isMobile: touch,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      for (const theme of ["light", "dark"]) {
        await page.goto(h.base);
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: theme === "light" ? "Light" : "Dark",
            exact: true,
          })
          .click();
        await fit(page, `${width} ${theme} all settings`);
        assert.equal(await page.locator(".settings-tabs").count(), 0);
        assert(
          await page
            .getByRole("switch", { name: "Sound effects", exact: true })
            .isVisible(),
        );
        assert(
          await page.getByLabel("Effects volume", { exact: true }).isVisible(),
        );
        checks++;
        await page.getByRole("button", { name: "Close dialog" }).click();
        await fit(page, `${width} ${theme} menu`);
        checks++;
        if (width === 375 || width === 1920)
          await page.screenshot({
            path: `docs/previews/polish-${h.engine}-${width}-${theme}-home.png`,
          });
        await page
          .getByRole("button", { name: "Statistics", exact: true })
          .click();
        await fit(page, `${width} statistics`);
        assert(
          await page
            .getByRole("dialog", { name: "Statistics", exact: true })
            .isVisible(),
        );
        checks++;
        await page.getByRole("button", { name: "Close dialog" }).click();
        await page
          .getByRole("button", { name: /^(How to play|Learn to play)$/ })
          .click();
        await fit(page, `${width} lesson1`);
        if (width === 375 || width === 1920)
          await page.screenshot({
            path: `docs/previews/polish-${h.engine}-${width}-${theme}-tutorial.png`,
          });
        checks++;
        for (let i = 1; i <= 3; i++)
          await page
            .getByRole("button", { name: `Practice square ${i}` })
            .click();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await fit(page, `${width} lesson2`);
        checks++;
        await page.getByRole("button", { name: "Practice square 1" }).click();
        await page.getByRole("button", { name: "Cross", exact: true }).click();
        await page.getByRole("button", { name: "Practice square 2" }).click();
        await page.getByRole("button", { name: "Fill", exact: true }).click();
        await page.getByRole("button", { name: "Practice square 3" }).click();
        await page.getByRole("button", { name: "Next", exact: true }).click();
        await fit(page, `${width} lesson3`);
        checks++;
        await page.getByRole("button", { name: "Close dialog" }).click();
        await page
          .getByRole("button", { name: "New game", exact: true })
          .click();
        if (
          await page
            .getByRole("button", { name: "Discard previous run", exact: true })
            .count()
        )
          await page
            .getByRole("button", { name: "Discard previous run", exact: true })
            .click();
        await fit(page, `${width} difficulty`);
        if (width === 375 || width === 1920)
          await page.screenshot({
            path: `docs/previews/polish-${h.engine}-${width}-${theme}-difficulty.png`,
          });
        checks++;
        await page.getByRole("button", { name: "Back to home" }).click();
        for (const [board, rules] of boards.flatMap((board) => [
          [board, "standard"],
          [board, "relaxed"],
        ])) {
          const profile = profiles.freshProfile();
          profile.preferences.theme = theme;
          profile.preferences.effects = false;
          profile.preferences.reduceMotion = true;
          profile.active = sessions.begin(board, rules, board.difficulty);
          await page.goto(h.base + "/__test__/effects.html");
          await page.evaluate(
            (profile) =>
              new Promise((resolve) => {
                const r = indexedDB.open("nonogram-profile", 1);
                r.onupgradeneeded = () => r.result.createObjectStore("profile");
                r.onsuccess = () => {
                  const db = r.result,
                    t = db.transaction("profile", "readwrite");
                  t.objectStore("profile").put(profile, "current");
                  t.oncomplete = () => {
                    db.close();
                    resolve();
                  };
                };
              }),
            profile,
          );
          await page.goto(h.base);
          await page.getByRole("button", { name: /Continue puzzle/ }).click();
          await page.locator('[data-cell="0"]').waitFor();
          await fit(
            page,
            `${width} ${theme} ${board.difficulty} ${rules} board`,
          );
          checks++;
          assert.equal(
            await page.locator("[data-cell]").count(),
            board.size ** 2,
          );
          const dock = await page.locator(".play-dock").boundingBox();
          const first = await page.locator('[data-cell="0"]').boundingBox();
          const last = await page
            .locator(`[data-cell="${board.size - 1}"]`)
            .boundingBox();
          assert(
            Math.abs(dock.x - first.x) < 1,
            "Mode switch aligns with grid left edge",
          );
          assert(
            Math.abs(dock.x + dock.width - last.x - last.width) < 1,
            "Mode switch aligns with grid right edge",
          );
          const clipped = await page.locator(".clue").evaluateAll((clues) =>
            clues
              .filter((el) => {
                const a = el.getBoundingClientRect();
                return [...el.querySelectorAll(".clue-values span")].some(
                  (span) => {
                    const r = span.getBoundingClientRect();
                    return (
                      r.left < a.left - 0.5 ||
                      r.right > a.right + 0.5 ||
                      r.top < a.top - 0.5 ||
                      r.bottom > a.bottom + 0.5
                    );
                  },
                );
              })
              .map((el) => el.textContent),
          );
          assert.deepEqual(
            clipped,
            [],
            `${width} ${board.size} clues fit their rails`,
          );
          checks++;
          if (width >= 1366) {
            const rect = await page.locator("main").boundingBox();
            assert(rect.width / width >= 0.27 && rect.width / width <= 0.4);
          }
          if (
            (width === 430 || width === 1920) &&
            board.difficulty === "medium"
          )
            await page.screenshot({
              path: `docs/previews/${h.engine}-${width}-${theme}.png`,
            });
        }
        await page.getByRole("button", { name: "Pause puzzle" }).click();
        await fit(page, `${width} pause`);
        checks++;
        if (width === 430 && touch) {
          await page
            .getByRole("button", { name: "Resume", exact: true })
            .click();
          await page.setViewportSize({ width: 932, height: 430 });
          await page
            .getByRole("alertdialog", { name: "Turn your phone upright" })
            .waitFor();
          await page.setViewportSize({ width, height });
          await page
            .getByRole("heading", { name: "Paused", exact: true })
            .waitFor();
          checks++;
        }
        await page.getByRole("button", { name: "Menu", exact: true }).click();
      }
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${h.engine} ${width}x${height} DPR ${dpr} all sizes, themes, dialogs`,
      );
    } finally {
      await context.close();
    }
  }
  console.log(`${checks} ${h.engine} layout checks passed`);
} finally {
  await h.close();
  await rm(generated, { recursive: true, force: true });
}
