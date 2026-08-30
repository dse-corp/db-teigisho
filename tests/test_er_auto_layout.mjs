import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import puppeteer from "puppeteer";

const viewerScript = await readFile(
  new URL("../src/db_teigisho/templates/er_viewer.js", import.meta.url),
  "utf8",
);
const layoutScript = await readFile(
  new URL("../src/db_teigisho/templates/er_layout.js", import.meta.url),
  "utf8",
);
const autoLayoutScript = await readFile(
  new URL("../src/db_teigisho/templates/er_auto_layout.js", import.meta.url),
  "utf8",
).catch(() => "");
const layoutStyles = await readFile(
  new URL("../src/db_teigisho/templates/er_layout.css", import.meta.url),
  "utf8",
);
const autoLayoutStyles = await readFile(
  new URL("../src/db_teigisho/templates/er_auto_layout.css", import.meta.url),
  "utf8",
).catch(() => "");
const detailsScript = await readFile(
  new URL("../src/db_teigisho/templates/er_details.js", import.meta.url),
  "utf8",
);
const detailsStyles = await readFile(
  new URL("../src/db_teigisho/templates/er_details.css", import.meta.url),
  "utf8",
);

function table(id, columnCount = 1) {
  return {
    id,
    physical_name: id,
    logical_name: id,
    description: null,
    columns: Array.from({ length: columnCount }, (_, index) => ({
      id: `${id}_column_${index}`,
      physical_name: `column_${index}`,
      logical_name: `column_${index}`,
      data_type: "uuid",
      length: null,
      scale: null,
      default: null,
      not_null: true,
      description: null,
      key_roles: index === 0 ? ["PK"] : [],
      unique: index === 0,
      primary_key: index === 0,
    })),
    indexes: [],
    foreign_keys: [],
  };
}

function relationship(id, parent, child) {
  return {
    id,
    name: id,
    parent_table_id: parent,
    child_table_id: child,
    column_pairs: [{
      parent_column_id: `${parent}_column_0`,
      child_column_id: `${child}_column_0`,
    }],
    parent_cardinality: "exactly_one",
    child_cardinality: "zero_or_many",
    relationship_type: "non_identifying",
    on_update: "NO ACTION",
    on_delete: "RESTRICT",
    deferrable: false,
  };
}

const complexGraph = {
  format_version: "1.0",
  tables: [
    table("accounts", 4),
    table("orders", 2),
    table("order_items", 6),
    table("cycle_a", 3),
    table("cycle_b", 1),
    table("audit_log", 8),
    table("regions", 2),
    table("warehouses", 5),
  ],
  relationships: [
    relationship("accounts_orders", "accounts", "orders"),
    relationship("orders_items", "orders", "order_items"),
    relationship("cycle_a_b", "cycle_a", "cycle_b"),
    relationship("cycle_b_a", "cycle_b", "cycle_a"),
    relationship("cycle_self", "cycle_a", "cycle_a"),
    relationship("regions_warehouses", "regions", "warehouses"),
  ],
};

function pageHtml({ graph = complexGraph, definitionId }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    .er-diagram-frame { position: relative; width: 960px; height: 520px; overflow: hidden; touch-action: none; }
    .er-viewer, .er-canvas { width: 100%; height: 100%; }
    ${layoutStyles}
    ${autoLayoutStyles}
    ${detailsStyles}
  </style>
</head>
<body>
  <section id="er-diagram" data-er-definition-id="${definitionId}">
    <div class="er-controls">
      <button type="button" data-er-mode="all" aria-pressed="true">All</button>
      <button type="button" data-er-mode="keys" aria-pressed="false">Keys</button>
      <button type="button" data-er-mode="tables" aria-pressed="false">Tables</button>
      <button type="button" data-er-action="zoom-out">Zoom out</button>
      <output id="dbdef-er-zoom-level">100%</output>
      <button type="button" data-er-action="zoom-in">Zoom in</button>
      <button type="button" data-er-action="fit">Fit</button>
      <button type="button" data-er-action="auto-layout">Auto layout</button>
      <button type="button" data-er-layout-direction="left-to-right"
        aria-pressed="true">Left to right</button>
      <button type="button" data-er-layout-direction="top-to-bottom"
        aria-pressed="false">Top to bottom</button>
      <button type="button" data-er-action="reset-layout">Reset</button>
      <output id="dbdef-er-layout-status" aria-live="polite"></output>
    </div>
    <div class="er-diagram-frame">
      <div id="dbdef-er-viewer" class="er-viewer"></div>
      <aside id="dbdef-er-details" class="er-detail-panel" aria-live="polite"
        aria-labelledby="dbdef-er-details-title" hidden>
        <button id="dbdef-er-details-close" type="button">Close</button>
        <p id="dbdef-er-details-kind"></p>
        <h3 id="dbdef-er-details-title"></h3>
        <div id="dbdef-er-details-body"></div>
      </aside>
    </div>
  </section>
  <script id="dbdef-er-graph" type="application/json">${JSON.stringify(graph)}</script>
  <script>${viewerScript}</script>
  <script>${detailsScript}</script>
  <script>${layoutScript}</script>
  <script>${autoLayoutScript}</script>
</body>
</html>`;
}

let browser;
let pageNumber = 0;

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
});

after(async () => {
  await browser.close();
});

async function openPage(options) {
  const page = await browser.newPage();
  const html = pageHtml(options);
  await page.setViewport({ width: 1200, height: 800 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    request.respond({ status: 200, contentType: "text/html", body: html });
  });
  pageNumber += 1;
  await page.goto(`https://dbdef.test/auto-layout-${pageNumber}`);
  await page.waitForFunction(() => Boolean(window.dbdefErAutoLayout));
  return page;
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const state = window.dbdefErViewer.getState();
    const frame = document.querySelector(".er-diagram-frame").getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll(".er-node"), (node) => {
      const screen = node.getBoundingClientRect();
      const background = node.querySelector(".er-node-background");
      const position = state.nodePositions[node.dataset.tableId];
      return {
        id: node.dataset.tableId,
        x: position.x,
        y: position.y,
        width: Number(background.getAttribute("width")),
        height: Number(background.getAttribute("height")),
        visible: screen.left >= frame.left - 1 && screen.right <= frame.right + 1 &&
          screen.top >= frame.top - 1 && screen.bottom <= frame.bottom + 1,
      };
    });
    const overlaps = nodes.flatMap((left, index) =>
      nodes.slice(index + 1).filter((right) =>
        left.x < right.x + right.width && left.x + left.width > right.x &&
        left.y < right.y + right.height && left.y + left.height > right.y,
      ).map((right) => [left.id, right.id]));
    return { nodes, overlaps, viewport: state.viewport };
  });
}

test("initially lays out every component deterministically without overlaps and fits", async () => {
  const page = await openPage({ definitionId: "deterministic-layout" });
  const first = await page.evaluate(() => window.dbdefErViewer.getState().nodePositions);
  const inspected = await inspectLayout(page);

  assert.deepEqual(inspected.overlaps, []);
  assert.ok(inspected.nodes.every((node) => node.visible));
  assert.ok(inspected.nodes.every((node) =>
    Number.isFinite(node.x) && Number.isFinite(node.y) && node.x >= 0 && node.y >= 0));
  assert.ok(first.accounts.x < first.orders.x);
  assert.ok(first.orders.x < first.order_items.x);

  await page.evaluate(() => {
    const changed = Object.fromEntries(
      window.dbdefErViewer.getGraph().tables.map((item, index) => [
        item.id,
        { x: 9000 + index * 17, y: -5000 - index * 13 },
      ]),
    );
    window.dbdefErViewer.setNodePositions(changed);
    window.dbdefErViewer.setMode("tables");
  });
  await page.click('[data-er-action="auto-layout"]');
  await page.click('[data-er-mode="all"]');
  assert.deepEqual(
    await page.evaluate(() => window.dbdefErViewer.getState().nodePositions),
    first,
  );
  assert.deepEqual((await inspectLayout(page)).overlaps, []);
  await page.close();
});

test("switches to top-to-bottom layout and persists the complete result", async () => {
  const definitionId = "direction-and-storage";
  const page = await openPage({ definitionId });
  await page.click('[data-er-layout-direction="top-to-bottom"]');
  const positions = await page.evaluate(() => window.dbdefErViewer.getState().nodePositions);
  assert.ok(positions.accounts.y < positions.orders.y);
  assert.ok(positions.orders.y < positions.order_items.y);
  assert.equal(
    await page.$eval(
      '[data-er-layout-direction="top-to-bottom"]',
      (button) => button.getAttribute("aria-pressed"),
    ),
    "true",
  );
  const inspected = await inspectLayout(page);
  assert.deepEqual(inspected.overlaps, []);
  assert.ok(inspected.nodes.every((node) => node.visible));
  assert.deepEqual(
    await page.evaluate(() => {
      const record = JSON.parse(localStorage.getItem(window.dbdefErLayout.getStorageKey()));
      return record.positions;
    }),
    Object.fromEntries(complexGraph.tables.map((item) => [
      item.physical_name,
      positions[item.id],
    ])),
  );
  await page.close();

  const restored = await openPage({ definitionId });
  assert.deepEqual(
    await restored.evaluate(() => window.dbdefErViewer.getState().nodePositions),
    positions,
  );
  assert.equal(
    await restored.evaluate(() => window.dbdefErAutoLayout.getDirection()),
    "top-to-bottom",
  );
  assert.deepEqual(
    await restored.evaluate(() => ({
      leftToRight: document.querySelector(
        '[data-er-layout-direction="left-to-right"]',
      ).getAttribute("aria-pressed"),
      topToBottom: document.querySelector(
        '[data-er-layout-direction="top-to-bottom"]',
      ).getAttribute("aria-pressed"),
    })),
    { leftToRight: "false", topToBottom: "true" },
  );
  await restored.close();
});

test("uses the registered edge strategy and redraws it exactly once", async () => {
  const page = await openPage({ definitionId: "edge-boundary" });
  const result = await page.evaluate(() => {
    const viewport = document.querySelector("#dbdef-er-viewer");
    let rendererCalls = 0;
    let redrawEvents = 0;
    window.dbdefErViewer.setEdgePathRenderer(({ source, target }) => {
      rendererCalls += 1;
      return `M ${source.centerX} ${source.centerY} L ${target.centerX} ${target.centerY}`;
    });
    rendererCalls = 0;
    viewport.addEventListener("dbdef:er-edges-redrawn", () => {
      redrawEvents += 1;
    });
    window.dbdefErAutoLayout.run();
    return {
      rendererCalls,
      redrawEvents,
      edgeCount: document.querySelectorAll(".er-edge").length,
      straightPaths: Array.from(document.querySelectorAll(".er-edge"))
        .every((edge) => edge.getAttribute("d").includes(" L ")),
    };
  });
  assert.deepEqual(result, {
    rendererCalls: complexGraph.relationships.length,
    redrawEvents: 1,
    edgeCount: complexGraph.relationships.length,
    straightPaths: true,
  });
  await page.close();
});

test("handles an empty graph safely", async () => {
  const page = await openPage({
    definitionId: "empty-layout",
    graph: { format_version: "1.0", tables: [], relationships: [] },
  });
  await page.click('[data-er-action="auto-layout"]');
  const result = await page.evaluate(() => ({
    positions: window.dbdefErViewer.getState().nodePositions,
    viewport: window.dbdefErViewer.getState().viewport,
    saved: JSON.parse(localStorage.getItem(window.dbdefErLayout.getStorageKey())).positions,
  }));
  assert.deepEqual(result.positions, {});
  assert.deepEqual(result.saved, {});
  assert.ok(Object.values(result.viewport).every(Number.isFinite));
  await page.close();
});

test("rejects an unknown direction without changing positions", async () => {
  const page = await openPage({ definitionId: "invalid-direction" });
  const result = await page.evaluate(() => {
    const before = window.dbdefErViewer.getState().nodePositions;
    let error = null;
    try {
      window.dbdefErAutoLayout.run("diagonal");
    } catch (caught) {
      error = caught.message;
    }
    return {
      before,
      after: window.dbdefErViewer.getState().nodePositions,
      direction: window.dbdefErAutoLayout.getDirection(),
      error,
    };
  });
  assert.deepEqual(result.after, result.before);
  assert.equal(result.direction, "left-to-right");
  assert.match(result.error, /Unknown ER auto-layout direction/);
  await page.close();
});

test("coexists with detail selection, ARIA, dragging, and saved restoration", async () => {
  const definitionId = "details-drag-integration";
  const page = await openPage({ definitionId });

  await page.click('[data-table-id="accounts"] .er-node-physical');
  let details = await page.evaluate(() => {
    const target = document.querySelector(
      '[data-table-id="accounts"] [data-er-detail-target="table"]',
    );
    return {
      hidden: document.querySelector("#dbdef-er-details").hidden,
      title: document.querySelector("#dbdef-er-details-title").textContent,
      role: target.getAttribute("role"),
      selected: target.getAttribute("aria-selected"),
      controls: target.getAttribute("aria-controls"),
      panelRole: document.querySelector("#dbdef-er-details").getAttribute("role"),
    };
  });
  assert.deepEqual(details, {
    hidden: false,
    title: "accounts / accounts",
    role: "option",
    selected: "true",
    controls: "dbdef-er-details",
    panelRole: "region",
  });

  await page.click('[data-er-layout-direction="top-to-bottom"]');
  assert.equal(
    await page.$eval(
      '[data-table-id="accounts"] [data-er-detail-target="table"]',
      (target) => target.getAttribute("aria-selected"),
    ),
    "true",
  );
  await page.click('[data-column-id="orders_column_0"] .er-column-name');
  details = await page.evaluate(() => {
    const target = document.querySelector('[data-column-id="orders_column_0"]');
    return {
      kind: document.querySelector("#dbdef-er-details-kind").textContent,
      title: document.querySelector("#dbdef-er-details-title").textContent,
      selected: target.getAttribute("aria-selected"),
      controls: target.getAttribute("aria-controls"),
    };
  });
  assert.deepEqual(details, {
    kind: "カラム詳細",
    title: "column_0 / column_0",
    selected: "true",
    controls: "dbdef-er-details",
  });

  await page.evaluate(() => window.dbdefErViewer.setViewport({ scale: 1, x: 30, y: 30 }));
  const before = await page.evaluate(() => window.dbdefErViewer.getNodePosition("orders"));
  const node = await page.$('[data-table-id="orders"]');
  const box = await node.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 85, { steps: 4 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => window.dbdefErViewer.getNodePosition("orders"));
  assert.deepEqual(dragged, { x: before.x + 90, y: before.y + 65 });
  const saved = await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem(window.dbdefErLayout.getStorageKey()));
    return {
      position: record.positions.orders,
      direction: record.metadata.autoLayoutDirection,
      tableSelected: document.querySelector(
        '[data-table-id="orders"] [data-er-detail-target="table"]',
      ).getAttribute("aria-selected"),
    };
  });
  assert.deepEqual(saved, {
    position: dragged,
    direction: "top-to-bottom",
    tableSelected: "true",
  });
  await page.close();

  const restored = await openPage({ definitionId });
  assert.deepEqual(
    await restored.evaluate(() => window.dbdefErViewer.getNodePosition("orders")),
    dragged,
  );
  assert.equal(
    await restored.evaluate(() => window.dbdefErAutoLayout.getDirection()),
    "top-to-bottom",
  );
  await restored.click('[data-column-id="orders_column_0"] .er-column-name');
  assert.equal(
    await restored.$eval(
      '[data-column-id="orders_column_0"]',
      (target) => target.getAttribute("aria-selected"),
    ),
    "true",
  );
  await restored.close();
});
