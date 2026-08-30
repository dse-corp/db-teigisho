(() => {
  "use strict";

  const STORAGE_NAMESPACE = "dbdef:er-layout:v1";
  const LAYOUT_VERSION = 1;
  const NODE_PLACEMENT_GAP = 40;
  const section = document.querySelector("#er-diagram");
  const viewportElement = document.querySelector("#dbdef-er-viewer");
  const frame = document.querySelector(".er-diagram-frame");
  const statusElement = document.querySelector("#dbdef-er-layout-status");
  const viewer = window.dbdefErViewer;
  if (!section || !viewportElement || !frame || !statusElement || !viewer) {
    return;
  }

  const definitionId = section.dataset.erDefinitionId;
  if (!definitionId) {
    throw new Error("The ER layout requires a definition identifier.");
  }

  const graph = viewer.getGraph();
  const tableById = new Map(graph.tables.map((table) => [table.id, table]));
  const initialPositions = viewer.getState().nodePositions;
  const graphFingerprint = fingerprintGraph(graph);
  const storagePrefix = `${STORAGE_NAMESPACE}:${definitionId}:`;
  const storageKey = `${storagePrefix}${graphFingerprint}`;
  let dragState = null;
  let layoutMetadata = {};

  function graphStructure(graphData) {
    const tables = new Map(graphData.tables.map((table) => [table.id, table]));
    const columns = new Map(
      graphData.tables.flatMap((table) =>
        table.columns.map((column) => [
          column.id,
          `${table.physical_name}.${column.physical_name}`,
        ])),
    );
    return {
      version: LAYOUT_VERSION,
      graphFormatVersion: graphData.format_version,
      tables: graphData.tables.map((table) => ({
        name: table.physical_name,
        columns: table.columns.map((column) => column.physical_name),
      })),
      relationships: graphData.relationships.map((relationship) => ({
        name: relationship.name,
        parent: tables.get(relationship.parent_table_id)?.physical_name,
        child: tables.get(relationship.child_table_id)?.physical_name,
        columns: relationship.column_pairs.map((pair) => [
          columns.get(pair.parent_column_id),
          columns.get(pair.child_column_id),
        ]),
        parentCardinality: relationship.parent_cardinality,
        childCardinality: relationship.child_cardinality,
        type: relationship.relationship_type,
      })),
    };
  }

  function fingerprintGraph(graphData) {
    const value = JSON.stringify(graphStructure(graphData));
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
    setStatus(`配置を${action}できません。ブラウザの保存領域を確認してください。`, "error");
    viewportElement.dispatchEvent(new CustomEvent("dbdef:er-layout-storage-error", {
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

  function isPosition(value) {
    return value !== null && typeof value === "object" &&
      typeof value.x === "number" && Number.isFinite(value.x) &&
      typeof value.y === "number" && Number.isFinite(value.y);
  }

  function parseRecord(serialized) {
    let value;
    try {
      value = JSON.parse(serialized);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setStatus("保存済み配置が壊れているため、初期配置を使用します。", "error");
        return null;
      }
      throw error;
    }
    if (value === null || typeof value !== "object" ||
        value.version !== LAYOUT_VERSION || value.definitionId !== definitionId ||
        typeof value.graphFingerprint !== "string" ||
        typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) ||
        value.positions === null || typeof value.positions !== "object") {
      setStatus("保存済み配置の形式が不正なため、初期配置を使用します。", "error");
      return null;
    }
    return value;
  }

  function metadataForRecord(record) {
    if (record.metadata === undefined) {
      return {};
    }
    if (record.metadata === null || typeof record.metadata !== "object" ||
        Array.isArray(record.metadata)) {
      setStatus("保存済み配置の形式が不正なため、初期配置を使用します。", "error");
      return null;
    }
    return { ...record.metadata };
  }

  function storedRecords(storage) {
    try {
      const exact = storage.getItem(storageKey);
      if (exact !== null) {
        const record = parseRecord(exact);
        if (record !== null) {
          return [record];
        }
      }
      const records = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null || key === storageKey || !key.startsWith(storagePrefix)) {
          continue;
        }
        const serialized = storage.getItem(key);
        if (serialized === null) {
          continue;
        }
        const record = parseRecord(serialized);
        if (record !== null) {
          records.push(record);
        }
      }
      return records.sort((left, right) => right.savedAt - left.savedAt);
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError("復元", error);
        return [];
      }
      throw error;
    }
  }

  function positionsForRecord(record) {
    const positions = {};
    graph.tables.forEach((table) => {
      const position = record.positions[table.physical_name];
      if (isPosition(position)) {
        positions[table.id] = { x: position.x, y: position.y };
      }
    });
    return positions;
  }

  function nodeBox(tableId, position) {
    const background = viewportElement.querySelector(
      `[data-table-id="${tableId}"] .er-node-background`,
    );
    if (!background) {
      throw new Error(`Missing geometry for ER table node: ${tableId}`);
    }
    return {
      x: position.x,
      y: position.y,
      width: Number(background.getAttribute("width")),
      height: Number(background.getAttribute("height")),
    };
  }

  function boxesOverlap(left, right) {
    return left.x < right.x + right.width + NODE_PLACEMENT_GAP &&
      left.x + left.width + NODE_PLACEMENT_GAP > right.x &&
      left.y < right.y + right.height + NODE_PLACEMENT_GAP &&
      left.y + left.height + NODE_PLACEMENT_GAP > right.y;
  }

  function positionsWithSafeDefaults(restoredPositions) {
    const positions = { ...restoredPositions };
    const occupied = Object.entries(restoredPositions).map(([tableId, position]) =>
      nodeBox(tableId, position));
    graph.tables.forEach((table) => {
      if (positions[table.id]) {
        return;
      }
      let position = { ...initialPositions[table.id] };
      let box = nodeBox(table.id, position);
      let colliding = occupied.filter((item) => boxesOverlap(box, item));
      while (colliding.length > 0) {
        position = {
          x: Math.max(...colliding.map((item) => item.x + item.width)) +
            NODE_PLACEMENT_GAP,
          y: position.y,
        };
        box = nodeBox(table.id, position);
        colliding = occupied.filter((item) => boxesOverlap(box, item));
      }
      positions[table.id] = position;
      occupied.push(box);
    });
    return positions;
  }

  function restore() {
    const storage = getStorage("復元");
    if (storage === null) {
      return false;
    }
    const record = storedRecords(storage).find((candidate) =>
      Object.keys(positionsForRecord(candidate)).length > 0);
    if (!record) {
      return false;
    }
    const metadata = metadataForRecord(record);
    if (metadata === null) {
      return false;
    }
    layoutMetadata = metadata;
    const positions = positionsWithSafeDefaults(positionsForRecord(record));
    viewer.setNodePositions(positions, { source: "storage" });
    viewer.fitToView();
    setStatus(
      record.graphFingerprint === graphFingerprint
        ? "保存済み配置を復元しました。"
        : "構造変更前の保存配置から利用可能なテーブルを復元しました。",
    );
    return true;
  }

  function save(metadata = layoutMetadata) {
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new TypeError("ER layout metadata must be an object.");
    }
    layoutMetadata = { ...metadata };
    const storage = getStorage("保存");
    if (storage === null) {
      return false;
    }
    const current = viewer.getState().nodePositions;
    const positions = Object.fromEntries(graph.tables.map((table) => [
      table.physical_name,
      { ...current[table.id] },
    ]));
    const record = {
      version: LAYOUT_VERSION,
      definitionId,
      graphFingerprint,
      savedAt: Date.now(),
      positions,
      metadata: layoutMetadata,
    };
    try {
      storage.setItem(storageKey, JSON.stringify(record));
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError("保存", error);
        return false;
      }
      throw error;
    }
    setStatus("配置を保存しました。");
    return true;
  }

  function removeSavedLayouts(action = "削除") {
    const storage = getStorage(action);
    if (storage === null) {
      return false;
    }
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null && key.startsWith(storagePrefix)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => storage.removeItem(key));
      return true;
    } catch (error) {
      if (isExpectedStorageError(error)) {
        reportStorageError(action, error);
        return false;
      }
      throw error;
    }
  }

  function reset() {
    viewer.setNodePositions(initialPositions, { source: "reset" });
    viewportElement.dispatchEvent(new CustomEvent("dbdef:er-layout-reset"));
    viewer.fitToView();
    if (removeSavedLayouts("リセット")) {
      setStatus("保存済み配置を破棄し、初期配置に戻しました。");
      return true;
    }
    return false;
  }

  function beginDrag(event) {
    const node = event.target.closest?.(".er-node");
    if (event.button !== 0 || !node || !viewportElement.contains(node)) {
      return;
    }
    const tableId = node.dataset.tableId;
    const table = tableById.get(tableId);
    if (!table) {
      throw new Error(`Unknown draggable ER table node: ${tableId}`);
    }
    const pointer = viewer.screenToGraphPoint(event.clientX, event.clientY);
    const position = viewer.getNodePosition(tableId);
    dragState = {
      pointerId: event.pointerId,
      tableId,
      node,
      offsetX: pointer.x - position.x,
      offsetY: pointer.y - position.y,
      moved: false,
    };
    node.setPointerCapture(event.pointerId);
    node.classList.add("er-is-dragging");
    event.preventDefault();
    event.stopPropagation();
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const pointer = viewer.screenToGraphPoint(event.clientX, event.clientY);
    const nextPosition = {
      x: pointer.x - dragState.offsetX,
      y: pointer.y - dragState.offsetY,
    };
    const currentPosition = viewer.getNodePosition(dragState.tableId);
    if (nextPosition.x !== currentPosition.x || nextPosition.y !== currentPosition.y) {
      dragState.moved = true;
      viewer.setNodePosition(dragState.tableId, nextPosition, { source: "drag" });
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function finishDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const { node, pointerId, moved } = dragState;
    dragState = null;
    node.classList.remove("er-is-dragging");
    if (node.hasPointerCapture(pointerId)) {
      node.releasePointerCapture(pointerId);
    }
    event.stopPropagation();
    if (event.type === "pointerup" && moved) {
      save();
    }
  }

  viewportElement.addEventListener("pointerdown", beginDrag);
  viewportElement.addEventListener("pointermove", moveDrag);
  viewportElement.addEventListener("pointerup", finishDrag);
  viewportElement.addEventListener("pointercancel", finishDrag);
  document.querySelector('[data-er-action="reset-layout"]')?.addEventListener("click", reset);
  const restored = restore();

  window.dbdefErLayout = Object.freeze({
    version: "1.0",
    getGraphFingerprint: () => graphFingerprint,
    getStorageKey: () => storageKey,
    getMetadata: () => ({ ...layoutMetadata }),
    wasRestored: () => restored,
    save,
    restore,
    reset,
  });
})();
