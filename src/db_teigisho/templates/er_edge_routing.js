(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "dbdef:er-edge-routing:v1";
  const ROUTING_MODES = new Set(["straight", "orthogonal"]);
  const PARALLEL_GAP = 20;
  const PORT_PADDING = 24;
  const SELF_LOOP_BASE = 64;
  const SELF_LOOP_GAP = 28;
  const section = document.querySelector("#er-diagram");
  const viewportElement = document.querySelector("#dbdef-er-viewer");
  const statusElement = document.querySelector("#dbdef-er-edge-routing-status");
  const viewer = window.dbdefErViewer;
  if (!section || !viewportElement || !statusElement || !viewer) {
    return;
  }

  const graph = viewer.getGraph();
  const routes = new Map();
  const laneByRelationship = relationshipLanes(graph.relationships);
  let routingMode = "straight";

  function relationshipLanes(relationships) {
    const groups = new Map();
    relationships.forEach((relationship) => {
      const tableIds = [
        relationship.parent_table_id,
        relationship.child_table_id,
      ].sort();
      const key = relationship.parent_table_id === relationship.child_table_id
        ? `self:${relationship.parent_table_id}`
        : `pair:${tableIds.join(":")}`;
      const group = groups.get(key) || [];
      group.push(relationship.id);
      groups.set(key, group);
    });
    return new Map(Array.from(groups.values()).flatMap((ids) =>
      ids.map((id, index) => [
        id,
        {
          lane: index - (ids.length - 1) / 2,
          index,
          count: ids.length,
        },
      ])));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function portOffset(laneInfo, size) {
    if (laneInfo.count === 1) {
      return 0;
    }
    const available = Math.max(0, size - 32);
    const step = Math.min(PARALLEL_GAP, available / (laneInfo.count - 1));
    return laneInfo.lane * step;
  }

  function connectionPoints(source, target, laneInfo) {
    const dx = target.centerX - source.centerX;
    const dy = target.centerY - source.centerY;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        axis: "horizontal",
        source: {
          x: dx >= 0 ? source.x + source.width : source.x,
          y: clamp(
            source.centerY + portOffset(laneInfo, source.height),
            source.y + 16,
            source.y + source.height - 16,
          ),
        },
        target: {
          x: dx >= 0 ? target.x : target.x + target.width,
          y: clamp(
            target.centerY + portOffset(laneInfo, target.height),
            target.y + 16,
            target.y + target.height - 16,
          ),
        },
      };
    }
    return {
      axis: "vertical",
      source: {
        x: clamp(
          source.centerX + portOffset(laneInfo, source.width),
          source.x + 16,
          source.x + source.width - 16,
        ),
        y: dy >= 0 ? source.y + source.height : source.y,
      },
      target: {
        x: clamp(
          target.centerX + portOffset(laneInfo, target.width),
          target.x + 16,
          target.x + target.width - 16,
        ),
        y: dy >= 0 ? target.y : target.y + target.height,
      },
    };
  }

  function pointBetween(source, target, ratio) {
    return {
      x: source.x + (target.x - source.x) * ratio,
      y: source.y + (target.y - source.y) * ratio,
    };
  }

  function selfRoute(relationship, source, mode) {
    const { index } = laneByRelationship.get(relationship.id);
    const loopX = source.x + source.width + SELF_LOOP_BASE + index * SELF_LOOP_GAP;
    const anchorOffset = index * 6;
    const start = {
      x: source.x + source.width,
      y: source.y + source.height * 0.3 + anchorOffset,
    };
    const end = {
      x: source.x + source.width,
      y: source.y + source.height * 0.7 - anchorOffset,
    };
    const path = mode === "straight"
      ? `M ${start.x} ${start.y} C ${loopX} ${start.y}, ${loopX} ${end.y}, ` +
        `${end.x} ${end.y}`
      : `M ${start.x} ${start.y} L ${loopX} ${start.y} L ${loopX} ${end.y} ` +
        `L ${end.x} ${end.y}`;
    return {
      path,
      label: { x: loopX + 8, y: (start.y + end.y) / 2 - 8 + index * 20 },
      parentCardinality: { x: start.x + 20, y: start.y - 6 },
      childCardinality: { x: end.x + 20, y: end.y + 13 },
    };
  }

  function straightRoute({ relationship, source, target }) {
    if (relationship.parent_table_id === relationship.child_table_id) {
      const route = selfRoute(relationship, source, "straight");
      routes.set(relationship.id, route);
      return route.path;
    }
    const laneInfo = laneByRelationship.get(relationship.id);
    const points = connectionPoints(source, target, laneInfo);
    const route = {
      path: `M ${points.source.x} ${points.source.y} L ${points.target.x} ${points.target.y}`,
      label: pointBetween(points.source, points.target, 0.5),
      parentCardinality: pointBetween(points.source, points.target, 0.12),
      childCardinality: pointBetween(points.source, points.target, 0.88),
    };
    route.label.y -= 8;
    routes.set(relationship.id, route);
    return route.path;
  }

  function orthogonalRoute({ relationship, source, target }) {
    if (relationship.parent_table_id === relationship.child_table_id) {
      const route = selfRoute(relationship, source, "orthogonal");
      routes.set(relationship.id, route);
      return route.path;
    }
    const laneInfo = laneByRelationship.get(relationship.id);
    const points = connectionPoints(source, target, laneInfo);
    let path;
    let label;
    let parentCardinality;
    let childCardinality;
    if (points.axis === "horizontal") {
      const direction = Math.sign(points.target.x - points.source.x) || 1;
      const sourceStub = {
        x: points.source.x + direction * PORT_PADDING,
        y: points.source.y,
      };
      const targetStub = {
        x: points.target.x - direction * PORT_PADDING,
        y: points.target.y,
      };
      const channelX = (sourceStub.x + targetStub.x) / 2 +
        laneInfo.lane * PARALLEL_GAP;
      path = `M ${points.source.x} ${points.source.y} L ${sourceStub.x} ${sourceStub.y} ` +
        `L ${channelX} ${sourceStub.y} L ${channelX} ${targetStub.y} ` +
        `L ${targetStub.x} ${targetStub.y} L ${points.target.x} ${points.target.y}`;
      label = {
        x: channelX,
        y: (sourceStub.y + targetStub.y) / 2 - 8,
      };
      parentCardinality = pointBetween(points.source, sourceStub, 0.85);
      childCardinality = pointBetween(targetStub, points.target, 0.15);
    } else {
      const direction = Math.sign(points.target.y - points.source.y) || 1;
      const sourceStub = {
        x: points.source.x,
        y: points.source.y + direction * PORT_PADDING,
      };
      const targetStub = {
        x: points.target.x,
        y: points.target.y - direction * PORT_PADDING,
      };
      const channelY = (sourceStub.y + targetStub.y) / 2 +
        laneInfo.lane * PARALLEL_GAP;
      path = `M ${points.source.x} ${points.source.y} L ${sourceStub.x} ${sourceStub.y} ` +
        `L ${sourceStub.x} ${channelY} L ${targetStub.x} ${channelY} ` +
        `L ${targetStub.x} ${targetStub.y} L ${points.target.x} ${points.target.y}`;
      label = {
        x: (sourceStub.x + targetStub.x) / 2,
        y: channelY - 8,
      };
      parentCardinality = pointBetween(points.source, sourceStub, 0.85);
      childCardinality = pointBetween(targetStub, points.target, 0.15);
    }
    const route = { path, label, parentCardinality, childCardinality };
    routes.set(relationship.id, route);
    return route.path;
  }

  const strategies = Object.freeze({
    straight: straightRoute,
    orthogonal: orthogonalRoute,
  });

  function cardinalityText(cardinality) {
    return {
      zero_or_one: "0..1",
      exactly_one: "1",
      zero_or_many: "0..*",
    }[cardinality];
  }

  function cardinalityElement(layer, relationship, end) {
    const selector = `[data-relationship-cardinality-id="${relationship.id}"]` +
      `[data-cardinality-end="${end}"]`;
    let element = layer.querySelector(selector);
    if (!element) {
      element = document.createElementNS(SVG_NS, "text");
      element.setAttribute("class", "er-edge-cardinality");
      element.setAttribute("data-relationship-cardinality-id", relationship.id);
      element.setAttribute("data-cardinality-end", end);
      element.setAttribute("text-anchor", "middle");
      layer.append(element);
    }
    return element;
  }

  function positionElement(element, point) {
    element.setAttribute("x", String(point.x));
    element.setAttribute("y", String(point.y));
  }

  function applyDecorations() {
    graph.relationships.forEach((relationship) => {
      const route = routes.get(relationship.id);
      const edge = viewportElement.querySelector(
        `[data-relationship-id="${relationship.id}"]`,
      );
      const label = viewportElement.querySelector(
        `[data-relationship-label-id="${relationship.id}"]`,
      );
      if (!route || !edge || !label || !edge.parentElement) {
        throw new Error(`Missing rendered ER relationship: ${relationship.id}`);
      }
      edge.dataset.edgeRouting = routingMode;
      edge.dataset.parentCardinality = relationship.parent_cardinality;
      edge.dataset.childCardinality = relationship.child_cardinality;
      positionElement(label, route.label);

      const parent = cardinalityElement(edge.parentElement, relationship, "parent");
      parent.textContent = cardinalityText(relationship.parent_cardinality);
      parent.setAttribute("data-cardinality", relationship.parent_cardinality);
      parent.setAttribute(
        "aria-label",
        `親側カーディナリティ: ${parent.textContent}`,
      );
      positionElement(parent, route.parentCardinality);

      const child = cardinalityElement(edge.parentElement, relationship, "child");
      child.textContent = cardinalityText(relationship.child_cardinality);
      child.setAttribute("data-cardinality", relationship.child_cardinality);
      child.setAttribute(
        "aria-label",
        `子側カーディナリティ: ${child.textContent}`,
      );
      positionElement(child, route.childCardinality);
    });
  }

  function setStatus(message, status = "info") {
    statusElement.textContent = message;
    statusElement.dataset.status = status;
  }

  function isExpectedStorageError(error) {
    return error instanceof DOMException && new Set([
      "SecurityError",
      "QuotaExceededError",
      "NS_ERROR_DOM_QUOTA_REACHED",
    ]).has(error.name);
  }

  function reportStorageError(action, error) {
    setStatus(`線種を${action}できません。ブラウザの保存領域を確認してください。`, "error");
    viewportElement.dispatchEvent(new CustomEvent("dbdef:er-edge-routing-storage-error", {
      detail: { action, name: error.name, message: error.message },
    }));
  }

  function getStorage(action) {
    try {
      return window.localStorage;
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError(action, error);
        return null;
      }
      throw error;
    }
  }

  function restoreRoutingMode() {
    const storage = getStorage("復元");
    if (storage === null) {
      return "straight";
    }
    let stored;
    try {
      stored = storage.getItem(STORAGE_KEY);
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError("復元", error);
        return "straight";
      }
      throw error;
    }
    if (stored === null) {
      return "straight";
    }
    if (!ROUTING_MODES.has(stored)) {
      setStatus("保存済み線種が不正なため、直線を使用します。", "error");
      return "straight";
    }
    return stored;
  }

  function saveRoutingMode(mode) {
    const storage = getStorage("保存");
    if (storage === null) {
      return false;
    }
    try {
      storage.setItem(STORAGE_KEY, mode);
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError("保存", error);
        return false;
      }
      throw error;
    }
    setStatus("線種を保存しました。");
    return true;
  }

  function setRoutingMode(mode, { persist = true, emit = true } = {}) {
    if (!ROUTING_MODES.has(mode)) {
      throw new TypeError(`Unknown ER edge routing mode: ${mode}`);
    }
    routingMode = mode;
    document.querySelectorAll("[data-er-edge-routing]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.erEdgeRouting === mode));
    });
    viewer.setEdgePathRenderer(strategies[mode]);
    if (persist) {
      saveRoutingMode(mode);
    }
    if (emit) {
      viewportElement.dispatchEvent(new CustomEvent("dbdef:er-edge-routing-change", {
        detail: { mode },
      }));
    }
  }

  viewportElement.addEventListener("dbdef:er-edges-redrawn", applyDecorations);
  document.querySelectorAll("[data-er-edge-routing]").forEach((button) => {
    button.addEventListener("click", () => setRoutingMode(button.dataset.erEdgeRouting));
  });
  setRoutingMode(restoreRoutingMode(), { persist: false, emit: false });

  window.dbdefErEdgeRouting = Object.freeze({
    version: "1.0",
    getRoutingMode: () => routingMode,
    getStorageKey: () => STORAGE_KEY,
    setRoutingMode,
    strategies,
  });
})();
