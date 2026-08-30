(() => {
  "use strict";

  const DIRECTIONS = new Set(["left-to-right", "top-to-bottom"]);
  const DEFAULT_DIRECTION = "left-to-right";
  const RANK_GAP = 140;
  const NODE_GAP = 60;
  const COMPONENT_GAP = 180;
  const section = document.querySelector("#er-diagram");
  const viewportElement = document.querySelector("#dbdef-er-viewer");
  const statusElement = document.querySelector("#dbdef-er-layout-status");
  const viewer = window.dbdefErViewer;
  const savedLayout = window.dbdefErLayout;
  if (!section || !viewportElement || !statusElement || !viewer || !savedLayout) {
    return;
  }

  const graph = viewer.getGraph();
  const tableById = new Map(graph.tables.map((table) => [table.id, table]));
  const restoredDirection = savedLayout.getMetadata().autoLayoutDirection;
  let direction = DIRECTIONS.has(restoredDirection) ? restoredDirection : DEFAULT_DIRECTION;

  function compareText(left, right) {
    if (left < right) {
      return -1;
    }
    return left > right ? 1 : 0;
  }

  function compareTableIds(left, right) {
    const leftTable = tableById.get(left);
    const rightTable = tableById.get(right);
    return compareText(
      `${leftTable.physical_name}\u0000${left}`,
      `${rightTable.physical_name}\u0000${right}`,
    );
  }

  function sortedTableIds(values) {
    return Array.from(values).sort(compareTableIds);
  }

  function graphConnections() {
    const outgoing = new Map(graph.tables.map((table) => [table.id, new Set()]));
    const incoming = new Map(graph.tables.map((table) => [table.id, new Set()]));
    const undirected = new Map(graph.tables.map((table) => [table.id, new Set()]));
    graph.relationships.forEach((relationship) => {
      const parent = relationship.parent_table_id;
      const child = relationship.child_table_id;
      if (!tableById.has(parent) || !tableById.has(child)) {
        throw new Error(`Unknown ER relationship endpoint: ${relationship.id}`);
      }
      outgoing.get(parent).add(child);
      incoming.get(child).add(parent);
      undirected.get(parent).add(child);
      undirected.get(child).add(parent);
    });
    return { outgoing, incoming, undirected };
  }

  function connectedComponents(undirected) {
    const remaining = new Set(tableById.keys());
    const components = [];
    sortedTableIds(remaining).forEach((root) => {
      if (!remaining.has(root)) {
        return;
      }
      const component = [];
      const stack = [root];
      remaining.delete(root);
      while (stack.length > 0) {
        const current = stack.pop();
        component.push(current);
        sortedTableIds(undirected.get(current)).reverse().forEach((neighbor) => {
          if (remaining.delete(neighbor)) {
            stack.push(neighbor);
          }
        });
      }
      components.push(component.sort(compareTableIds));
    });
    return components;
  }

  function finishingOrder(nodeIds, adjacency) {
    const visited = new Set();
    const order = [];
    sortedTableIds(nodeIds).forEach((root) => {
      if (visited.has(root)) {
        return;
      }
      visited.add(root);
      const stack = [{
        id: root,
        neighbors: sortedTableIds(adjacency.get(root)),
        index: 0,
      }];
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (frame.index < frame.neighbors.length) {
          const neighbor = frame.neighbors[frame.index];
          frame.index += 1;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push({
              id: neighbor,
              neighbors: sortedTableIds(adjacency.get(neighbor)),
              index: 0,
            });
          }
          continue;
        }
        order.push(frame.id);
        stack.pop();
      }
    });
    return order;
  }

  function stronglyConnectedComponents(nodeIds, outgoing, incoming) {
    const componentNodes = new Set(nodeIds);
    const localOutgoing = new Map(nodeIds.map((id) => [
      id,
      new Set(Array.from(outgoing.get(id)).filter((neighbor) => componentNodes.has(neighbor))),
    ]));
    const localIncoming = new Map(nodeIds.map((id) => [
      id,
      new Set(Array.from(incoming.get(id)).filter((neighbor) => componentNodes.has(neighbor))),
    ]));
    const order = finishingOrder(nodeIds, localOutgoing);
    const assigned = new Set();
    const components = [];
    order.reverse().forEach((root) => {
      if (assigned.has(root)) {
        return;
      }
      const component = [];
      const stack = [root];
      assigned.add(root);
      while (stack.length > 0) {
        const current = stack.pop();
        component.push(current);
        sortedTableIds(localIncoming.get(current)).reverse().forEach((neighbor) => {
          if (!assigned.has(neighbor)) {
            assigned.add(neighbor);
            stack.push(neighbor);
          }
        });
      }
      components.push(component.sort(compareTableIds));
    });
    return components.sort((left, right) => compareTableIds(left[0], right[0]));
  }

  function rankedNodes(nodeIds, outgoing, incoming) {
    const components = stronglyConnectedComponents(nodeIds, outgoing, incoming);
    const componentByNode = new Map();
    components.forEach((component, index) => {
      component.forEach((id) => componentByNode.set(id, index));
    });
    const successors = components.map(() => new Set());
    const indegrees = components.map(() => 0);
    nodeIds.forEach((source) => {
      outgoing.get(source).forEach((target) => {
        if (!componentByNode.has(target)) {
          return;
        }
        const sourceComponent = componentByNode.get(source);
        const targetComponent = componentByNode.get(target);
        if (sourceComponent !== targetComponent &&
            !successors[sourceComponent].has(targetComponent)) {
          successors[sourceComponent].add(targetComponent);
          indegrees[targetComponent] += 1;
        }
      });
    });

    const compareComponents = (left, right) =>
      compareTableIds(components[left][0], components[right][0]);
    const ready = components
      .map((_, index) => index)
      .filter((index) => indegrees[index] === 0)
      .sort(compareComponents);
    const ranks = components.map(() => 0);
    while (ready.length > 0) {
      const current = ready.shift();
      Array.from(successors[current]).sort(compareComponents).forEach((successor) => {
        ranks[successor] = Math.max(ranks[successor], ranks[current] + 1);
        indegrees[successor] -= 1;
        if (indegrees[successor] === 0) {
          ready.push(successor);
          ready.sort(compareComponents);
        }
      });
    }

    const layers = [];
    components.forEach((component, index) => {
      const rank = ranks[index];
      layers[rank] ||= [];
      layers[rank].push(...component);
    });
    return layers.map((layer) => layer.sort(compareTableIds));
  }

  function nodeSizes() {
    return new Map(graph.tables.map((table) => [
      table.id,
      viewer.getNodeSize(table.id, "all"),
    ]));
  }

  function placeComponent(layers, sizes, layoutDirection) {
    const positions = {};
    let primaryOffset = 0;
    let secondaryExtent = 0;
    layers.forEach((layer) => {
      let secondaryOffset = 0;
      let primaryExtent = 0;
      layer.forEach((tableId) => {
        const size = sizes.get(tableId);
        positions[tableId] = layoutDirection === "left-to-right"
          ? { x: primaryOffset, y: secondaryOffset }
          : { x: secondaryOffset, y: primaryOffset };
        primaryExtent = Math.max(
          primaryExtent,
          layoutDirection === "left-to-right" ? size.width : size.height,
        );
        secondaryOffset +=
          (layoutDirection === "left-to-right" ? size.height : size.width) + NODE_GAP;
      });
      secondaryExtent = Math.max(secondaryExtent, Math.max(0, secondaryOffset - NODE_GAP));
      primaryOffset += primaryExtent + RANK_GAP;
    });
    const primarySize = Math.max(0, primaryOffset - RANK_GAP);
    return {
      positions,
      width: layoutDirection === "left-to-right" ? primarySize : secondaryExtent,
      height: layoutDirection === "left-to-right" ? secondaryExtent : primarySize,
    };
  }

  function calculate(layoutDirection) {
    const normalizedDirection = normalizeDirection(layoutDirection);
    const sizes = nodeSizes();
    const { outgoing, incoming, undirected } = graphConnections();
    const positions = {};
    let componentOffset = 0;
    connectedComponents(undirected).forEach((component) => {
      const layers = rankedNodes(component, outgoing, incoming);
      const placed = placeComponent(layers, sizes, normalizedDirection);
      Object.entries(placed.positions).forEach(([tableId, position]) => {
        positions[tableId] = normalizedDirection === "left-to-right"
          ? { x: position.x, y: position.y + componentOffset }
          : { x: position.x + componentOffset, y: position.y };
      });
      componentOffset +=
        (normalizedDirection === "left-to-right" ? placed.height : placed.width) +
        COMPONENT_GAP;
    });
    return positions;
  }

  function normalizeDirection(value) {
    if (!DIRECTIONS.has(value)) {
      throw new TypeError(`Unknown ER auto-layout direction: ${value}`);
    }
    return value;
  }

  function updateDirectionControls() {
    document.querySelectorAll("[data-er-layout-direction]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.erLayoutDirection === direction),
      );
    });
  }

  function run(nextDirection = direction) {
    direction = normalizeDirection(nextDirection);
    updateDirectionControls();
    const positions = calculate(direction);
    viewer.setNodePositions(positions, { source: "auto-layout" });
    const saved = savedLayout.save({
      ...savedLayout.getMetadata(),
      autoLayoutDirection: direction,
    });
    viewer.fitToView();
    if (saved) {
      statusElement.textContent = direction === "left-to-right"
        ? "左から右へ自動配置し、保存しました。"
        : "上から下へ自動配置し、保存しました。";
      statusElement.dataset.status = "info";
    }
    viewportElement.dispatchEvent(new CustomEvent("dbdef:er-auto-layout", {
      detail: { direction, tableIds: sortedTableIds(Object.keys(positions)) },
    }));
    return Object.fromEntries(
      Object.entries(positions).map(([tableId, position]) => [tableId, { ...position }]),
    );
  }

  function setDirection(nextDirection) {
    return run(nextDirection);
  }

  document.querySelector('[data-er-action="auto-layout"]')?.addEventListener(
    "click",
    () => run(),
  );
  document.querySelectorAll("[data-er-layout-direction]").forEach((button) => {
    button.addEventListener("click", () => setDirection(button.dataset.erLayoutDirection));
  });
  updateDirectionControls();

  window.dbdefErAutoLayout = Object.freeze({
    version: "1.0",
    getDirection: () => direction,
    calculate: (nextDirection = direction) => calculate(nextDirection),
    run,
    setDirection,
  });

  if (!savedLayout.wasRestored() && statusElement.dataset.status !== "error") {
    run();
  }
})();
