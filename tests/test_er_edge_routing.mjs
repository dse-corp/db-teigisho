import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import puppeteer from "puppeteer";

const viewerScript = await readFile(
  new URL("../src/db_teigisho/templates/er_viewer.js", import.meta.url),
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

const columns = (tableId) => [{
  id: `${tableId}_column_1`,
  physical_name: "id",
  logical_name: "ID",
  data_type: "uuid",
  length: null,
  scale: null,
  default: null,
  not_null: true,
  description: null,
  key_roles: ["PK", "FK"],
}];

const graph = {
  format_version: "1.0",
  tables: [
    {
      id: "table_1",
      physical_name: "users",
      logical_name: "Users",
      description: null,
      columns: columns("table_1"),
    },
    {
      id: "table_2",
      physical_name: "orders",
      logical_name: "Orders",
      description: null,
      columns: columns("table_2"),
    },
    {
      id: "table_3",
      physical_name: "products",
      logical_name: "Products",
      description: null,
      columns: columns("table_3"),
    },
  ],
  relationships: [
    {
      id: "relationship_1",
      name: "fk_orders_created_by",
      parent_table_id: "table_1",
      child_table_id: "table_2",
      column_pairs: [],
      parent_cardinality: "exactly_one",
      child_cardinality: "zero_or_many",
      relationship_type: "identifying",
      on_update: "NO ACTION",
      on_delete: "CASCADE",
      deferrable: false,
    },
    {
      id: "relationship_2",
      name: "fk_orders_approved_by",
      parent_table_id: "table_1",
      child_table_id: "table_2",
      column_pairs: [],
      parent_cardinality: "zero_or_one",
      child_cardinality: "exactly_one",
      relationship_type: "non_identifying",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      deferrable: false,
    },
    {
      id: "relationship_3",
      name: "fk_users_last_order",
      parent_table_id: "table_2",
      child_table_id: "table_1",
      column_pairs: [],
      parent_cardinality: "exactly_one",
      child_cardinality: "zero_or_many",
      relationship_type: "non_identifying",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      deferrable: false,
    },
    {
      id: "relationship_4",
      name: "fk_users_manager",
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
    {
      id: "relationship_5",
      name: "fk_users_mentor",
      parent_table_id: "table_1",
      child_table_id: "table_1",
      column_pairs: [],
      parent_cardinality: "exactly_one",
      child_cardinality: "exactly_one",
      relationship_type: "identifying",
      on_update: "NO ACTION",
      on_delete: "CASCADE",
      deferrable: false,
    },
    {
      id: "relationship_6",
      name: "fk_products_owner",
      parent_table_id: "table_1",
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
      id: "relationship_7",
      name: "fk_orders_updated_by",
      parent_table_id: "table_1",
      child_table_id: "table_2",
      column_pairs: [],
      parent_cardinality: "exactly_one",
      child_cardinality: "zero_or_many",
      relationship_type: "non_identifying",
      on_update: "NO ACTION",
      on_delete: "RESTRICT",
      deferrable: false,
    },
    {
      id: "relationship_8",
      name: "fk_orders_deleted_by",
      parent_table_id: "table_1",
      child_table_id: "table_2",
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

function pageHtml({ beforeRouting = "", clearStorage = true } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    :root { --brand: #124e78; --muted: #5d6d7e; --surface: #f5f7fa; }
    .er-diagram-frame { position: relative; width: 960px; height: 520px; overflow: hidden; touch-action: none; }
    .er-viewer, .er-canvas { width: 100%; height: 100%; }
    .er-edge { fill: none; stroke: #536b7a; }
    .er-edge-non_identifying { stroke-dasharray: 6 4; }
    ${routingStyles}
  </style>
</head>
<body>
  <section id="er-diagram">
    <div class="er-controls">
      <button type="button" data-er-mode="all" aria-pressed="true">All</button>
      <button type="button" data-er-mode="keys" aria-pressed="false">Keys</button>
      <button type="button" data-er-mode="tables" aria-pressed="false">Tables</button>
      <button type="button" data-er-edge-routing="straight" aria-pressed="true">Straight</button>
      <button type="button" data-er-edge-routing="orthogonal" aria-pressed="false">Orthogonal</button>
      <button type="button" data-er-action="zoom-out">Zoom out</button>
      <output id="dbdef-er-zoom-level">100%</output>
      <button type="button" data-er-action="zoom-in">Zoom in</button>
      <button type="button" data-er-action="fit">Fit</button>
      <output id="dbdef-er-edge-routing-status" aria-live="polite"></output>
    </div>
    <div class="er-diagram-frame">
      <div id="dbdef-er-viewer" class="er-viewer"></div>
    </div>
  </section>
  <script id="dbdef-er-graph" type="application/json">${JSON.stringify(graph)}</script>
  <script>${viewerScript}</script>
  <script>${clearStorage ? "localStorage.clear();" : ""}${beforeRouting}</script>
  <script>${routingScript}</script>
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
  await page.goto(`https://dbdef.test/routing-${pageNumber}`);
  await page.waitForFunction(() => Boolean(window.dbdefErEdgeRouting));
  return page;
}

test("switches immediately between straight and orthogonal routes and restores the choice", async () => {
  const page = await openPage();
  const before = await page.$eval(".er-edge", (edge) => edge.getAttribute("d"));
  assert.equal(
    await page.evaluate(() => window.dbdefErEdgeRouting.getRoutingMode()),
    "straight",
  );

  await page.click('[data-er-edge-routing="orthogonal"]');
  const selected = await page.evaluate(() => ({
    mode: window.dbdefErEdgeRouting.getRoutingMode(),
    path: document.querySelector(".er-edge").getAttribute("d"),
    pressed: document.querySelector('[data-er-edge-routing="orthogonal"]').ariaPressed,
    stored: localStorage.getItem(window.dbdefErEdgeRouting.getStorageKey()),
  }));
  assert.equal(selected.mode, "orthogonal");
  assert.notEqual(selected.path, before);
  assert.equal(selected.pressed, "true");
  assert.equal(selected.stored, "orthogonal");
  await page.close();

  const restored = await openPage({ clearStorage: false });
  assert.equal(
    await restored.evaluate(() => window.dbdefErEdgeRouting.getRoutingMode()),
    "orthogonal",
  );
  assert.equal(
    await restored.$eval('[data-er-edge-routing="orthogonal"]', (button) => button.ariaPressed),
    "true",
  );
  await restored.close();
});

test("redraws paths and labels after bulk updates, movement, zoom, and pan", async () => {
  const page = await openPage();
  await page.click('[data-er-edge-routing="orthogonal"]');
  const result = await page.evaluate(() => {
    const edge = document.querySelector('[data-relationship-id="relationship_6"]');
    const label = document.querySelector('[data-relationship-label-id="relationship_6"]');
    const before = {
      path: edge.getAttribute("d"),
      labelX: label.getAttribute("x"),
      labelY: label.getAttribute("y"),
    };
    window.dbdefErViewer.setNodePositions({
      table_1: { x: 30, y: 40 },
      table_2: { x: 680, y: 240 },
      table_3: { x: 350, y: 500 },
    });
    const bulk = {
      path: edge.getAttribute("d"),
      labelX: label.getAttribute("x"),
      labelY: label.getAttribute("y"),
    };
    window.dbdefErViewer.setNodePosition("table_3", { x: 790, y: 430 });
    const moved = {
      path: edge.getAttribute("d"),
      labelX: label.getAttribute("x"),
      labelY: label.getAttribute("y"),
    };
    const beforeMatrix = edge.getScreenCTM();
    window.dbdefErViewer.setViewport({ scale: 1.6, x: 75, y: -30 });
    const afterMatrix = edge.getScreenCTM();
    return {
      before,
      bulk,
      moved,
      pathAfterViewport: edge.getAttribute("d"),
      labelAfterViewport: [label.getAttribute("x"), label.getAttribute("y")],
      sameLayer: edge.parentElement === label.parentElement &&
        edge.closest(".er-scene") === label.closest(".er-scene"),
      matrices: [beforeMatrix.a, beforeMatrix.e, afterMatrix.a, afterMatrix.e],
    };
  });
  assert.notDeepEqual(result.bulk, result.before);
  assert.notDeepEqual(result.moved, result.bulk);
  assert.equal(result.pathAfterViewport, result.moved.path);
  assert.deepEqual(result.labelAfterViewport, [result.moved.labelX, result.moved.labelY]);
  assert.equal(result.sameLayer, true);
  assert.notDeepEqual(result.matrices.slice(0, 2), result.matrices.slice(2));
  await page.close();
});

test("separates self, parallel, and bidirectional relationships in both modes", async () => {
  const page = await openPage();
  for (const mode of ["straight", "orthogonal"]) {
    await page.click('[data-er-mode="tables"]');
    await page.click(`[data-er-edge-routing="${mode}"]`);
    const routes = await page.evaluate(() => {
      const path = (id) =>
        document.querySelector(`[data-relationship-id="${id}"]`).getAttribute("d");
      const label = (id) => {
        const element = document.querySelector(`[data-relationship-label-id="${id}"]`);
        return `${element.getAttribute("x")},${element.getAttribute("y")}`;
      };
      return {
        parallel: [
          "relationship_1",
          "relationship_2",
          "relationship_3",
          "relationship_7",
          "relationship_8",
        ].map(path),
        parallelLabels: [
          "relationship_1",
          "relationship_2",
          "relationship_3",
          "relationship_7",
          "relationship_8",
        ].map(label),
        self: ["relationship_4", "relationship_5"].map(path),
        selfLabels: ["relationship_4", "relationship_5"].map(label),
        selfLabelBoxes: ["relationship_4", "relationship_5"].map((id) => {
          const box = document.querySelector(
            `[data-relationship-label-id="${id}"]`,
          ).getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }),
      };
    });
    assert.equal(new Set(routes.parallel).size, routes.parallel.length);
    assert.equal(new Set(routes.parallelLabels).size, routes.parallelLabels.length);
    assert.equal(new Set(routes.self).size, routes.self.length);
    assert.equal(new Set(routes.selfLabels).size, routes.selfLabels.length);
    const [first, second] = routes.selfLabelBoxes;
    assert.equal(
      first.left < second.right && first.right > second.left &&
        first.top < second.bottom && first.bottom > second.top,
      false,
    );
  }
  await page.close();
});

test("preserves FK labels, cardinality, and identifying styles for both route types", async () => {
  const page = await openPage();
  for (const mode of ["straight", "orthogonal"]) {
    await page.click(`[data-er-edge-routing="${mode}"]`);
    const result = await page.evaluate(() => {
      const identifying = document.querySelector(
        '[data-relationship-id="relationship_1"]',
      );
      const nonIdentifying = document.querySelector(
        '[data-relationship-id="relationship_2"]',
      );
      return {
        identifyingClass: identifying.classList.contains("er-edge-identifying"),
        nonIdentifyingClass: nonIdentifying.classList.contains("er-edge-non_identifying"),
        name: document.querySelector(
          '[data-relationship-label-id="relationship_2"]',
        ).textContent,
        parent: identifying.dataset.parentCardinality,
        child: identifying.dataset.childCardinality,
        cardinalities: Array.from(
          document.querySelectorAll('[data-relationship-cardinality-id="relationship_1"]'),
          (element) => element.textContent,
        ),
      };
    });
    assert.deepEqual(result, {
      identifyingClass: true,
      nonIdentifyingClass: true,
      name: "fk_orders_approved_by",
      parent: "exactly_one",
      child: "zero_or_many",
      cardinalities: ["1", "0..*"],
    });
  }
  await page.close();
});

test("reports storage failures explicitly and keeps the interactive diagram usable", async () => {
  const page = await openPage({
    clearStorage: false,
    beforeRouting: `
      window.routingStorageErrors = [];
      document.querySelector("#dbdef-er-viewer").addEventListener(
        "dbdef:er-edge-routing-storage-error",
        (event) => { window.routingStorageErrors.push(event.detail); },
      );
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage access is blocked.", "SecurityError");
        },
      });
    `,
  });
  await page.click('[data-er-edge-routing="orthogonal"]');
  const result = await page.evaluate(() => ({
    viewerReady: Boolean(window.dbdefErViewer),
    routingReady: Boolean(window.dbdefErEdgeRouting),
    mode: window.dbdefErEdgeRouting.getRoutingMode(),
    edgeCount: document.querySelectorAll(".er-edge").length,
    status: document.querySelector("#dbdef-er-edge-routing-status").textContent,
    failed: document.querySelector("#dbdef-er-edge-routing-status").dataset.status,
    errors: window.routingStorageErrors,
  }));
  assert.equal(result.viewerReady, true);
  assert.equal(result.routingReady, true);
  assert.equal(result.mode, "orthogonal");
  assert.equal(result.edgeCount, graph.relationships.length);
  assert.match(result.status, /保存できません/);
  assert.equal(result.failed, "error");
  assert.deepEqual(result.errors.map((error) => error.action), ["復元", "保存"]);
  assert.ok(result.errors.every((error) => error.name === "SecurityError"));
  await page.close();
});
