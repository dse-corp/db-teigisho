(() => {
  "use strict";

  const section = document.querySelector("#er-diagram");
  const viewer = document.querySelector("#dbdef-er-viewer");
  const button = document.querySelector('[data-er-action="maximize"]');
  if (!section || !viewer || !button) {
    return;
  }

  const body = document.body;
  let maximized = false;
  let restoreFocusTarget = null;

  function emitChange(reason) {
    viewer.dispatchEvent(new CustomEvent("dbdef:er-maximize-change", {
      detail: { maximized, reason },
    }));
  }

  function syncControls() {
    section.classList.toggle("er-is-maximized", maximized);
    body.classList.toggle("er-diagram-is-maximized", maximized);
    button.setAttribute("aria-pressed", String(maximized));
    button.setAttribute(
      "aria-label",
      maximized ? "ER図を通常表示に戻す" : "ER図を最大化",
    );
    button.textContent = maximized ? "元に戻す" : "最大化";
  }

  function setMaximized(next, reason = "api") {
    if (typeof next !== "boolean") {
      throw new TypeError("ER diagram maximize state must be a boolean.");
    }
    if (next === maximized) {
      return maximized;
    }
    if (next) {
      restoreFocusTarget = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : button;
    }
    maximized = next;
    syncControls();
    emitChange(reason);
    if (maximized) {
      button.focus();
    } else if (restoreFocusTarget?.isConnected) {
      restoreFocusTarget.focus();
      restoreFocusTarget = null;
    } else {
      button.focus();
    }
    return maximized;
  }

  button.addEventListener("click", () => setMaximized(!maximized, "button"));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !maximized || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    setMaximized(false, "escape");
  });

  syncControls();
  window.dbdefErMaximize = Object.freeze({
    version: "1.0",
    isMaximized: () => maximized,
    setMaximized,
    maximize: () => setMaximized(true, "api"),
    restore: () => setMaximized(false, "api"),
    toggle: () => setMaximized(!maximized, "api"),
  });
})();
