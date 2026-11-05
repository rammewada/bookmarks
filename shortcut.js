// shortcut.js — Ctrl/Cmd+Shift+D on any web page opens the quick-save panel.
// Chrome reserves Ctrl+Shift+D ("Bookmark all tabs"), so it can't be registered as a normal
// extension shortcut. Pages receive the key before the browser does, so we catch it here.
(() => {
  if (window.__bmShortcut) return;
  window.__bmShortcut = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || e.altKey || !e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
      if ((e.key || "").toLowerCase() !== "d" && e.code !== "KeyD") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        chrome.runtime.sendMessage({ action: "openSavePopup" });
      } catch (err) {
        // Extension was reloaded/updated — this old copy of the script is disconnected.
      }
    },
    true,
  );
})();
