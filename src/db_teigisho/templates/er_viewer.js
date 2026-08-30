(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 3;
  const ZOOM_FACTOR = 1.2;
  const NODE_WIDTH = 300;
  const HEADER_HEIGHT = 56;
  const ROW_HEIGHT = 26;
  const NODE_GAP_X = 100;
  const NODE_GAP_Y = 80;
  const FIT_PADDING = 36;
  const MODES = new Set(["all", "keys", "tables"]);

  const section = document.querySelector("#er-diagram");
  const viewportElement = document.querySelector("#dbdef-er-viewer");
  const frame = document.querySelector(".er-diagram-frame");
  const graphElement = document.querySelector("#dbdef-er-graph");
  const zoomLevel = document.querySelector("#dbdef-er-zoom-level");
  if (!section || !viewportElement || !frame || !graphElement || !zoomLevel) {
    return;
  }

  const graph = JSON.parse(graphElement.textContent);
  if (graph.format_version !== "1.0" || !Array.isArray(graph.tables) ||
      !Array.isArray(graph.relationships)) {
    throw new Error("Unsupported or invalid embedded ER graph data.");
  }

  const svg = createSvgElement("svg", {
    class: "er-canvas",
    role: "img",
    "aria-label": "操作可能なER図",
  });
  const scene = createSvgElement("g", { class: "er-scene" });
  const edgesLayer = createSvgElement("g", { class: "er-edges" });
  const nodesLayer = createSvgElement("g", { class: "er-nodes" });
  scene.append(edgesLayer, nodesLayer);
  svg.append(scene);
  viewportElement.append(svg);

  const tableById = new Map(graph.tables.map((table) => [table.id, table]));
  const nodeElements = new Map();
  const nodeSizes = new Map();
  const edgeElements = new Map();
  const edgeLabelElements = new Map();
  const nodePositions = createInitialNodePositions(graph.tables);
  const state = {
    mode: "all",
    viewport: { scale: 1, x: 0, y: 0 },
  };
  let edgePathRenderer = defaultEdgePathRenderer;
  let panStart = null;

  function createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => {
      element.setAttribute(name, String(value));
    });
    return element;
  }

  function createInitialNodePositions(tables) {
    const positions = new Map();
    const columns = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
    const rowHeights = [];
    tables.forEach((table, index) => {
      const row = Math.floor(index / columns);
      const height = HEADER_HEIGHT + table.columns.length * ROW_HEIGHT;
      rowHeights[row] = Math.max(rowHeights[row] || 0, height);
    });
    const rowOffsets = rowHeights.map((_, row) =>
      rowHeights.slice(0, row).reduce((offset, height) => offset + height + NODE_GAP_Y, 0),
    );
    tables.forEach((table, index) => {
      const row = Math.floor(index / columns);
      positions.set(table.id, {
        x: (index % columns) * (NODE_WIDTH + NODE_GAP_X),
        y: rowOffsets[row],
      });
    });
    return positions;
  }

  function columnsForMode(table, mode) {
    if (mode === "tables") {
      return [];
    }
    if (mode === "keys") {
      return table.columns.filter((column) => column.key_roles.includes("PK") ||
        column.key_roles.includes("FK"));
    }
    return table.columns;
  }

  function visibleColumns(table) {
    return columnsForMode(table, state.mode);
  }

  function appendText(parent, text, attributes) {
    const element = createSvgElement("text", attributes);
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function renderNodes() {
    nodesLayer.replaceChildren();
    nodeElements.clear();
    nodeSizes.clear();
    graph.tables.forEach((table) => {
      const columns = visibleColumns(table);
      const height = HEADER_HEIGHT + columns.length * ROW_HEIGHT;
      const position = nodePositions.get(table.id);
      const node = createSvgElement("g", {
        class: "er-node",
        "data-table-id": table.id,
        role: "group",
        "aria-label": `${table.physical_name} / ${table.logical_name}`,
        transform: `translate(${position.x} ${position.y})`,
      });
      node.append(createSvgElement("rect", {
        class: "er-node-background",
        width: NODE_WIDTH,
        height,
        rx: 6,
      }));
      node.append(createSvgElement("rect", {
        class: "er-node-header",
        width: NODE_WIDTH,
        height: HEADER_HEIGHT,
        rx: 6,
      }));
      appendText(node, table.physical_name, {
        class: "er-node-physical",
        x: 14,
        y: 23,
      });
      appendText(node, table.logical_name, {
        class: "er-node-logical",
        x: 14,
        y: 44,
      });
      columns.forEach((column, index) => {
        const y = HEADER_HEIGHT + index * ROW_HEIGHT;
        const row = createSvgElement("g", {
          class: "er-column-row",
          "data-column-id": column.id,
        });
        row.append(createSvgElement("line", {
          class: "er-node-divider",
          x1: 0,
          y1: y,
          x2: NODE_WIDTH,
          y2: y,
        }));
        const roles = column.key_roles.join(" ");
        appendText(row, roles, {
          class: "er-column-roles",
          x: 12,
          y: y + 18,
        });
        appendText(row, column.physical_name, {
          class: "er-column-name",
          x: 62,
          y: y + 18,
        });
        appendText(row, formatColumnType(column), {
          class: "er-column-type",
          x: NODE_WIDTH - 12,
          y: y + 18,
          "text-anchor": "end",
        });
        node.append(row);
      });
      nodesLayer.append(node);
      nodeElements.set(table.id, node);
      nodeSizes.set(table.id, { width: NODE_WIDTH, height });
    });
  }

  function formatColumnType(column) {
    if (column.length === null) {
      return column.data_type;
    }
    return column.scale === null
      ? `${column.data_type}(${column.length})`
      : `${column.data_type}(${column.length},${column.scale})`;
  }

  function nodeGeometry(tableId) {
    const position = nodePositions.get(tableId);
    const size = nodeSizes.get(tableId);
    if (!position || !size) {
      throw new Error(`Unknown ER table node: ${tableId}`);
    }
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      centerX: position.x + size.width / 2,
      centerY: position.y + size.height / 2,
    };
  }

  function connectionPoints(source, target) {
    const dx = target.centerX - source.centerX;
    const dy = target.centerY - source.centerY;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        source: {
          x: dx >= 0 ? source.x + source.width : source.x,
          y: source.centerY,
        },
        target: {
          x: dx >= 0 ? target.x : target.x + target.width,
          y: target.centerY,
        },
      };
    }
    return {
      source: {
        x: source.centerX,
        y: dy >= 0 ? source.y + source.height : source.y,
      },
      target: {
        x: target.centerX,
        y: dy >= 0 ? target.y : target.y + target.height,
      },
    };
  }

  function defaultEdgePathRenderer({ relationship, source, target }) {
    if (relationship.parent_table_id === relationship.child_table_id) {
      const startX = source.x + source.width;
      const startY = source.y + source.height * 0.35;
      const endY = source.y + source.height * 0.7;
      const loopX = startX + 70;
      return `M ${startX} ${startY} C ${loopX} ${startY}, ${loopX} ${endY}, ${startX} ${endY}`;
    }
    const points = connectionPoints(source, target);
    const dx = Math.abs(points.target.x - points.source.x);
    const dy = Math.abs(points.target.y - points.source.y);
    if (dx >= dy) {
      const middleX = (points.source.x + points.target.x) / 2;
      return `M ${points.source.x} ${points.source.y} C ${middleX} ${points.source.y}, ` +
        `${middleX} ${points.target.y}, ${points.target.x} ${points.target.y}`;
    }
    const middleY = (points.source.y + points.target.y) / 2;
    return `M ${points.source.x} ${points.source.y} C ${points.source.x} ${middleY}, ` +
      `${points.target.x} ${middleY}, ${points.target.x} ${points.target.y}`;
  }

  function edgeLabelPosition(source, target) {
    if (source.x === target.x && source.y === target.y) {
      return { x: source.x + source.width + 74, y: source.y + source.height / 2 };
    }
    return {
      x: (source.centerX + target.centerX) / 2,
      y: (source.centerY + target.centerY) / 2 - 8,
    };
  }

  function redrawEdges({ emit = true } = {}) {
    const activeIds = new Set();
    graph.relationships.forEach((relationship) => {
      activeIds.add(relationship.id);
      let edge = edgeElements.get(relationship.id);
      let label = edgeLabelElements.get(relationship.id);
      if (!edge) {
        edge = createSvgElement("path", {
          class: `er-edge er-edge-${relationship.relationship_type}`,
          "data-relationship-id": relationship.id,
          "data-parent-table-id": relationship.parent_table_id,
          "data-child-table-id": relationship.child_table_id,
        });
        edgesLayer.append(edge);
        edgeElements.set(relationship.id, edge);
      }
      if (!label) {
        label = appendText(edgesLayer, relationship.name, {
          class: "er-edge-label",
          "data-relationship-label-id": relationship.id,
          "text-anchor": "middle",
        });
        edgeLabelElements.set(relationship.id, label);
      }
      const source = nodeGeometry(relationship.parent_table_id);
      const target = nodeGeometry(relationship.child_table_id);
      const path = edgePathRenderer({ relationship, source, target });
      if (typeof path !== "string" || path.length === 0) {
        throw new TypeError("The ER edge path renderer must return a non-empty SVG path string.");
      }
      edge.setAttribute("d", path);
      const labelPosition = edgeLabelPosition(source, target);
      label.setAttribute("x", String(labelPosition.x));
      label.setAttribute("y", String(labelPosition.y));
    });
    edgeElements.forEach((element, id) => {
      if (!activeIds.has(id)) {
        element.remove();
        edgeElements.delete(id);
        edgeLabelElements.get(id)?.remove();
        edgeLabelElements.delete(id);
      }
    });
    if (emit) {
      emitEvent("dbdef:er-edges-redrawn", {
        relationshipIds: graph.relationships.map((relationship) => relationship.id),
      });
    }
  }

  function updateSceneTransform() {
    const { scale, x, y } = state.viewport;
    scene.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
  }

  function emitEvent(type, detail) {
    viewportElement.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function publicState() {
    return {
      mode: state.mode,
      viewport: { ...state.viewport },
      nodePositions: Object.fromEntries(
        Array.from(nodePositions, ([id, position]) => [id, { ...position }]),
      ),
    };
  }

  function setViewport(next, reason = "api") {
    const scale = next.scale === undefined
      ? state.viewport.scale
      : Math.min(MAX_SCALE, Math.max(MIN_SCALE, finiteNumber(next.scale, "scale")));
    const x = next.x === undefined ? state.viewport.x : finiteNumber(next.x, "x");
    const y = next.y === undefined ? state.viewport.y : finiteNumber(next.y, "y");
    state.viewport = { scale, x, y };
    updateSceneTransform();
    emitEvent("dbdef:er-view-change", { reason, state: publicState() });
  }

  function finiteNumber(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`ER viewer ${name} must be a finite number.`);
    }
    return value;
  }

  function zoomAt(factor, clientX, clientY, reason) {
    const rectangle = frame.getBoundingClientRect();
    const anchorX = clientX - rectangle.left;
    const anchorY = clientY - rectangle.top;
    const previous = state.viewport;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale * factor));
    const graphX = (anchorX - previous.x) / previous.scale;
    const graphY = (anchorY - previous.y) / previous.scale;
    setViewport({
      scale,
      x: anchorX - graphX * scale,
      y: anchorY - graphY * scale,
    }, reason);
  }

  function zoomFromCenter(factor, reason) {
    const rectangle = frame.getBoundingClientRect();
    zoomAt(
      factor,
      rectangle.left + rectangle.width / 2,
      rectangle.top + rectangle.height / 2,
      reason,
    );
  }

  function graphBounds() {
    if (graph.tables.length === 0) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }
    const geometries = graph.tables.map((table) => nodeGeometry(table.id));
    const minX = Math.min(...geometries.map((item) => item.x));
    const minY = Math.min(...geometries.map((item) => item.y));
    const maxX = Math.max(...geometries.map((item) => item.x + item.width));
    const maxY = Math.max(...geometries.map((item) => item.y + item.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function fitToView() {
    const bounds = graphBounds();
    const width = frame.clientWidth || 960;
    const height = frame.clientHeight || 520;
    const scale = Math.min(
      (width - FIT_PADDING * 2) / Math.max(bounds.width, 1),
      (height - FIT_PADDING * 2) / Math.max(bounds.height, 1),
      1,
    );
    const boundedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    setViewport({
      scale: boundedScale,
      x: (width - bounds.width * boundedScale) / 2 - bounds.x * boundedScale,
      y: (height - bounds.height * boundedScale) / 2 - bounds.y * boundedScale,
    }, "fit");
  }

  function setMode(mode) {
    if (!MODES.has(mode)) {
      throw new TypeError(`Unknown ER column display mode: ${mode}`);
    }
    state.mode = mode;
    document.querySelectorAll("[data-er-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.erMode === mode));
    });
    renderNodes();
    redrawEdges();
    emitEvent("dbdef:er-view-change", { reason: "mode", state: publicState() });
  }

  function getNodePosition(tableId) {
    const position = nodePositions.get(tableId);
    if (!position) {
      throw new Error(`Unknown ER table node: ${tableId}`);
    }
    return { ...position };
  }

  function getNodeSize(tableId, mode = "all") {
    const table = tableById.get(tableId);
    if (!table) {
      throw new Error(`Unknown ER table node: ${tableId}`);
    }
    if (!MODES.has(mode)) {
      throw new TypeError(`Unknown ER column display mode: ${mode}`);
    }
    return {
      width: NODE_WIDTH,
      height: HEADER_HEIGHT + columnsForMode(table, mode).length * ROW_HEIGHT,
    };
  }

  function normalizePosition(tableId, position) {
    if (!tableById.has(tableId)) {
      throw new Error(`Unknown ER table node: ${tableId}`);
    }
    return {
      x: finiteNumber(position.x, `${tableId}.x`),
      y: finiteNumber(position.y, `${tableId}.y`),
    };
  }

  function setNodePositions(positions, { source = "api", emit = true } = {}) {
    const entries = positions instanceof Map ? Array.from(positions) : Object.entries(positions);
    const normalized = entries.map(([tableId, position]) => [
      tableId,
      normalizePosition(tableId, position),
    ]);
    normalized.forEach(([tableId, position]) => {
      nodePositions.set(tableId, position);
      nodeElements.get(tableId)?.setAttribute(
        "transform",
        `translate(${position.x} ${position.y})`,
      );
    });
    redrawEdges({ emit });
    if (emit) {
      normalized.forEach(([tableId, position]) => {
        emitEvent("dbdef:er-node-position-change", {
          tableId,
          position: { ...position },
          source,
        });
      });
    }
  }

  function setNodePosition(tableId, position, options) {
    setNodePositions({ [tableId]: position }, options);
  }

  function setEdgePathRenderer(renderer) {
    if (renderer !== null && typeof renderer !== "function") {
      throw new TypeError("The ER edge path renderer must be a function or null.");
    }
    edgePathRenderer = renderer || defaultEdgePathRenderer;
    redrawEdges();
  }

  function screenToGraphPoint(clientX, clientY) {
    const rectangle = frame.getBoundingClientRect();
    return {
      x: (finiteNumber(clientX, "clientX") - rectangle.left - state.viewport.x) /
        state.viewport.scale,
      y: (finiteNumber(clientY, "clientY") - rectangle.top - state.viewport.y) /
        state.viewport.scale,
    };
  }

  function setViewState(next) {
    if (next.mode !== undefined) {
      setMode(next.mode);
    }
    if (next.nodePositions !== undefined) {
      setNodePositions(next.nodePositions);
    }
    if (next.viewport !== undefined) {
      setViewport(next.viewport);
    }
  }

  document.querySelectorAll("[data-er-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.erMode));
  });
  document.querySelector('[data-er-action="zoom-in"]')?.addEventListener(
    "click",
    () => zoomFromCenter(ZOOM_FACTOR, "button"),
  );
  document.querySelector('[data-er-action="zoom-out"]')?.addEventListener(
    "click",
    () => zoomFromCenter(1 / ZOOM_FACTOR, "button"),
  );
  document.querySelector('[data-er-action="fit"]')?.addEventListener("click", fitToView);
  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY, "wheel");
  }, { passive: false });
  frame.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    panStart = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: state.viewport.x,
      y: state.viewport.y,
    };
    frame.setPointerCapture(event.pointerId);
    frame.classList.add("er-is-panning");
    event.preventDefault();
  });
  frame.addEventListener("pointermove", (event) => {
    if (!panStart || event.pointerId !== panStart.pointerId) {
      return;
    }
    setViewport({
      x: panStart.x + event.clientX - panStart.clientX,
      y: panStart.y + event.clientY - panStart.clientY,
    }, "pan");
  });
  const finishPan = (event) => {
    if (!panStart || event.pointerId !== panStart.pointerId) {
      return;
    }
    panStart = null;
    frame.classList.remove("er-is-panning");
  };
  frame.addEventListener("pointerup", finishPan);
  frame.addEventListener("pointercancel", finishPan);

  renderNodes();
  redrawEdges({ emit: false });
  updateSceneTransform();
  section.classList.add("er-interactive-ready");
  fitToView();

  window.dbdefErViewer = Object.freeze({
    version: "1.0",
    limits: Object.freeze({ minScale: MIN_SCALE, maxScale: MAX_SCALE }),
    getGraph: () => JSON.parse(JSON.stringify(graph)),
    getState: publicState,
    setViewState,
    setMode,
    setViewport,
    fitToView,
    zoomIn: () => zoomFromCenter(ZOOM_FACTOR, "api"),
    zoomOut: () => zoomFromCenter(1 / ZOOM_FACTOR, "api"),
    getNodePosition,
    getNodeSize,
    setNodePosition,
    setNodePositions,
    redrawEdges,
    setEdgePathRenderer,
    screenToGraphPoint,
  });
})();
