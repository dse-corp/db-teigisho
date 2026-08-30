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
const layoutStyles = await readFile(
  new URL("../src/db_teigisho/templates/er_layout.css", import.meta.url),
  "utf8",
);
const detailsScript = await readFile(
  new URL("../src/db_teigisho/templates/er_details.js", import.meta.url),
  "utf8",
);
const detailsStyles = await readFile(
  new URL("../src/db_teigisho/templates/er_details.css", import.meta.url),
  "utf8",
);
const routingScript = await readFile(
  new URL("../src/db_teigisho/templates/er_edge_routing.js", import.meta.url),
  "utf8",
);
const routingStyles = await readFile(
  new URL("../src/db_teigisho/templates/er_edge_routing.css", import.meta.url),
  "utf8",
);

const baseGraph = {
  format_version: "1.0",
  tables: [
    {
      id: "table_1",
      physical_name: "customers",
      logical_name: "Customers",
      description: null,
      columns: [
        {
          id: "table_1_column_1",
          physical_name: "customer_id",
          logical_name: "Customer ID",
          data_type: "uuid",
          length: null,
          scale: null,
          default: null,
          not_null: true,
          description: null,
          key_roles: ["PK"],
        },
      ],
    },
    {
      id: "table_2",
      physical_name: "orders",
      logical_name: "Orders",
      description: null,
      columns: [
        {
          id: "table_2_column_1",
          physical_name: "customer_id",
          logical_name: "Customer ID",
          data_type: "uuid",
          length: null,
          scale: null,
          default: null,
          not_null: true,
          description: null,
          key_roles: ["FK"],
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
          child_column_id: "table_2_column_1",
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

function pageHtml({
  graph = baseGraph,
  definitionId,
  beforeLayout = "",
  withDetails = false,
  withRouting = false,
}) {
  const detailPanel = withDetails
    ? `<aside id="dbdef-er-details" class="er-detail-panel" aria-live="polite"
        aria-labelledby="dbdef-er-details-title" hidden>
        <button id="dbdef-er-details-close" type="button">Close</button>
        <p id="dbdef-er-details-kind"></p>
        <h3 id="dbdef-er-details-title"></h3>
        <div id="dbdef-er-details-body"></div>
      </aside>`
    : "";
  const detailScript = withDetails ? `<script>${detailsScript}</script>` : "";
  const routingControls = withRouting
    ? `<button type="button" data-er-edge-routing="curve" aria-pressed="false">Curve</button>
       <button type="button" data-er-edge-routing="straight" aria-pressed="true">Straight</button>
       <button type="button" data-er-edge-routing="orthogonal" aria-pressed="false">Orthogonal</button>
       <span data-er-orthogonal-controls hidden>
         <button type="button" data-er-line-jumps aria-pressed="true">Line jump</button>
       </span>
       <output id="dbdef-er-edge-routing-status" aria-live="polite"></output>`
    : "";
  const routingModule = withRouting ? `<script>${routingScript}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    .er-diagram-frame { position: relative; width: 960px; height: 520px; overflow: hidden; touch-action: none; }
    .er-viewer { width: 100%; height: 100%; user-select: none; }
    .er-canvas { width: 100%; height: 100%; }
    ${layoutStyles}
    ${withDetails ? detailsStyles : ""}
    ${withRouting ? routingStyles : ""}
  </style>
</head>
<body>
  <section id="er-diagram" data-er-definition-id="${definitionId}">
    <div class="er-controls">
      <button type="button" data-er-mode="all" aria-pressed="true">All</button>
      <button type="button" data-er-mode="keys" aria-pressed="false">Keys</button>
      <button type="button" data-er-mode="tables" aria-pressed="false">Tables</button>
      ${routingControls}
      <button type="button" data-er-action="zoom-out">Zoom out</button>
      <output id="dbdef-er-zoom-level">100%</output>
      <button type="button" data-er-action="zoom-in">Zoom in</button>
      <button type="button" data-er-action="fit">Fit</button>
      <button type="button" data-er-action="reset-layout">Reset layout</button>
      <output id="dbdef-er-layout-status" aria-live="polite"></output>
    </div>
    <div class="er-diagram-frame">
      <div id="dbdef-er-viewer" class="er-viewer"></div>
      ${detailPanel}
    </div>
  </section>
  <script id="dbdef-er-graph" type="application/json">${JSON.stringify(graph)}</script>
  <script>${viewerScript}</script>
  ${detailScript}
  ${routingModule}
  <script>${beforeLayout}</script>
  <script>${layoutScript}</script>
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
    request.respond({
      status: 200,
      contentType: "text/html",
      body: html,
    });
  });
  pageNumber += 1;
  await page.goto(`https://dbdef.test/viewer-${pageNumber}`);
  await page.waitForFunction(() => Boolean(window.dbdefErLayout));
  return page;
}

async function dragNode(page, tableId, deltaX, deltaY) {
  await page.evaluate(() => window.dbdefErViewer.setViewport({ scale: 1, x: 40, y: 40 }));
  const node = await page.$(`[data-table-id="${tableId}"]`);
  const box = await node.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 30 + deltaX, box.y + 20 + deltaY, { steps: 4 });
  return { node, box };
}

test("drags a node, redraws its edge during movement, and restores the saved layout", async () => {
  const definitionId = "drag-and-restore";
  const page = await openPage({ definitionId });
  const before = await page.evaluate(() => ({
    position: window.dbdefErViewer.getNodePosition("table_2"),
    edge: document.querySelector(".er-edge").getAttribute("d"),
  }));

  await dragNode(page, "table_2", 140, 90);
  const during = await page.evaluate(() => ({
    position: window.dbdefErViewer.getNodePosition("table_2"),
    edge: document.querySelector(".er-edge").getAttribute("d"),
    dragging: document.querySelector('[data-table-id="table_2"]').classList.contains("er-is-dragging"),
  }));
  assert.deepEqual(during.position, {
    x: before.position.x + 140,
    y: before.position.y + 90,
  });

  assert.notEqual(during.edge, before.edge);
  assert.equal(during.dragging, true);

  await page.mouse.up();
  const saved = await page.evaluate(() => {
    const key = window.dbdefErLayout.getStorageKey();
    return {
      key,
      value: JSON.parse(localStorage.getItem(key)),
    };
  });
  assert.match(saved.key, /^dbdef:er-layout:v1:drag-and-restore:[0-9a-f]+$/);
  assert.deepEqual(saved.value.positions.orders, during.position);
  await page.close();

  const restoredPage = await openPage({ definitionId });
  assert.deepEqual(
    await restoredPage.evaluate(() => window.dbdefErViewer.getNodePosition("table_2")),
    during.position,
  );
  await restoredPage.close();
});

test("keeps details selection usable while dragging and restoring node layouts", async () => {
  const definitionId = "details-and-layout";
  const page = await openPage({ definitionId, withDetails: true, withRouting: true });
  const originalEdge = await page.$eval(".er-edge", (edge) => edge.getAttribute("d"));
  await page.click('[data-table-id="table_1"] .er-node-physical');
  const afterSelection = await page.evaluate(() => ({
    detailTitle: document.querySelector("#dbdef-er-details-title").textContent,
    status: document.querySelector("#dbdef-er-layout-status").textContent,
    saved: localStorage.getItem(window.dbdefErLayout.getStorageKey()),
    tableSelected: document.querySelector(
      '[data-table-id="table_1"] [data-er-detail-target="table"]',
    ).getAttribute("aria-selected"),
    controls: document.querySelector(
      '[data-table-id="table_1"] [data-er-detail-target="table"]',
    ).getAttribute("aria-controls"),
    panelRole: document.querySelector("#dbdef-er-details").getAttribute("role"),
  }));
  assert.deepEqual(afterSelection, {
    detailTitle: "customers / Customers",
    status: "",
    saved: null,
    tableSelected: "true",
    controls: "dbdef-er-details",
    panelRole: "region",
  });

  await page.click('[data-column-id="table_1_column_1"] .er-column-name');
  const afterColumnSelection = await page.evaluate(() => ({
    detailTitle: document.querySelector("#dbdef-er-details-title").textContent,
    saved: localStorage.getItem(window.dbdefErLayout.getStorageKey()),
    selected: document.querySelector(
      '[data-column-id="table_1_column_1"]',
    ).getAttribute("aria-selected"),
    controls: document.querySelector(
      '[data-column-id="table_1_column_1"]',
    ).getAttribute("aria-controls"),
  }));
  assert.deepEqual(afterColumnSelection, {
    detailTitle: "customer_id / Customer ID",
    saved: null,
    selected: "true",
    controls: "dbdef-er-details",
  });

  await page.click('[data-er-edge-routing="orthogonal"]');
  const afterRouting = await page.evaluate(() => ({
    mode: window.dbdefErEdgeRouting.getRoutingMode(),
    edge: document.querySelector(".er-edge").getAttribute("d"),
    routingStored: localStorage.getItem(window.dbdefErEdgeRouting.getStorageKey()),
    layoutStored: localStorage.getItem(window.dbdefErLayout.getStorageKey()),
    detailTitle: document.querySelector("#dbdef-er-details-title").textContent,
    selected: document.querySelector(
      '[data-column-id="table_1_column_1"]',
    ).getAttribute("aria-selected"),
  }));
  assert.equal(afterRouting.mode, "orthogonal");
  assert.notEqual(afterRouting.edge, originalEdge);
  assert.equal(afterRouting.routingStored, "orthogonal");
  assert.equal(afterRouting.layoutStored, null);
  assert.equal(afterRouting.detailTitle, "customer_id / Customer ID");
  assert.equal(afterRouting.selected, "true");

  const before = await page.evaluate(() => window.dbdefErViewer.getNodePosition("table_2"));

  await dragNode(page, "table_2", 120, 70);
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => ({
    position: window.dbdefErViewer.getNodePosition("table_2"),
    panelHidden: document.querySelector("#dbdef-er-details").hidden,
    detailTitle: document.querySelector("#dbdef-er-details-title").textContent,
    selected: document.querySelector(
      '[data-table-id="table_2"] [data-er-detail-target="table"]',
    ).getAttribute("aria-selected"),
    route: window.dbdefErEdgeRouting.getRoutingMode(),
    edge: document.querySelector(".er-edge").getAttribute("d"),
    saved: JSON.parse(localStorage.getItem(window.dbdefErLayout.getStorageKey()))
      .positions.orders,
  }));
  assert.deepEqual(afterDrag.position, { x: before.x + 120, y: before.y + 70 });
  assert.deepEqual(afterDrag.saved, afterDrag.position);
  assert.equal(afterDrag.panelHidden, false);
  assert.equal(afterDrag.detailTitle, "orders / Orders");
  assert.equal(afterDrag.selected, "true");
  assert.equal(afterDrag.route, "orthogonal");
  assert.notEqual(afterDrag.edge, afterRouting.edge);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const columnSelection = await page.evaluate(() => ({
    title: document.querySelector("#dbdef-er-details-title").textContent,
    selected: document.querySelector(
      '[data-column-id="table_2_column_1"]',
    ).getAttribute("aria-selected"),
    controls: document.querySelector(
      '[data-column-id="table_2_column_1"]',
    ).getAttribute("aria-controls"),
  }));
  assert.deepEqual(columnSelection, {
    title: "customer_id / Customer ID",
    selected: "true",
    controls: "dbdef-er-details",
  });
  await page.close();

  const restoredPage = await openPage({
    definitionId,
    withDetails: true,
    withRouting: true,
  });
  const restored = await restoredPage.evaluate(() => ({
    position: window.dbdefErViewer.getNodePosition("table_2"),
    route: window.dbdefErEdgeRouting.getRoutingMode(),
    pressed: document.querySelector(
      '[data-er-edge-routing="orthogonal"]',
    ).getAttribute("aria-pressed"),
  }));
  assert.deepEqual(restored.position, afterDrag.position);
  assert.equal(restored.route, "orthogonal");
  assert.equal(restored.pressed, "true");
  await restoredPage.click('[data-table-id="table_2"] .er-node-physical');
  assert.equal(
    await restoredPage.$eval("#dbdef-er-details-title", (element) => element.textContent),
    "orders / Orders",
  );
  await restoredPage.close();
});

test("isolates layouts by definition identity", async () => {
  const source = await openPage({ definitionId: "isolation-source" });
  await source.evaluate(() => {
    window.dbdefErViewer.setNodePosition("table_1", { x: 850, y: 640 });
    window.dbdefErLayout.save();
  });
  await source.close();

  const other = await openPage({ definitionId: "isolation-target" });
  assert.notDeepEqual(
    await other.evaluate(() => window.dbdefErViewer.getNodePosition("table_1")),
    { x: 850, y: 640 },
  );
  await other.close();
});

test("restores compatible tables after graph changes and keeps new tables visible", async () => {
  const definitionId = "structure-change";
  const oldPage = await openPage({ definitionId });
  await oldPage.evaluate(() => {
    window.dbdefErViewer.setNodePosition("table_1", { x: 0, y: 0 });
    window.dbdefErLayout.save();
  });
  const oldKey = await oldPage.evaluate(() => window.dbdefErLayout.getStorageKey());
  await oldPage.close();

  const changedGraph = structuredClone(baseGraph);
  changedGraph.tables = [
    {
      ...structuredClone(baseGraph.tables[1]),
      id: "table_1",
      physical_name: "invoices",
      logical_name: "Invoices",
      columns: [],
    },
    {
      ...structuredClone(baseGraph.tables[0]),
      id: "table_2",
      columns: baseGraph.tables[0].columns.map((column) => ({
        ...column,
        id: "table_2_column_1",
      })),
    },
    {
      ...structuredClone(baseGraph.tables[1]),
      id: "table_3",
      columns: baseGraph.tables[1].columns.map((column) => ({
        ...column,
        id: "table_3_column_1",
      })),
    },
  ];
  changedGraph.relationships = [];

  const changedPage = await openPage({ definitionId, graph: changedGraph });
  assert.notEqual(
    await changedPage.evaluate(() => window.dbdefErLayout.getStorageKey()),
    oldKey,
  );
  assert.deepEqual(
    await changedPage.evaluate(() => window.dbdefErViewer.getNodePosition("table_2")),
    { x: 0, y: 0 },
  );
  const layout = await changedPage.evaluate(() => {
    const frame = document.querySelector(".er-diagram-frame").getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll(".er-node"), (node) => {
      const box = node.getBoundingClientRect();
      return {
        id: node.dataset.tableId,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        visible: box.right > frame.left && box.left < frame.right &&
          box.bottom > frame.top && box.top < frame.bottom,
      };
    });
    const overlaps = nodes.flatMap((left, index) =>
      nodes.slice(index + 1).filter((right) =>
        left.left < right.right && left.right > right.left &&
        left.top < right.bottom && left.bottom > right.top,
      ).map((right) => [left.id, right.id]));
    return { nodes, overlaps };
  });
  assert.ok(layout.nodes.every((node) => node.visible));
  assert.deepEqual(layout.overlaps, []);
  await changedPage.close();
});

test("restores remaining tables safely after a table is deleted", async () => {
  const definitionId = "table-deletion";
  const oldPage = await openPage({ definitionId });
  await oldPage.evaluate(() => {
    window.dbdefErViewer.setNodePosition("table_2", { x: 610, y: 360 });
    window.dbdefErLayout.save();
  });
  await oldPage.close();

  const reducedGraph = structuredClone(baseGraph);
  reducedGraph.tables = [{
    ...structuredClone(baseGraph.tables[1]),
    id: "table_1",
    columns: baseGraph.tables[1].columns.map((column) => ({
      ...column,
      id: "table_1_column_1",
    })),
  }];
  reducedGraph.relationships = [];
  const reducedPage = await openPage({ definitionId, graph: reducedGraph });
  assert.deepEqual(
    await reducedPage.evaluate(() => window.dbdefErViewer.getNodePosition("table_1")),
    { x: 610, y: 360 },
  );
  await reducedPage.close();
});

test("resets to initial positions and removes all saved graph versions", async () => {
  const definitionId = "reset-layout";
  const page = await openPage({ definitionId });
  const initial = await page.evaluate(() => window.dbdefErViewer.getState().nodePositions);
  await page.evaluate(() => {
    window.dbdefErViewer.setNodePosition("table_1", { x: 700, y: 500 });
    window.dbdefErLayout.save();
  });

  await page.click('[data-er-action="reset-layout"]');

  assert.deepEqual(
    await page.evaluate(() => window.dbdefErViewer.getState().nodePositions),
    initial,
  );
  assert.equal(
    await page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith("dbdef:er-layout:v1:reset-layout:")).length),
    0,
  );
  await page.close();

  const reloaded = await openPage({ definitionId });
  assert.deepEqual(
    await reloaded.evaluate(() => window.dbdefErViewer.getState().nodePositions),
    initial,
  );
  await reloaded.close();
});

test("resets saved orthogonal segment positions with the table layout", async () => {
  const definitionId = "reset-route-layout";
  const page = await openPage({ definitionId, withRouting: true });
  await page.click('[data-er-edge-routing="orthogonal"]');
  await page.evaluate(() => {
    window.dbdefErEdgeRouting.setRouteOffset("relationship_1", 800);
    const currentKey = window.dbdefErEdgeRouting.getRouteStorageKey();
    localStorage.setItem(
      currentKey.replace(/[0-9a-f]+$/, "previous-graph"),
      localStorage.getItem(currentKey),
    );
    window.dbdefErViewer.setNodePosition("table_1", { x: 700, y: 500 });
    window.dbdefErLayout.save();
  });
  assert.deepEqual(
    await page.evaluate(() => window.dbdefErEdgeRouting.getRouteOffsets()),
    { relationship_1: 800 },
  );

  await page.click('[data-er-action="reset-layout"]');
  const reset = await page.evaluate(() => {
    const beforeRefit = window.dbdefErViewer.getState().viewport;
    window.dbdefErViewer.fitToView();
    return {
      offsets: window.dbdefErEdgeRouting.getRouteOffsets(),
      routeRecords: Object.keys(localStorage).filter((key) =>
        key.startsWith("dbdef:er-route-layout:v1:reset-route-layout:")),
      beforeRefit,
      afterRefit: window.dbdefErViewer.getState().viewport,
    };
  });
  assert.deepEqual(reset.offsets, {});
  assert.deepEqual(reset.routeRecords, []);
  assert.deepEqual(reset.beforeRefit, reset.afterRefit);
  await page.close();
});

test("continues dragging and reports quota failures when a layout cannot be saved", async () => {
  const page = await openPage({
    definitionId: "quota-failure",
    beforeLayout: `
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {
        throw new DOMException("Storage quota exceeded.", "QuotaExceededError");
      };
      window.addEventListener("pagehide", () => {
        Storage.prototype.setItem = originalSetItem;
      });
    `,
  });
  const before = await page.evaluate(() => window.dbdefErViewer.getNodePosition("table_1"));
  await dragNode(page, "table_1", 80, 45);
  await page.mouse.up();

  const result = await page.evaluate(() => ({
    position: window.dbdefErViewer.getNodePosition("table_1"),
    status: document.querySelector("#dbdef-er-layout-status").textContent,
    failed: document.querySelector("#dbdef-er-layout-status").dataset.status,
  }));
  assert.deepEqual(result.position, { x: before.x + 80, y: before.y + 45 });
  assert.match(result.status, /保存できません/);
  assert.equal(result.failed, "error");
  await page.close();
});

test("reports restore when localStorage access is blocked during startup", async () => {
  const page = await openPage({
    definitionId: "blocked-storage-restore",
    beforeLayout: `
      window.blockedRestoreAction = null;
      document.querySelector("#dbdef-er-viewer").addEventListener(
        "dbdef:er-layout-storage-error",
        (event) => {
          window.blockedRestoreAction = event.detail.action;
        },
        { once: true },
      );
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage access is blocked.", "SecurityError");
        },
      });
    `,
  });
  const result = await page.evaluate(() => ({
    nodeCount: document.querySelectorAll(".er-node").length,
    viewerReady: Boolean(window.dbdefErViewer),
    layoutReady: Boolean(window.dbdefErLayout),
    status: document.querySelector("#dbdef-er-layout-status").textContent,
    failed: document.querySelector("#dbdef-er-layout-status").dataset.status,
    action: window.blockedRestoreAction,
  }));
  assert.deepEqual(result, {
    nodeCount: 2,
    viewerReady: true,
    layoutReady: true,
    status: "配置を復元できません。ブラウザの保存領域を確認してください。",
    failed: "error",
    action: "復元",
  });
  await page.close();
});

async function blockStorageAccess(page) {
  await page.evaluate(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage access is blocked.", "SecurityError");
      },
    });
  });
}

test("reports save when localStorage access is blocked during explicit save", async () => {
  const page = await openPage({ definitionId: "blocked-storage-save" });
  await blockStorageAccess(page);
  const result = await page.evaluate(() => {
    let action = null;
    document.querySelector("#dbdef-er-viewer").addEventListener(
      "dbdef:er-layout-storage-error",
      (event) => {
        action = event.detail.action;
      },
      { once: true },
    );
    return {
      saved: window.dbdefErLayout.save(),
      status: document.querySelector("#dbdef-er-layout-status").textContent,
      action,
    };
  });
  assert.deepEqual(result, {
    saved: false,
    status: "配置を保存できません。ブラウザの保存領域を確認してください。",
    action: "保存",
  });
  await page.close();
});

test("reports reset when localStorage access is blocked while resetting", async () => {
  const page = await openPage({ definitionId: "blocked-storage-reset" });
  const initial = await page.evaluate(() => window.dbdefErViewer.getState().nodePositions);
  await page.evaluate(() => {
    window.dbdefErViewer.setNodePosition("table_1", { x: 900, y: 600 });
  });
  await blockStorageAccess(page);
  const result = await page.evaluate(() => {
    let action = null;
    document.querySelector("#dbdef-er-viewer").addEventListener(
      "dbdef:er-layout-storage-error",
      (event) => {
        action = event.detail.action;
      },
      { once: true },
    );
    return {
      reset: window.dbdefErLayout.reset(),
      positions: window.dbdefErViewer.getState().nodePositions,
      status: document.querySelector("#dbdef-er-layout-status").textContent,
      action,
    };
  });
  assert.equal(result.reset, false);
  assert.deepEqual(result.positions, initial);
  assert.equal(
    result.status,
    "配置をリセットできません。ブラウザの保存領域を確認してください。",
  );
  assert.equal(result.action, "リセット");
  await page.close();
});

test("applies all node coordinates atomically and redraws edges once", async () => {
  const page = await openPage({ definitionId: "bulk-positions" });
  const result = await page.evaluate(() => {
    const viewer = document.querySelector("#dbdef-er-viewer");
    let redraws = 0;
    viewer.addEventListener("dbdef:er-edges-redrawn", () => {
      redraws += 1;
    });
    window.dbdefErViewer.setNodePositions({
      table_1: { x: 25, y: 35 },
      table_2: { x: 525, y: 335 },
    }, { source: "auto-layout" });
    const applied = window.dbdefErViewer.getState().nodePositions;
    let error = null;
    try {
      window.dbdefErViewer.setNodePositions({
        table_1: { x: 125, y: 135 },
        table_2: { x: Number.NaN, y: 435 },
      });
    } catch (caught) {
      error = caught.message;
    }
    return {
      applied,
      afterRejected: window.dbdefErViewer.getState().nodePositions,
      error,
      redraws,
    };
  });

  assert.deepEqual(result.applied, {
    table_1: { x: 25, y: 35 },
    table_2: { x: 525, y: 335 },
  });
  assert.deepEqual(result.afterRejected, result.applied);
  assert.match(result.error, /finite number/);
  assert.equal(result.redraws, 1);
  await page.close();
});
