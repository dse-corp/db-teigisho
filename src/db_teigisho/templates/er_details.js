(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PANEL_ID = "dbdef-er-details";
  const viewer = document.querySelector("#dbdef-er-viewer");
  const graphElement = document.querySelector("#dbdef-er-graph");
  const panel = document.querySelector(`#${PANEL_ID}`);
  const closeButton = document.querySelector("#dbdef-er-details-close");
  const kindElement = document.querySelector("#dbdef-er-details-kind");
  const titleElement = document.querySelector("#dbdef-er-details-title");
  const bodyElement = document.querySelector("#dbdef-er-details-body");
  if (!viewer || !graphElement || !panel || !closeButton || !kindElement ||
      !titleElement || !bodyElement) {
    return;
  }

  const graph = JSON.parse(graphElement.textContent);
  const tableById = new Map(graph.tables.map((table) => [table.id, table]));
  const columnById = new Map(
    graph.tables.flatMap((table) =>
      table.columns.map((column) => [column.id, { table, column }]),
    ),
  );
  let selection = null;
  let activeKey = null;
  let lastSelectedTarget = null;

  function selectionKey(value) {
    if (!value) {
      return null;
    }
    return value.kind === "table"
      ? `table:${value.tableId}`
      : `column:${value.tableId}:${value.columnId}`;
  }

  function targetSelection(target) {
    if (target.dataset.erDetailTarget === "table") {
      return { kind: "table", tableId: target.dataset.tableId };
    }
    return {
      kind: "column",
      tableId: target.dataset.tableId,
      columnId: target.dataset.columnId,
    };
  }

  function targetKey(target) {
    return selectionKey(targetSelection(target));
  }

  function targets() {
    return Array.from(viewer.querySelectorAll("[data-er-detail-target]"));
  }

  function findTarget(value) {
    const key = selectionKey(value);
    return targets().find((target) => targetKey(target) === key) || null;
  }

  function addTextElement(parent, tag, text, className = null) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function displayValue(value) {
    if (value === null || value === undefined) {
      return "—";
    }
    if (value === "") {
      return '""';
    }
    return String(value);
  }

  function appendFields(parent, fields) {
    const list = document.createElement("dl");
    list.className = "er-detail-fields";
    fields.forEach(({ label, value, code = false }) => {
      const row = document.createElement("div");
      addTextElement(row, "dt", label);
      const definition = document.createElement("dd");
      if (code) {
        addTextElement(definition, "code", displayValue(value));
      } else {
        definition.textContent = displayValue(value);
      }
      row.append(definition);
      list.append(row);
    });
    parent.append(list);
  }

  function appendEmpty(parent) {
    addTextElement(parent, "p", "定義なし", "er-detail-empty");
  }

  function appendIndexes(parent, indexes) {
    addTextElement(parent, "h4", `インデックス (${indexes.length})`);
    if (indexes.length === 0) {
      appendEmpty(parent);
      return;
    }
    const list = document.createElement("ul");
    list.className = "er-detail-list";
    indexes.forEach((index) => {
      const item = document.createElement("li");
      addTextElement(item, "code", index.name, "er-detail-name");
      appendFields(item, [
        { label: "種別", value: index.type },
        { label: "Unique", value: index.unique ? "あり" : "なし" },
        {
          label: "キー列",
          value: index.columns.map((column) => `${column.name} ${column.order}`).join(", "),
          code: true,
        },
        {
          label: "付加列",
          value: index.include_columns.length ? index.include_columns.join(", ") : null,
          code: true,
        },
        { label: "条件", value: index.where, code: true },
      ]);
      list.append(item);
    });
    parent.append(list);
  }

  function appendForeignKeys(parent, foreignKeys) {
    addTextElement(parent, "h4", `外部キー (${foreignKeys.length})`);
    if (foreignKeys.length === 0) {
      appendEmpty(parent);
      return;
    }
    const list = document.createElement("ul");
    list.className = "er-detail-list";
    foreignKeys.forEach((foreignKey) => {
      const item = document.createElement("li");
      addTextElement(item, "code", foreignKey.name, "er-detail-name");
      appendFields(item, [
        { label: "参照元", value: foreignKey.columns.join(", "), code: true },
        {
          label: "参照先",
          value: `${foreignKey.referenced_table}(${foreignKey.referenced_columns.join(", ")})`,
          code: true,
        },
        { label: "ON UPDATE", value: foreignKey.on_update },
        { label: "ON DELETE", value: foreignKey.on_delete },
        { label: "Deferrable", value: foreignKey.deferrable ? "あり" : "なし" },
      ]);
      list.append(item);
    });
    parent.append(list);
  }

  function renderTableDetails(table) {
    kindElement.textContent = "テーブル詳細";
    titleElement.textContent = `${table.physical_name} / ${table.logical_name}`;
    bodyElement.replaceChildren();
    appendFields(bodyElement, [
      { label: "物理名", value: table.physical_name, code: true },
      { label: "論理名", value: table.logical_name },
      { label: "説明", value: table.description },
      { label: "カラム数", value: table.columns.length },
    ]);
    appendIndexes(bodyElement, table.indexes || []);
    appendForeignKeys(bodyElement, table.foreign_keys || []);
  }

  function renderColumnDetails(table, column) {
    kindElement.textContent = "カラム詳細";
    titleElement.textContent = `${column.physical_name} / ${column.logical_name}`;
    bodyElement.replaceChildren();
    appendFields(bodyElement, [
      { label: "物理名", value: column.physical_name, code: true },
      { label: "論理名", value: column.logical_name },
      { label: "型", value: column.data_type, code: true },
      { label: "長さ", value: column.length },
      { label: "Scale", value: column.scale },
      { label: "Default", value: column.default, code: true },
      { label: "NN", value: column.not_null ? "あり" : "なし" },
      { label: "Unique", value: column.unique ? "あり" : "なし" },
      { label: "PK", value: column.primary_key ? "あり" : "なし" },
      { label: "説明", value: column.description },
    ]);
  }

  function syncSelection() {
    const selectedKey = selectionKey(selection);
    targets().forEach((target) => {
      const selected = targetKey(target) === selectedKey;
      target.setAttribute("aria-selected", String(selected));
      if (target.dataset.erDetailTarget === "column") {
        target.classList.toggle("er-detail-column-selected", selected);
      }
    });
    viewer.querySelectorAll("[data-table-id].er-node").forEach((node) => {
      node.classList.toggle(
        "er-detail-table-selected",
        selection?.kind === "table" && node.dataset.tableId === selection.tableId,
      );
    });
    syncRelationshipHighlighting();
  }

  function syncRelationshipHighlighting() {
    const selectedTableId = selection?.kind === "table" ? selection.tableId : null;
    const relatedTableIds = new Set();
    const connectedRelationshipIds = new Set();
    if (selectedTableId) {
      relatedTableIds.add(selectedTableId);
      graph.relationships.forEach((relationship) => {
        const connected = relationship.parent_table_id === selectedTableId ||
          relationship.child_table_id === selectedTableId;
        if (!connected) {
          return;
        }
        connectedRelationshipIds.add(relationship.id);
        relatedTableIds.add(relationship.parent_table_id);
        relatedTableIds.add(relationship.child_table_id);
      });
    }

    viewer.classList.toggle("er-relationship-selection-active", selectedTableId !== null);
    viewer.querySelectorAll("[data-table-id].er-node").forEach((node) => {
      const selected = node.dataset.tableId === selectedTableId;
      const related = selectedTableId !== null &&
        relatedTableIds.has(node.dataset.tableId) && !selected;
      node.classList.toggle("er-relationship-selected", selected);
      node.classList.toggle("er-relationship-related", related);
      node.classList.toggle(
        "er-relationship-dimmed",
        selectedTableId !== null && !selected && !related,
      );
    });

    viewer.querySelectorAll(
      "[data-relationship-id], [data-relationship-label-id], " +
      "[data-relationship-cardinality-id]",
    ).forEach((element) => {
      const relationshipId = element.dataset.relationshipId ||
        element.dataset.relationshipLabelId ||
        element.dataset.relationshipCardinalityId;
      const connected = connectedRelationshipIds.has(relationshipId);
      element.classList.toggle(
        "er-relationship-connected",
        selectedTableId !== null && connected,
      );
      element.classList.toggle(
        "er-relationship-dimmed",
        selectedTableId !== null && !connected,
      );
    });
  }

  function emitSelectionChange(reason) {
    viewer.dispatchEvent(new CustomEvent("dbdef:er-selection-change", {
      detail: {
        reason,
        selection: selection ? { ...selection } : null,
      },
    }));
  }

  function select(value, target, reason) {
    selection = value;
    activeKey = selectionKey(value);
    lastSelectedTarget = target;
    targets().forEach((item) => {
      item.setAttribute("tabindex", item === target ? "0" : "-1");
    });
    if (reason === "pointer") {
      target.focus();
    }
    if (value.kind === "table") {
      renderTableDetails(tableById.get(value.tableId));
    } else {
      const item = columnById.get(value.columnId);
      renderColumnDetails(item.table, item.column);
    }
    panel.hidden = false;
    syncSelection();
    emitSelectionChange(reason);
  }

  function clearSelection(reason, restoreFocus = false) {
    const focusTarget = lastSelectedTarget;
    selection = null;
    panel.hidden = true;
    kindElement.textContent = "";
    titleElement.textContent = "";
    bodyElement.replaceChildren();
    syncSelection();
    emitSelectionChange(reason);
    if (restoreFocus && focusTarget?.isConnected) {
      focusTarget.focus();
    }
  }

  function enhanceTargets() {
    const canvas = viewer.querySelector(".er-canvas");
    if (canvas) {
      canvas.setAttribute("role", "listbox");
      canvas.setAttribute("aria-label", "選択可能なテーブルとカラムを含むER図");
      canvas.setAttribute("aria-multiselectable", "false");
    }
    viewer.querySelectorAll("[data-table-id].er-node").forEach((node) => {
      const table = tableById.get(node.dataset.tableId);
      const header = node.querySelector(".er-node-header");
      header.dataset.erDetailTarget = "table";
      header.dataset.tableId = table.id;
      header.id = `dbdef-er-target-${table.id}`;
      header.setAttribute("role", "option");
      header.setAttribute("aria-label", `テーブル ${table.physical_name} / ${table.logical_name}`);
      header.setAttribute("aria-controls", PANEL_ID);
      header.setAttribute("aria-selected", "false");

      node.querySelectorAll("[data-column-id]").forEach((row) => {
        const item = columnById.get(row.dataset.columnId);
        row.dataset.erDetailTarget = "column";
        row.dataset.tableId = table.id;
        row.id = `dbdef-er-target-${row.dataset.columnId}`;
        row.setAttribute("role", "option");
        row.setAttribute(
          "aria-label",
          `カラム ${item.column.physical_name} / ${item.column.logical_name}`,
        );
        row.setAttribute("aria-controls", PANEL_ID);
        row.setAttribute("aria-selected", "false");
        if (!row.querySelector(".er-column-selection-background")) {
          const divider = row.querySelector(".er-node-divider");
          const background = document.createElementNS(SVG_NS, "rect");
          background.setAttribute("class", "er-column-selection-background");
          background.setAttribute("x", "1");
          background.setAttribute("y", divider.getAttribute("y1"));
          background.setAttribute("width", "298");
          background.setAttribute("height", "26");
          row.insertBefore(background, row.firstChild);
        }
      });
    });

    const availableTargets = targets();
    const selectedTarget = selection ? findTarget(selection) : null;
    if (!availableTargets.some((target) => targetKey(target) === activeKey)) {
      activeKey = selectedTarget
        ? targetKey(selectedTarget)
        : (availableTargets[0] ? targetKey(availableTargets[0]) : null);
    }
    availableTargets.forEach((target) => {
      target.setAttribute("tabindex", targetKey(target) === activeKey ? "0" : "-1");
    });
    if (selectedTarget) {
      lastSelectedTarget = selectedTarget;
    }
    syncSelection();
  }

  function moveFocus(target, offset) {
    const availableTargets = targets();
    if (availableTargets.length === 0) {
      return;
    }
    const currentIndex = availableTargets.indexOf(target);
    const nextIndex = (currentIndex + offset + availableTargets.length) %
      availableTargets.length;
    const nextTarget = availableTargets[nextIndex];
    activeKey = targetKey(nextTarget);
    availableTargets.forEach((item) => {
      item.setAttribute("tabindex", item === nextTarget ? "0" : "-1");
    });
    nextTarget.focus();
  }

  viewer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const columnTarget = event.target.closest("[data-column-id]");
    if (columnTarget && viewer.contains(columnTarget)) {
      select(targetSelection(columnTarget), columnTarget, "pointer");
      return;
    }
    const node = event.target.closest("[data-table-id].er-node");
    if (node && viewer.contains(node)) {
      const tableTarget = node.querySelector('[data-er-detail-target="table"]');
      select(targetSelection(tableTarget), tableTarget, "pointer");
    }
  }, { capture: true });

  viewer.addEventListener("focusin", (event) => {
    const target = event.target.closest("[data-er-detail-target]");
    if (target) {
      activeKey = targetKey(target);
      targets().forEach((item) => {
        item.setAttribute("tabindex", item === target ? "0" : "-1");
      });
    }
  });

  viewer.addEventListener("keydown", (event) => {
    const target = event.target.closest("[data-er-detail-target]");
    if (!target) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(target, 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(target, -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(targetSelection(target), target, "keyboard");
    }
  });

  viewer.addEventListener("dbdef:er-view-change", (event) => {
    if (event.detail.reason !== "mode") {
      return;
    }
    enhanceTargets();
    if (selection && !findTarget(selection)) {
      clearSelection("hidden");
    }
  });

  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("wheel", (event) => event.stopPropagation());
  closeButton.addEventListener("click", () => clearSelection("close", true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      clearSelection("escape", document.activeElement === closeButton);
    }
  });

  panel.setAttribute("role", "region");
  enhanceTargets();
})();
