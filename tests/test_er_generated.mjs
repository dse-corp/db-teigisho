import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import puppeteer from "puppeteer";

const generated = process.env.DBDEF_GENERATED_HTML;

test("generated offline HTML preserves Python geometry, editing, storage, and fallback", {
  skip: !generated,
}, async () => {
  const browser = await puppeteer.launch({
    headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) {
        external.push(request.url());
        request.abort();
      } else {
        request.continue();
      }
    });
    const url = pathToFileURL(resolve(generated)).href;
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => Boolean(window.dbdefErAutoLayout));
    const initial = await page.evaluate(() => {
      const graph = window.dbdefErViewer.getGraph();
      const geometry = JSON.parse(document.querySelector("#dbdef-er-geometry").textContent);
      const expected = Object.fromEntries(graph.tables.map((table) => {
        const node = geometry.modes.all[table.id];
        return [table.id, { x: node.x, y: node.y }];
      }));
      return { graph, expected, geometry, state: window.dbdefErViewer.getState() };
    });
    assert.deepEqual(initial.state.nodePositions, initial.expected);
    const tableId = initial.graph.tables[0].id;
    for (const mode of ["keys", "tables", "all"]) {
      await page.click(`[data-er-mode="${mode}"]`);
      const layout = await page.evaluate(() => ({
        sizes: window.dbdefErViewer.getGraph().tables.map((table) => [
          table.id, window.dbdefErViewer.getNodeSize(table.id, window.dbdefErViewer.getState().mode),
        ]),
        clipped: Array.from(document.querySelectorAll(".er-node text")).filter((element) => {
          const box = element.getBBox();
          const node = element.closest(".er-node");
          const size = window.dbdefErViewer.getNodeSize(node.dataset.tableId,
            window.dbdefErViewer.getState().mode);
          return box.x < 0 || box.y < 0 || box.x + box.width > size.width + 1 ||
            box.y + box.height > size.height + 1;
        }).map((element) => element.textContent),
      }));
      for (const [id, size] of layout.sizes) {
        const expected = initial.geometry.modes[mode][id];
        assert.deepEqual(size, { width: expected.width, height: expected.height });
      }
      assert.deepEqual(layout.clipped, []);
    }
    await page.click('[data-er-action="maximize"]');
    if (process.env.DBDEF_SCREENSHOT) {
      await page.screenshot({ path: process.env.DBDEF_SCREENSHOT, fullPage: true });
    }
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.dbdefErViewer.setViewport({ scale: 1, x: 40, y: 40 });
      document.querySelector("#er-diagram").scrollIntoView();
    });
    const header = await page.$(`[data-table-id="${tableId}"] .er-node-header`);
    const box = await header.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 70, { steps: 4 });
    await page.mouse.up();
    const moved = await page.evaluate((id) => window.dbdefErViewer.getNodePosition(id), tableId);
    assert.deepEqual(moved, { x: initial.expected[tableId].x + 80, y: initial.expected[tableId].y + 50 });
    await page.click('[data-er-edge-routing="orthogonal"]');
    const handle = await page.$("[data-er-edge-handle-id]");
    assert.ok(handle);
    await handle.evaluate((element) => element.focus());
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const routing = await page.evaluate(() => ({
      mode: window.dbdefErEdgeRouting.getRoutingMode(),
      offsets: window.dbdefErEdgeRouting.getRouteOffsets(),
      jumps: window.dbdefErEdgeRouting.getLineJumpsEnabled(),
    }));
    await page.reload();
    await page.waitForFunction(() => Boolean(window.dbdefErAutoLayout));
    assert.deepEqual(await page.evaluate((id) => window.dbdefErViewer.getNodePosition(id), tableId), moved);
    assert.deepEqual(await page.evaluate(() => ({
      mode: window.dbdefErEdgeRouting.getRoutingMode(),
      offsets: window.dbdefErEdgeRouting.getRouteOffsets(),
      jumps: window.dbdefErEdgeRouting.getLineJumpsEnabled(),
    })), routing);
    await page.click('[data-er-action="reset-layout"]');
    assert.deepEqual(await page.evaluate(() => window.dbdefErViewer.getState().nodePositions), initial.expected);
    // Measured rows keep detail selection and accessible targets usable.
    const row = await page.$(".er-column-row");
    await row.evaluate((element) => element.focus());
    await page.keyboard.press("Enter");
    assert.equal(await page.$eval("#dbdef-er-details", (panel) => panel.hidden), false);
    await page.keyboard.press("Escape");
    await page.click('[data-er-layout-direction="top-to-bottom"]');
    await page.click('[data-er-layout-direction="left-to-right"]');
    assert.deepEqual(await page.evaluate(() => window.dbdefErViewer.getState().nodePositions), initial.expected);
    await page.emulateMediaType("print");
    assert.equal(await page.$eval('[data-er-mode="all"].er-diagram-fallback',
      (element) => getComputedStyle(element).display), "block");
    const staticPage = await browser.newPage();
    await staticPage.setJavaScriptEnabled(false);
    await staticPage.goto(url);
    assert.equal(await staticPage.$eval(".er-diagram-fallback", (element) => element.naturalWidth > 0), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
  }
});
