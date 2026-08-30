(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MODE_STORAGE_KEY = "dbdef:er-edge-routing:v1";
  const LINE_JUMP_STORAGE_KEY = "dbdef:er-line-jumps:v1";
  const ROUTE_STORAGE_NAMESPACE = "dbdef:er-route-layout:v1";
  const ROUTE_RECORD_VERSION = 1;
  const ROUTING_MODES = new Set(["curve", "straight", "orthogonal"]);
  const PARALLEL_GAP = 20;
  const PORT_PADDING = 24;
  const SELF_LOOP_BASE = 64;
  const SELF_LOOP_GAP = 28;
  const JUMP_RADIUS = 7;
  const KEYBOARD_MOVE_STEP = 10;
  const ROUTE_OFFSET_LIMIT = 10_000;
  const section = document.querySelector("#er-diagram");
  const viewportElement = document.querySelector("#dbdef-er-viewer");
  const statusElement = document.querySelector("#dbdef-er-edge-routing-status");
  const viewer = window.dbdefErViewer;
  if (!section || !viewportElement || !statusElement || !viewer) {
    return;
  }

  const graph = viewer.getGraph();
  const relationshipById = new Map(graph.relationships.map((item) => [item.id, item]));
  const routes = new Map();
  const routeOffsets = new Map();
  const laneByRelationship = relationshipLanes(graph.relationships);
  const graphFingerprint = fingerprintGraph(graph);
  const definitionId = section.dataset.erDefinitionId || "anonymous";
  const routeStoragePrefix = `${ROUTE_STORAGE_NAMESPACE}:${definitionId}:`;
  const routeStorageKey = `${routeStoragePrefix}${graphFingerprint}`;
  let routingMode = "straight";
  let lineJumpsEnabled = true;
  let dragState = null;

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

  function fingerprintGraph(graphData) {
    const tableNames = new Map(
      graphData.tables.map((table) => [table.id, table.physical_name]),
    );
    const value = JSON.stringify({
      version: ROUTE_RECORD_VERSION,
      graphFormatVersion: graphData.format_version,
      tables: graphData.tables.map((table) => ({
        name: table.physical_name,
        columns: table.columns.map((column) => column.physical_name),
      })),
      relationships: graphData.relationships.map((relationship) => ({
        name: relationship.name,
        parent: tableNames.get(relationship.parent_table_id),
        child: tableNames.get(relationship.child_table_id),
      })),
    });
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193);
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, "0")}` +
      `${(second >>> 0).toString(16).padStart(8, "0")}`;
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

  function polylinePath(points) {
    return points.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }

  function selfRoute(relationship, source, mode) {
    const { index } = laneByRelationship.get(relationship.id);
    const automaticX = source.x + source.width + SELF_LOOP_BASE + index * SELF_LOOP_GAP;
    const loopX = automaticX + (
      mode === "orthogonal" ? (routeOffsets.get(relationship.id) || 0) : 0
    );
    const anchorOffset = index * 6;
    const start = {
      x: source.x + source.width,
      y: source.y + source.height * 0.3 + anchorOffset,
    };
    const end = {
      x: source.x + source.width,
      y: source.y + source.height * 0.7 - anchorOffset,
    };
    const points = [
      start,
      { x: loopX, y: start.y },
      { x: loopX, y: end.y },
      end,
    ];
    const path = mode === "curve"
      ? `M ${start.x} ${start.y} C ${loopX} ${start.y}, ${loopX} ${end.y}, ` +
        `${end.x} ${end.y}`
      : polylinePath(points);
    return {
      path,
      points: mode === "orthogonal" ? points : null,
      editable: mode === "orthogonal"
        ? { segmentIndex: 2, axis: "vertical", movementAxis: "x" }
        : null,
      label: { x: loopX + 8, y: (start.y + end.y) / 2 - 8 + index * 20 },
      parentCardinality: { x: start.x + 20, y: start.y - 6 },
      childCardinality: { x: end.x + 20, y: end.y + 13 },
      relationship,
    };
  }

  function curveRoute({ relationship, source, target }) {
    if (relationship.parent_table_id === relationship.child_table_id) {
      const route = selfRoute(relationship, source, "curve");
      routes.set(relationship.id, route);
      return route.path;
    }
    const laneInfo = laneByRelationship.get(relationship.id);
    const points = connectionPoints(source, target, laneInfo);
    let path;
    if (points.axis === "horizontal") {
      const middleX = (points.source.x + points.target.x) / 2 +
        laneInfo.lane * PARALLEL_GAP;
      path = `M ${points.source.x} ${points.source.y} ` +
        `C ${middleX} ${points.source.y}, ${middleX} ${points.target.y}, ` +
        `${points.target.x} ${points.target.y}`;
    } else {
      const middleY = (points.source.y + points.target.y) / 2 +
        laneInfo.lane * PARALLEL_GAP;
      path = `M ${points.source.x} ${points.source.y} ` +
        `C ${points.source.x} ${middleY}, ${points.target.x} ${middleY}, ` +
        `${points.target.x} ${points.target.y}`;
    }
    const route = {
      path,
      points: null,
      editable: null,
      label: pointBetween(points.source, points.target, 0.5),
      parentCardinality: pointBetween(points.source, points.target, 0.12),
      childCardinality: pointBetween(points.source, points.target, 0.88),
      relationship,
    };
    route.label.y -= 8;
    routes.set(relationship.id, route);
    return route.path;
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
      path: `M ${points.source.x} ${points.source.y} ` +
        `L ${points.target.x} ${points.target.y}`,
      points: null,
      editable: null,
      label: pointBetween(points.source, points.target, 0.5),
      parentCardinality: pointBetween(points.source, points.target, 0.12),
      childCardinality: pointBetween(points.source, points.target, 0.88),
      relationship,
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
    const connection = connectionPoints(source, target, laneInfo);
    const offset = routeOffsets.get(relationship.id) || 0;
    let points;
    let label;
    let parentCardinality;
    let childCardinality;
    let editable;
    if (connection.axis === "horizontal") {
      const direction = Math.sign(connection.target.x - connection.source.x) || 1;
      const sourceStub = {
        x: connection.source.x + direction * PORT_PADDING,
        y: connection.source.y,
      };
      const targetStub = {
        x: connection.target.x - direction * PORT_PADDING,
        y: connection.target.y,
      };
      if (sourceStub.y === targetStub.y) {
        const channelY = sourceStub.y + offset;
        points = [
          connection.source,
          sourceStub,
          { x: sourceStub.x, y: channelY },
          { x: targetStub.x, y: channelY },
          targetStub,
          connection.target,
        ];
        label = {
          x: (sourceStub.x + targetStub.x) / 2,
          y: channelY - 8,
        };
        editable = { segmentIndex: 3, axis: "horizontal", movementAxis: "y" };
      } else {
        const channelX = (sourceStub.x + targetStub.x) / 2 +
          laneInfo.lane * PARALLEL_GAP + offset;
        points = [
          connection.source,
          sourceStub,
          { x: channelX, y: sourceStub.y },
          { x: channelX, y: targetStub.y },
          targetStub,
          connection.target,
        ];
        label = {
          x: channelX,
          y: (sourceStub.y + targetStub.y) / 2 - 8,
        };
        editable = { segmentIndex: 3, axis: "vertical", movementAxis: "x" };
      }
      parentCardinality = pointBetween(connection.source, sourceStub, 0.85);
      childCardinality = pointBetween(targetStub, connection.target, 0.15);
    } else {
      const direction = Math.sign(connection.target.y - connection.source.y) || 1;
      const sourceStub = {
        x: connection.source.x,
        y: connection.source.y + direction * PORT_PADDING,
      };
      const targetStub = {
        x: connection.target.x,
        y: connection.target.y - direction * PORT_PADDING,
      };
      if (sourceStub.x === targetStub.x) {
        const channelX = sourceStub.x + offset;
        points = [
          connection.source,
          sourceStub,
          { x: channelX, y: sourceStub.y },
          { x: channelX, y: targetStub.y },
          targetStub,
          connection.target,
        ];
        label = {
          x: channelX,
          y: (sourceStub.y + targetStub.y) / 2 - 8,
        };
        editable = { segmentIndex: 3, axis: "vertical", movementAxis: "x" };
      } else {
        const channelY = (sourceStub.y + targetStub.y) / 2 +
          laneInfo.lane * PARALLEL_GAP + offset;
        points = [
          connection.source,
          sourceStub,
          { x: sourceStub.x, y: channelY },
          { x: targetStub.x, y: channelY },
          targetStub,
          connection.target,
        ];
        label = {
          x: (sourceStub.x + targetStub.x) / 2,
          y: channelY - 8,
        };
        editable = { segmentIndex: 3, axis: "horizontal", movementAxis: "y" };
      }
      parentCardinality = pointBetween(connection.source, sourceStub, 0.85);
      childCardinality = pointBetween(targetStub, connection.target, 0.15);
    }
    const route = {
      path: polylinePath(points),
      points,
      editable,
      label,
      parentCardinality,
      childCardinality,
      relationship,
    };
    routes.set(relationship.id, route);
    return route.path;
  }

  const strategies = Object.freeze({
    curve: curveRoute,
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

  function segmentFor(route, segmentIndex) {
    return {
      start: route.points[segmentIndex - 1],
      end: route.points[segmentIndex],
    };
  }

  function segmentAxis(start, end) {
    if (start.x === end.x && start.y !== end.y) {
      return "vertical";
    }
    if (start.y === end.y && start.x !== end.x) {
      return "horizontal";
    }
    return null;
  }

  function between(value, first, second, padding = 0) {
    return value > Math.min(first, second) + padding &&
      value < Math.max(first, second) - padding;
  }

  function lineJumpCrossings() {
    const crossings = new Map();
    const routeEntries = Array.from(routes.entries()).filter(([, route]) => route.points);
    for (let leftIndex = 0; leftIndex < routeEntries.length; leftIndex += 1) {
      const [leftId, leftRoute] = routeEntries[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < routeEntries.length; rightIndex += 1) {
        const [rightId, rightRoute] = routeEntries[rightIndex];
        for (let leftSegment = 1; leftSegment < leftRoute.points.length; leftSegment += 1) {
          const left = segmentFor(leftRoute, leftSegment);
          const leftAxis = segmentAxis(left.start, left.end);
          if (leftAxis === null) {
            continue;
          }
          for (
            let rightSegment = 1;
            rightSegment < rightRoute.points.length;
            rightSegment += 1
          ) {
            const right = segmentFor(rightRoute, rightSegment);
            const rightAxis = segmentAxis(right.start, right.end);
            if (rightAxis === null || leftAxis === rightAxis) {
              continue;
            }
            const vertical = leftAxis === "vertical"
              ? { id: leftId, route: leftRoute, index: leftSegment, ...left }
              : { id: rightId, route: rightRoute, index: rightSegment, ...right };
            const horizontal = leftAxis === "horizontal" ? left : right;
            const x = vertical.start.x;
            const y = horizontal.start.y;
            if (!between(y, vertical.start.y, vertical.end.y, JUMP_RADIUS + 1) ||
                !between(x, horizontal.start.x, horizontal.end.x, JUMP_RADIUS + 1)) {
              continue;
            }
            const routeCrossings = crossings.get(vertical.id) || new Map();
            const segmentCrossings = routeCrossings.get(vertical.index) || [];
            if (!segmentCrossings.some((crossing) =>
              Math.abs(crossing.x - x) < 0.001 && Math.abs(crossing.y - y) < 0.001)) {
              segmentCrossings.push({ x, y });
            }
            routeCrossings.set(vertical.index, segmentCrossings);
            crossings.set(vertical.id, routeCrossings);
          }
        }
      }
    }
    return crossings;
  }

  function pathWithJumps(route, routeCrossings) {
    const commands = [`M ${route.points[0].x} ${route.points[0].y}`];
    const arcs = [];
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      const points = [...(routeCrossings?.get(index) || [])];
      points.sort((left, right) => {
        if (start.x === end.x) {
          return Math.sign(end.y - start.y) * (left.y - right.y);
        }
        return Math.sign(end.x - start.x) * (left.x - right.x);
      });
      points.forEach((crossing) => {
        if (start.x === end.x) {
          const direction = Math.sign(end.y - start.y);
          const before = { x: crossing.x, y: crossing.y - direction * JUMP_RADIUS };
          const after = { x: crossing.x, y: crossing.y + direction * JUMP_RADIUS };
          const controlX = crossing.x + JUMP_RADIUS;
          commands.push(
            `L ${before.x} ${before.y}`,
            `C ${controlX} ${before.y}, ${controlX} ${after.y}, ${after.x} ${after.y}`,
          );
          arcs.push(
            `M ${before.x} ${before.y} ` +
            `C ${controlX} ${before.y}, ${controlX} ${after.y}, ${after.x} ${after.y}`,
          );
        }
      });
      commands.push(`L ${end.x} ${end.y}`);
    }
    return { path: commands.join(" "), arcs };
  }

  function decorationGroup(layer, className) {
    let group = layer.querySelector(`:scope > .${className}`);
    if (!group) {
      group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", className);
      layer.append(group);
    }
    group.replaceChildren();
    return group;
  }

  function renderJumps(layer) {
    const group = decorationGroup(layer, "er-edge-jumps");
    if (routingMode !== "orthogonal" || !lineJumpsEnabled) {
      return;
    }
    const crossings = lineJumpCrossings();
    routes.forEach((route, relationshipId) => {
      const edge = viewportElement.querySelector(
        `[data-relationship-id="${relationshipId}"]`,
      );
      if (!edge || !route.points) {
        return;
      }
      const rendered = pathWithJumps(route, crossings.get(relationshipId));
      edge.setAttribute("d", rendered.path);
      rendered.arcs.forEach((arc) => {
        const underlay = document.createElementNS(SVG_NS, "path");
        underlay.setAttribute("class", "er-edge-jump-underlay");
        underlay.setAttribute("d", arc);
        underlay.setAttribute("data-relationship-jump-id", relationshipId);
        const line = document.createElementNS(SVG_NS, "path");
        line.setAttribute(
          "class",
          `er-edge-jump-line er-edge-${route.relationship.relationship_type}`,
        );
        line.setAttribute("d", arc);
        line.setAttribute("data-relationship-jump-id", relationshipId);
        group.append(underlay, line);
      });
    });
  }

  function renderHandles(layer) {
    const group = decorationGroup(layer, "er-edge-handles");
    if (routingMode !== "orthogonal") {
      return;
    }
    routes.forEach((route, relationshipId) => {
      if (!route.editable) {
        return;
      }
      const segment = segmentFor(route, route.editable.segmentIndex);
      const handle = document.createElementNS(SVG_NS, "line");
      handle.setAttribute("class", "er-edge-handle");
      handle.setAttribute("x1", String(segment.start.x));
      handle.setAttribute("y1", String(segment.start.y));
      handle.setAttribute("x2", String(segment.end.x));
      handle.setAttribute("y2", String(segment.end.y));
      handle.setAttribute("data-er-edge-handle-id", relationshipId);
      handle.setAttribute("data-segment-axis", route.editable.axis);
      handle.setAttribute("data-move-axis", route.editable.movementAxis);
      handle.setAttribute("tabindex", "0");
      handle.setAttribute("role", "slider");
      handle.setAttribute(
        "aria-label",
        `${route.relationship.name}の${route.editable.axis === "vertical" ? "垂直" : "水平"}` +
          "セグメント位置",
      );
      handle.setAttribute(
        "aria-orientation",
        route.editable.movementAxis === "x" ? "horizontal" : "vertical",
      );
      handle.setAttribute(
        "aria-valuenow",
        String(Math.round(routeOffsets.get(relationshipId) || 0)),
      );
      handle.setAttribute("aria-valuemin", String(-ROUTE_OFFSET_LIMIT));
      handle.setAttribute("aria-valuemax", String(ROUTE_OFFSET_LIMIT));
      group.append(handle);
    });
  }

  function applyDecorations() {
    let layer = null;
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
      layer = edge.parentElement;
      edge.dataset.edgeRouting = routingMode;
      edge.dataset.parentCardinality = relationship.parent_cardinality;
      edge.dataset.childCardinality = relationship.child_cardinality;
      positionElement(label, route.label);

      const parent = cardinalityElement(layer, relationship, "parent");
      parent.textContent = cardinalityText(relationship.parent_cardinality);
      parent.setAttribute("data-cardinality", relationship.parent_cardinality);
      parent.setAttribute(
        "aria-label",
        `親側カーディナリティ: ${parent.textContent}`,
      );
      positionElement(parent, route.parentCardinality);

      const child = cardinalityElement(layer, relationship, "child");
      child.textContent = cardinalityText(relationship.child_cardinality);
      child.setAttribute("data-cardinality", relationship.child_cardinality);
      child.setAttribute(
        "aria-label",
        `子側カーディナリティ: ${child.textContent}`,
      );
      positionElement(child, route.childCardinality);
    });
    if (layer) {
      renderJumps(layer);
      renderHandles(layer);
    }
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
    setStatus(`線設定を${action}できません。ブラウザの保存領域を確認してください。`, "error");
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

  function readStorageItem(key, action = "復元") {
    const storage = getStorage(action);
    if (storage === null) {
      return null;
    }
    try {
      return storage.getItem(key);
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError(action, error);
        return null;
      }
      throw error;
    }
  }

  function writeStorageItem(key, value, action = "保存") {
    const storage = getStorage(action);
    if (storage === null) {
      return false;
    }
    try {
      storage.setItem(key, value);
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError(action, error);
        return false;
      }
      throw error;
    }
    return true;
  }

  function removeStorageItem(key, action = "リセット") {
    const storage = getStorage(action);
    if (storage === null) {
      return false;
    }
    try {
      storage.removeItem(key);
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError(action, error);
        return false;
      }
      throw error;
    }
    return true;
  }

  function removeSavedRouteLayouts() {
    const storage = getStorage("リセット");
    if (storage === null) {
      return false;
    }
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null && key.startsWith(routeStoragePrefix)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError("リセット", error);
        return false;
      }
      throw error;
    }
    return true;
  }

  function restoreRoutingMode() {
    const stored = readStorageItem(MODE_STORAGE_KEY);
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
    if (!writeStorageItem(MODE_STORAGE_KEY, mode)) {
      return false;
    }
    setStatus("線種を保存しました。");
    return true;
  }

  function restoreLineJumps() {
    const stored = readStorageItem(LINE_JUMP_STORAGE_KEY);
    if (stored === null) {
      return true;
    }
    if (stored !== "true" && stored !== "false") {
      setStatus("保存済みLine jump設定が不正なため、Onを使用します。", "error");
      return true;
    }
    return stored === "true";
  }

  function restoreRouteOffsets() {
    const serialized = readStorageItem(routeStorageKey);
    if (serialized === null) {
      return;
    }
    let record;
    try {
      record = JSON.parse(serialized);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setStatus("保存済み鍵線位置が壊れているため、自動経路を使用します。", "error");
        return;
      }
      throw error;
    }
    if (record === null || typeof record !== "object" ||
        record.version !== ROUTE_RECORD_VERSION ||
        record.definitionId !== definitionId ||
        record.graphFingerprint !== graphFingerprint ||
        record.offsets === null || typeof record.offsets !== "object" ||
        Array.isArray(record.offsets)) {
      setStatus("保存済み鍵線位置の形式が不正なため、自動経路を使用します。", "error");
      return;
    }
    for (const [relationshipId, offset] of Object.entries(record.offsets)) {
      if (!relationshipById.has(relationshipId) ||
          typeof offset !== "number" || !Number.isFinite(offset) ||
          Math.abs(offset) > ROUTE_OFFSET_LIMIT) {
        setStatus("保存済み鍵線位置の形式が不正なため、自動経路を使用します。", "error");
        routeOffsets.clear();
        return;
      }
      routeOffsets.set(relationshipId, offset);
    }
  }

  function saveRouteOffsets() {
    if (routeOffsets.size === 0) {
      return removeStorageItem(routeStorageKey, "保存");
    }
    const record = {
      version: ROUTE_RECORD_VERSION,
      definitionId,
      graphFingerprint,
      offsets: Object.fromEntries(routeOffsets),
    };
    if (!writeStorageItem(routeStorageKey, JSON.stringify(record))) {
      return false;
    }
    setStatus("鍵線位置を保存しました。");
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
    document.querySelectorAll("[data-er-orthogonal-controls]").forEach((controls) => {
      controls.hidden = mode !== "orthogonal";
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

  function setLineJumpsEnabled(enabled, { persist = true, emit = true } = {}) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("ER Line jump state must be a boolean.");
    }
    lineJumpsEnabled = enabled;
    document.querySelectorAll("[data-er-line-jumps]").forEach((button) => {
      button.setAttribute("aria-pressed", String(enabled));
    });
    viewer.redrawEdges();
    if (persist && writeStorageItem(LINE_JUMP_STORAGE_KEY, String(enabled))) {
      setStatus(`Line jumpを${enabled ? "On" : "Off"}にしました。`);
    }
    if (emit) {
      viewportElement.dispatchEvent(new CustomEvent("dbdef:er-line-jumps-change", {
        detail: { enabled },
      }));
    }
  }

  function setRouteOffset(
    relationshipId,
    offset,
    { persist = true, emit = true } = {},
  ) {
    if (!relationshipById.has(relationshipId)) {
      throw new Error(`Unknown ER relationship: ${relationshipId}`);
    }
    if (typeof offset !== "number" || !Number.isFinite(offset)) {
      throw new TypeError("ER route offset must be a finite number.");
    }
    if (Math.abs(offset) > ROUTE_OFFSET_LIMIT) {
      throw new RangeError(
        `ER route offset must be between ${-ROUTE_OFFSET_LIMIT} and ${ROUTE_OFFSET_LIMIT}.`,
      );
    }
    if (Math.abs(offset) < 0.001) {
      routeOffsets.delete(relationshipId);
    } else {
      routeOffsets.set(relationshipId, offset);
    }
    if (routingMode === "orthogonal") {
      viewer.redrawEdges();
    }
    if (persist) {
      saveRouteOffsets();
    }
    if (emit) {
      viewportElement.dispatchEvent(new CustomEvent("dbdef:er-route-offset-change", {
        detail: { relationshipId, offset: routeOffsets.get(relationshipId) || 0 },
      }));
    }
  }

  function resetRouteOffsets({ emit = true } = {}) {
    routeOffsets.clear();
    const removed = removeSavedRouteLayouts();
    if (routingMode === "orthogonal") {
      viewer.redrawEdges();
    }
    if (removed) {
      setStatus("鍵線位置を自動経路へ戻しました。");
    }
    if (emit) {
      viewportElement.dispatchEvent(new CustomEvent("dbdef:er-route-offset-reset"));
    }
    return removed;
  }

  function beginHandleDrag(event) {
    const handle = event.target.closest?.("[data-er-edge-handle-id]");
    if (routingMode !== "orthogonal" || event.button !== 0 || !handle) {
      return;
    }
    const relationshipId = handle.dataset.erEdgeHandleId;
    const movementAxis = handle.dataset.moveAxis;
    const point = viewer.screenToGraphPoint(event.clientX, event.clientY);
    dragState = {
      pointerId: event.pointerId,
      relationshipId,
      movementAxis,
      startCoordinate: point[movementAxis],
      startOffset: routeOffsets.get(relationshipId) || 0,
      moved: false,
    };
    viewportElement.setPointerCapture(event.pointerId);
    viewportElement.classList.add("er-is-routing");
    event.preventDefault();
    event.stopPropagation();
  }

  function moveHandleDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const point = viewer.screenToGraphPoint(event.clientX, event.clientY);
    const offset = clamp(
      dragState.startOffset + point[dragState.movementAxis] - dragState.startCoordinate,
      -ROUTE_OFFSET_LIMIT,
      ROUTE_OFFSET_LIMIT,
    );
    dragState.moved = true;
    setRouteOffset(dragState.relationshipId, offset, { persist: false, emit: false });
    event.preventDefault();
    event.stopPropagation();
  }

  function finishHandleDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const { pointerId, relationshipId, moved } = dragState;
    dragState = null;
    viewportElement.classList.remove("er-is-routing");
    if (viewportElement.hasPointerCapture(pointerId)) {
      viewportElement.releasePointerCapture(pointerId);
    }
    if (event.type === "pointerup" && moved) {
      saveRouteOffsets();
      viewportElement.dispatchEvent(new CustomEvent("dbdef:er-route-offset-change", {
        detail: {
          relationshipId,
          offset: routeOffsets.get(relationshipId) || 0,
        },
      }));
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function moveHandleWithKeyboard(event) {
    const handle = event.target.closest?.("[data-er-edge-handle-id]");
    if (!handle || routingMode !== "orthogonal") {
      return;
    }
    const movementAxis = handle.dataset.moveAxis;
    const direction = {
      ArrowLeft: movementAxis === "x" ? -1 : 0,
      ArrowRight: movementAxis === "x" ? 1 : 0,
      ArrowUp: movementAxis === "y" ? -1 : 0,
      ArrowDown: movementAxis === "y" ? 1 : 0,
    }[event.key];
    if (!direction) {
      return;
    }
    const relationshipId = handle.dataset.erEdgeHandleId;
    setRouteOffset(
      relationshipId,
      clamp(
        (routeOffsets.get(relationshipId) || 0) + direction * KEYBOARD_MOVE_STEP,
        -ROUTE_OFFSET_LIMIT,
        ROUTE_OFFSET_LIMIT,
      ),
    );
    viewportElement.querySelector(
      `[data-er-edge-handle-id="${relationshipId}"]`,
    )?.focus();
    event.preventDefault();
    event.stopPropagation();
  }

  viewportElement.addEventListener("dbdef:er-edges-redrawn", applyDecorations);
  viewportElement.addEventListener("dbdef:er-layout-reset", () => resetRouteOffsets());
  viewportElement.addEventListener("pointerdown", beginHandleDrag);
  viewportElement.addEventListener("pointermove", moveHandleDrag);
  viewportElement.addEventListener("pointerup", finishHandleDrag);
  viewportElement.addEventListener("pointercancel", finishHandleDrag);
  viewportElement.addEventListener("keydown", moveHandleWithKeyboard);
  document.querySelectorAll("[data-er-edge-routing]").forEach((button) => {
    button.addEventListener("click", () => setRoutingMode(button.dataset.erEdgeRouting));
  });
  document.querySelectorAll("[data-er-line-jumps]").forEach((button) => {
    button.addEventListener("click", () => setLineJumpsEnabled(!lineJumpsEnabled));
  });

  restoreRouteOffsets();
  lineJumpsEnabled = restoreLineJumps();
  document.querySelectorAll("[data-er-line-jumps]").forEach((button) => {
    button.setAttribute("aria-pressed", String(lineJumpsEnabled));
  });
  setRoutingMode(restoreRoutingMode(), { persist: false, emit: false });

  window.dbdefErEdgeRouting = Object.freeze({
    version: "2.0",
    getRoutingMode: () => routingMode,
    getStorageKey: () => MODE_STORAGE_KEY,
    getRouteStorageKey: () => routeStorageKey,
    getLineJumpStorageKey: () => LINE_JUMP_STORAGE_KEY,
    getRouteOffsets: () => Object.fromEntries(routeOffsets),
    getLineJumpsEnabled: () => lineJumpsEnabled,
    setRoutingMode,
    setRouteOffset,
    resetRouteOffsets,
    setLineJumpsEnabled,
    strategies,
  });
})();
