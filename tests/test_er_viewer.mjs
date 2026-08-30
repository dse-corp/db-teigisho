import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import puppeteer from "puppeteer";

const viewerScript = await readFile(
  new URL("../src/db_teigisho/templates/er_viewer.js", import.meta.url),
  "utf8",
);

const graph = {
  format_version: "1.0",
  tables: [
    {
      id: "table_1",
      physical_name: "customers",
      logical_name: "顧客",
      description: null,
      columns: [
        {
          id: "table_1_column_1",
          physical_name: "customer_id",
          logical_name: "顧客ID",
          data_type: "uuid",
          length: null,
          scale: null,
          default: null,
          not_null: true,
          description: null,
          key_roles: ["PK", "UK"],
        },
        {
          id: "table_1_column_2",
          physical_name: "name",
          logical_name: "氏名",
          data_type: "varchar",
          length: 100,
          scale: null,
          default: null,
          not_null: true,
          description: null,
          key_roles: [],
        },
      ],
    },
    {
      id: "table_2",
      physical_name: "orders",
      logical_name: "受注",
      description: null,
      columns: [
        {
          id: "table_2_column_1",
          physical_name: "order_id",
          logical_name: "受注ID",
          data_type: "bigint",
          length: null,
          scale: null,
          default: null,
          not_null: true,
          description: null,
          key_roles: ["PK"],
        },
        {
          id: "table_2_column_2",
          physical_name: "customer_id",
          logical_name: "顧客ID",
          data_type: "uuid",
          length: null,
          scale: null,
          default: null,
          not_null: true,
          description: null,
          key_roles: ["FK"],
        },
        {
          id: "table_2_column_3",
          physical_name: "amount",
          logical_name: "金額",
          data_type: "numeric",
          length: 18,
          scale: 2,
          default: 0,
          not_null: true,
          description: null,
          key_roles: [],
        },
      ],
    },
  ],
  relationships: [
    {
      id: "relationship_1",
      name: "fk_orders_customers",
      parent_table_id: "table_1",
      child_table_id: "table_2",
      column_pairs: [
        {
          parent_column_id: "table_1_column_1",
          child_column_id: "table_2_column_2",
        },
      ],
      parent_cardinality: "exactly_one",
      child_cardinality: "zero_or_many",
      relationship_type: "non_identifying",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      deferrable: false,
    },
  ],
};

const pageHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <style>
    .er-diagram-frame { position: relative; width: 960px; height: 520px; overflow: hidden; }
    .er-viewer { width: 100%; height: 100%; }
    .er-diagram-fallback { display: block; }
    .er-interactive-ready .er-diagram-fallback { display: none; }
    @media print {
      .er-viewer, .er-controls { display: none !important; }
      .er-diagram-fallback { display: block !important; }
    }
  </style>
</head>
<body>
  <section id="er-diagram">
    <div class="er-controls">
      <button type="button" data-er-mode="all" aria-pressed="true">全カラム</button>
      <button type="button" data-er-mode="keys" aria-pressed="false">PK・FKのみ</button>
      <button type="button" data-er-mode="tables" aria-pressed="false">テーブルのみ</button>
      <button type="button" data-er-action="zoom-out">縮小</button>
      <output id="dbdef-er-zoom-level">100%</output>
      <button type="button" data-er-action="zoom-in">拡大</button>
      <button type="button" data-er-action="fit">全体表示</button>
    </div>
    <div class="er-diagram-frame">
      <div id="dbdef-er-viewer" class="er-viewer"></div>
      <img class="er-diagram-fallback" alt="静的ER図"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">
    </div>
  </section>
  <script id="dbdef-er-graph" type="application/json">${JSON.stringify(graph)}</script>
  <script>${viewerScript}</script>
</body>
</html>`;

let browser;
let page;

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.setRequestInterception(true);
  const requests = [];
  page.on("request", (request) => {
    requests.push(request.url());
    request.continue();
  });
  await page.setContent(pageHtml, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.dbdefErViewer));
  assert.ok(requests.every((url) => url.startsWith("data:")));
});

after(async () => {
  await browser.close();
});

test("renders graph data and switches all three display modes", async () => {
  assert.equal(await page.$$eval(".er-node", (nodes) => nodes.length), 2);
  assert.equal(await page.$$eval(".er-edge", (edges) => edges.length), 1);
  assert.equal(await page.$$eval(".er-column-row", (rows) => rows.length), 5);

  await page.click('[data-er-mode="keys"]');
  assert.equal(await page.$$eval(".er-column-row", (rows) => rows.length), 3);
  assert.equal(await page.$eval('[data-er-mode="keys"]', (button) => button.ariaPressed), "true");

  await page.click('[data-er-mode="tables"]');
  assert.equal(await page.$$eval(".er-column-row", (rows) => rows.length), 0);
  assert.equal(
    await page.evaluate(() => window.dbdefErViewer.getState().mode),
    "tables",
  );
});

test("zooms with buttons and wheel within published limits", async () => {
  await page.evaluate(() => window.dbdefErViewer.setViewport({ scale: 1, x: 20, y: 30 }));
  await page.click('[data-er-action="zoom-in"]');
  const buttonScale = await page.evaluate(() => window.dbdefErViewer.getState().viewport.scale);
  assert.ok(buttonScale > 1);

  const frame = await page.$(".er-diagram-frame");
  const box = await frame.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel({ deltaY: 120 });
  const wheelScale = await page.evaluate(() => window.dbdefErViewer.getState().viewport.scale);
  assert.ok(wheelScale < buttonScale);

  const limits = await page.evaluate(() => {
    window.dbdefErViewer.setViewport({ scale: 100 });
    const maximum = window.dbdefErViewer.getState().viewport.scale;
    window.dbdefErViewer.setViewport({ scale: 0.0001 });
    return {
      maximum,
      minimum: window.dbdefErViewer.getState().viewport.scale,
      label: document.querySelector("#dbdef-er-zoom-level").textContent,
    };
  });
  assert.deepEqual(limits, { maximum: 3, minimum: 0.05, label: "5%" });
});

test("pans by dragging and fits the complete graph", async () => {
  await page.evaluate(() => window.dbdefErViewer.setViewport({ scale: 1, x: 0, y: 0 }));
  const frame = await page.$(".er-diagram-frame");
  const box = await frame.boundingBox();
  await page.mouse.move(box.x + 700, box.y + 450);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 390, { steps: 4 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => window.dbdefErViewer.getState().viewport);
  assert.ok(dragged.x < 0);
  assert.ok(dragged.y < 0);

  await page.click('[data-er-action="fit"]');
  const fitted = await page.evaluate(() => window.dbdefErViewer.getState().viewport);
  assert.ok(fitted.scale >= 0.05 && fitted.scale <= 3);
  assert.notEqual(fitted.x, dragged.x);
});

test("publishes stable node-coordinate and edge-redraw boundaries", async () => {
  const result = await page.evaluate(() => {
    const viewer = document.querySelector("#dbdef-er-viewer");
    const events = [];
    viewer.addEventListener("dbdef:er-node-position-change", (event) => {
      events.push({ type: event.type, detail: event.detail });
    });
    viewer.addEventListener("dbdef:er-edges-redrawn", (event) => {
      events.push({ type: event.type, detail: event.detail });
    });
    const edge = document.querySelector('[data-relationship-id="relationship_1"]');
    const before = edge.getAttribute("d");
    window.dbdefErViewer.setNodePosition("table_2", { x: 720, y: 310 });
    const after = edge.getAttribute("d");
    const position = window.dbdefErViewer.getNodePosition("table_2");
    window.dbdefErViewer.setEdgePathRenderer(() => "M 1 2 L 3 4");
    window.dbdefErViewer.redrawEdges();
    return {
      before,
      after,
      custom: edge.getAttribute("d"),
      position,
      eventTypes: events.map((event) => event.type),
    };
  });

  assert.notEqual(result.before, result.after);
  assert.equal(result.custom, "M 1 2 L 3 4");
  assert.deepEqual(result.position, { x: 720, y: 310 });
  assert.ok(result.eventTypes.includes("dbdef:er-node-position-change"));
  assert.ok(result.eventTypes.includes("dbdef:er-edges-redrawn"));
});

test("keeps the static SVG fallback for print and disabled JavaScript", async () => {
  await page.emulateMediaType("print");
  const printDisplay = await page.evaluate(() => ({
    fallback: getComputedStyle(document.querySelector(".er-diagram-fallback")).display,
    viewer: getComputedStyle(document.querySelector(".er-viewer")).display,
  }));
  assert.equal(printDisplay.fallback, "block");
  assert.equal(printDisplay.viewer, "none");
  await page.emulateMediaType("screen");

  const noScriptPage = await browser.newPage();
  await noScriptPage.setJavaScriptEnabled(false);
  await noScriptPage.setContent(pageHtml, { waitUntil: "load" });
  assert.equal(
    await noScriptPage.$eval(".er-diagram-fallback", (element) => getComputedStyle(element).display),
    "block",
  );
  await noScriptPage.close();
});
