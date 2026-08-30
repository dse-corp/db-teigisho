import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import puppeteer from "puppeteer";

const viewerScript = await readFile(
  new URL("../src/db_teigisho/templates/er_viewer.js", import.meta.url),
  "utf8",
);
const detailsScript = await readFile(
  new URL("../src/db_teigisho/templates/er_details.js", import.meta.url),
  "utf8",
);

const graph = {
  format_version: "1.0",
  tables: [
    {
      id: "table_1",
      physical_name: "customers",
      logical_name: "顧客",
      description: "顧客情報を管理する日本語の長い説明。".repeat(12),
      indexes: [
        {
          name: "uq_customers_identity",
          type: "btree",
          unique: true,
          columns: [
            { name: "customer_id", order: "ASC" },
            { name: "name", order: "DESC" },
          ],
          include_columns: [],
          where: null,
        },
      ],
      foreign_keys: [],
      columns: [
        {
          id: "table_1_column_1",
          physical_name: "customer_id",
          logical_name: "顧客ID",
          data_type: "uuid",
          length: null,
          scale: null,
          default: "",
          not_null: true,
          unique: true,
          primary_key: true,
          description: "顧客を一意に識別する。",
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
          unique: false,
          primary_key: false,
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
      indexes: [],
      foreign_keys: [
        {
          name: "fk_orders_customers",
          columns: ["customer_id", "amount"],
          referenced_table: "customers",
          referenced_columns: ["customer_id", "name"],
          on_update: "NO ACTION",
          on_delete: "RESTRICT",
          deferrable: false,
        },
      ],
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
          unique: false,
          primary_key: true,
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
          unique: false,
          primary_key: false,
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
          unique: false,
          primary_key: false,
          description: null,
          key_roles: [],
        },
      ],
    },
    {
      id: "table_3",
      physical_name: "products",
      logical_name: "商品",
      description: null,
      indexes: [],
      foreign_keys: [],
      columns: [
        {
          id: "table_3_column_1",
          physical_name: "product_id",
          logical_name: "商品ID",
          data_type: "uuid",
          length: null,
          scale: null,
          default: null,
          not_null: true,
          unique: true,
          primary_key: true,
          description: null,
          key_roles: ["PK"],
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
        {
          parent_column_id: "table_1_column_2",
          child_column_id: "table_2_column_3",
        },
      ],
      parent_cardinality: "exactly_one",
      child_cardinality: "zero_or_many",
      relationship_type: "non_identifying",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      deferrable: false,
    },
    {
      id: "relationship_2",
      name: "fk_products_orders",
      parent_table_id: "table_2",
      child_table_id: "table_3",
      column_pairs: [],
      parent_cardinality: "exactly_one",
      child_cardinality: "zero_or_many",
      relationship_type: "non_identifying",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      deferrable: false,
    },
    {
      id: "relationship_3",
      name: "fk_customers_parent",
      parent_table_id: "table_1",
      child_table_id: "table_1",
      column_pairs: [],
      parent_cardinality: "zero_or_one",
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
    .er-canvas { display: block; width: 100%; height: 100%; }
    .er-detail-panel {
      position: absolute; inset: 12px 12px auto auto; overflow: auto;
      width: 360px; max-height: 200px;
    }
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
      <aside id="dbdef-er-details" class="er-detail-panel" aria-live="polite"
        aria-labelledby="dbdef-er-details-title" hidden>
        <button id="dbdef-er-details-close" type="button">閉じる</button>
        <p id="dbdef-er-details-kind"></p>
        <h3 id="dbdef-er-details-title"></h3>
        <div id="dbdef-er-details-body"></div>
      </aside>
      <img class="er-diagram-fallback" alt="静的ER図"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">
    </div>
  </section>
  <script id="dbdef-er-graph" type="application/json">${JSON.stringify(graph)}</script>
  <script>${viewerScript}</script>
  <script>${detailsScript}</script>
</body>
</html>`;

let browser;
let page;
const pageErrors = [];

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  page.on("pageerror", (error) => pageErrors.push(String(error)));
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
  assert.deepEqual(pageErrors, []);
  assert.equal(await page.$$eval(".er-node", (nodes) => nodes.length), 3);
  assert.equal(await page.$$eval(".er-edge", (edges) => edges.length), 3);
  assert.equal(await page.$$eval(".er-column-row", (rows) => rows.length), 6);

  await page.click('[data-er-mode="keys"]');
  assert.equal(await page.$$eval(".er-column-row", (rows) => rows.length), 4);
  assert.equal(await page.$eval('[data-er-mode="keys"]', (button) => button.ariaPressed), "true");

  await page.click('[data-er-mode="tables"]');
  assert.equal(await page.$$eval(".er-column-row", (rows) => rows.length), 0);
  assert.equal(
    await page.evaluate(() => window.dbdefErViewer.getState().mode),
    "tables",
  );
});

test("opens table and column details by mouse with exact special values", async () => {
  await page.evaluate(() => window.dbdefErViewer.setMode("all"));
  await page.click('[data-table-id="table_1"] .er-node-physical');
  assert.deepEqual(pageErrors, []);
  const tableDetails = await page.evaluate(() => ({
    hidden: document.querySelector("#dbdef-er-details").hidden,
    kind: document.querySelector("#dbdef-er-details-kind").textContent,
    title: document.querySelector("#dbdef-er-details-title").textContent,
    body: document.querySelector("#dbdef-er-details-body").textContent,
    selected: document.querySelector('[data-table-id="table_1"]').classList.contains(
      "er-detail-table-selected",
    ),
  }));
  assert.equal(tableDetails.hidden, false);
  assert.equal(tableDetails.kind, "テーブル詳細");
  assert.equal(tableDetails.title, "customers / 顧客");
  assert.match(tableDetails.body, /カラム数\s*2/);
  assert.match(tableDetails.body, /uq_customers_identity/);
  assert.match(tableDetails.body, /customer_id ASC, name DESC/);
  assert.match(tableDetails.body, /顧客情報を管理する日本語の長い説明。/);
  assert.equal(tableDetails.selected, true);
  await page.evaluate(() => window.dbdefErViewer.setViewport({ scale: 1 }));
  const panel = await page.$("#dbdef-er-details");
  const panelBox = await panel.boundingBox();
  await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
  await page.mouse.wheel({ deltaY: 120 });
  assert.equal(
    await page.evaluate(() => window.dbdefErViewer.getState().viewport.scale),
    1,
  );

  await page.click('[data-column-id="table_1_column_1"] .er-column-name');
  const columnDetails = await page.evaluate(() => ({
    kind: document.querySelector("#dbdef-er-details-kind").textContent,
    title: document.querySelector("#dbdef-er-details-title").textContent,
    body: document.querySelector("#dbdef-er-details-body").textContent,
    selected: document.querySelector(
      '[data-column-id="table_1_column_1"]',
    ).getAttribute("aria-selected"),
  }));
  assert.equal(columnDetails.kind, "カラム詳細");
  assert.equal(columnDetails.title, "customer_id / 顧客ID");
  assert.match(columnDetails.body, /Default\s*""/);
  assert.match(columnDetails.body, /NN\s*あり/);
  assert.match(columnDetails.body, /Unique\s*あり/);
  assert.match(columnDetails.body, /PK\s*あり/);
  assert.equal(columnDetails.selected, "true");

  await page.click('[data-table-id="table_2"] .er-node-physical');
  assert.match(
    await page.$eval("#dbdef-er-details-body", (element) => element.textContent),
    /fk_orders_customers.*customer_id, amount.*customers\(customer_id, name\)/s,
  );
  assert.equal(
    await page.$eval(
      '[data-column-id="table_1_column_1"]',
      (element) => element.getAttribute("aria-selected"),
    ),
    "false",
  );
  assert.equal(
    await page.$eval(
      '[data-table-id="table_2"] [data-er-detail-target="table"]',
      (element) => element.getAttribute("tabindex"),
    ),
    "0",
  );
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tableId), "table_2");
});

test("highlights the selected table, related tables, and connecting lines", async () => {
  await page.evaluate(() => window.dbdefErViewer.setMode("all"));
  await page.click('[data-table-id="table_1"] .er-node-physical');

  const highlighted = await page.evaluate(() => ({
    active: document.querySelector("#dbdef-er-viewer").classList.contains(
      "er-relationship-selection-active",
    ),
    selected: document.querySelector('[data-table-id="table_1"]').className.baseVal,
    related: document.querySelector('[data-table-id="table_2"]').className.baseVal,
    unrelated: document.querySelector('[data-table-id="table_3"]').className.baseVal,
    directEdge: document.querySelector(
      '[data-relationship-id="relationship_1"]',
    ).className.baseVal,
    unrelatedEdge: document.querySelector(
      '[data-relationship-id="relationship_2"]',
    ).className.baseVal,
    selfEdge: document.querySelector(
      '[data-relationship-id="relationship_3"]',
    ).className.baseVal,
    directLabel: document.querySelector(
      '[data-relationship-label-id="relationship_1"]',
    ).className.baseVal,
    unrelatedLabel: document.querySelector(
      '[data-relationship-label-id="relationship_2"]',
    ).className.baseVal,
  }));
  assert.equal(highlighted.active, true);
  assert.match(highlighted.selected, /\ber-relationship-selected\b/);
  assert.match(highlighted.related, /\ber-relationship-related\b/);
  assert.match(highlighted.unrelated, /\ber-relationship-dimmed\b/);
  assert.match(highlighted.directEdge, /\ber-relationship-connected\b/);
  assert.match(highlighted.unrelatedEdge, /\ber-relationship-dimmed\b/);
  assert.match(highlighted.selfEdge, /\ber-relationship-connected\b/);
  assert.match(highlighted.directLabel, /\ber-relationship-connected\b/);
  assert.match(highlighted.unrelatedLabel, /\ber-relationship-dimmed\b/);

  await page.click('[data-column-id="table_1_column_1"] .er-column-name');
  assert.equal(
    await page.$eval(
      "#dbdef-er-viewer",
      (viewer) => viewer.querySelectorAll(
        ".er-relationship-selected, .er-relationship-related, " +
        ".er-relationship-connected, .er-relationship-dimmed",
      ).length,
    ),
    0,
  );

  await page.click('[data-table-id="table_1"] .er-node-physical');
  await page.click("#dbdef-er-details-close");
  assert.equal(
    await page.$eval(
      "#dbdef-er-viewer",
      (viewer) => viewer.classList.contains("er-relationship-selection-active"),
    ),
    false,
  );
});

test("supports roving keyboard selection, ARIA linkage, Escape, and close", async () => {
  await page.evaluate(() => window.dbdefErViewer.setMode("all"));
  await page.$eval(
    '[data-table-id="table_1"] [data-er-detail-target="table"]',
    (target) => target.focus(),
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.columnId),
    "table_1_column_1",
  );
  await page.keyboard.press("Enter");
  const aria = await page.evaluate(() => {
    const target = document.activeElement;
    return {
      role: target.getAttribute("role"),
      selected: target.getAttribute("aria-selected"),
      controls: target.getAttribute("aria-controls"),
      panelRole: document.querySelector("#dbdef-er-details").getAttribute("role"),
    };
  });
  assert.deepEqual(aria, {
    role: "option",
    selected: "true",
    controls: "dbdef-er-details",
    panelRole: "region",
  });

  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#dbdef-er-details", (panel) => panel.hidden), true);
  assert.equal(
    await page.$eval(
      '[data-column-id="table_1_column_1"]',
      (target) => target.getAttribute("aria-selected"),
    ),
    "false",
  );

  await page.keyboard.press("Enter");
  await page.click("#dbdef-er-details-close");
  assert.equal(await page.$eval("#dbdef-er-details", (panel) => panel.hidden), true);
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.columnId),
    "table_1_column_1",
  );
});

test("keeps table selection and removes hidden columns from selection in table-only mode", async () => {
  await page.evaluate(() => window.dbdefErViewer.setMode("all"));
  await page.click('[data-table-id="table_1"] .er-node-physical');
  await page.click('[data-er-mode="tables"]');
  assert.equal(await page.$eval("#dbdef-er-details", (panel) => panel.hidden), false);
  assert.equal(
    await page.$eval("#dbdef-er-details-title", (title) => title.textContent),
    "customers / 顧客",
  );
  assert.equal(await page.$$eval("[data-column-id]", (rows) => rows.length), 0);

  await page.evaluate(() => window.dbdefErViewer.setMode("all"));
  await page.click('[data-column-id="table_1_column_2"] .er-column-name');
  await page.click('[data-er-mode="tables"]');
  assert.equal(await page.$eval("#dbdef-er-details", (panel) => panel.hidden), true);
  assert.equal(
    await page.$$eval('[data-er-detail-target="column"]', (targets) => targets.length),
    0,
  );
  assert.equal(
    await page.$$eval('[data-er-detail-target="table"][tabindex="0"]', (targets) => targets.length),
    1,
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
