// popup.js — one-click save, like Chrome's star bubble.
// Opening the popup saves the page immediately; every field auto-saves as you edit.

"use strict";

const $ = (s) => document.querySelector(s);
let bm = null; // the bookmark being edited
let tagInput = null;

document.addEventListener("DOMContentLoaded", init);

// When opened as a separate window (Ctrl+Shift+D fallback), ?tab=<id> says which page to save.
const targetTabId = Number(new URLSearchParams(location.search).get("tab")) || null;

async function getTargetTab() {
  if (targetTabId) {
    try {
      return await chrome.tabs.get(targetTabId);
    } catch (e) {}
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getTargetTab();
  setupFooter(tab);
  if (!tab || !isBookmarkable(tab.url)) return showLibraryView();

  const [tree, settings, meta] = await Promise.all([
    chrome.bookmarks.getTree(),
    BM.getSettings(),
    BM.read(BM.KEYS.META),
  ]);

  let existing = [];
  try {
    existing = (await chrome.bookmarks.search({ url: tab.url })).filter((b) => b.url);
  } catch (e) {}

  if (existing.length) {
    bm = existing[0];
    $("#hd-text").textContent = "Edit bookmark";
    $("#hd-icon").classList.add("edit");
    $("#hd-icon").innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    if (existing.length > 1) showNote(`Saved ${existing.length}×`);
  } else {
    const parentId = await BM.validFolder(settings.lastFolderId);
    bm = await chrome.bookmarks.create({ parentId, title: tab.title || tab.url, url: tab.url });
  }

  const m = meta[bm.id] || {};
  const allTags = [...new Set(Object.values(meta).flatMap((x) => x.tags || []))].sort();

  $("#pg-icon").src = tab.favIconUrl && !tab.favIconUrl.startsWith("chrome") ? tab.favIconUrl : BM.favicon(tab.url, 32);
  $("#pg-domain").textContent = BM.domain(tab.url) || tab.url;
  $("#pg-domain").title = tab.url;

  // Title
  const title = $("#f-title");
  title.value = bm.title;
  const saveTitle = BM.debounce(async () => {
    const v = title.value.trim() || tab.url;
    if (v === bm.title) return;
    await chrome.bookmarks.update(bm.id, { title: v });
    bm.title = v;
    flash();
  }, 300);
  title.addEventListener("input", saveTitle);
  title.addEventListener("change", () => saveTitle.flush());

  // Folder
  renderFolders(tree, settings);
  $("#f-folder").addEventListener("change", (e) => moveTo(e.target.value));
  $("#btn-newfolder").addEventListener("click", () => {
    const row = $("#newfolder-row");
    row.hidden = !row.hidden;
    if (!row.hidden) $("#f-newfolder").focus();
  });
  $("#f-newfolder").addEventListener("keydown", async (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      $("#newfolder-row").hidden = true;
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    const name = e.target.value.trim();
    if (!name) return;
    const folder = await chrome.bookmarks.create({ parentId: $("#f-folder").value, title: name });
    e.target.value = "";
    $("#newfolder-row").hidden = true;
    await moveTo(folder.id);
    renderFolders(await chrome.bookmarks.getTree(), await BM.getSettings());
  });

  // Tags
  tagInput = BM.createTagInput($("#f-tags"), {
    value: m.tags || [],
    suggestions: allTags,
    onChange: (tags) => {
      saveMeta({ tags });
      renderQuickTags();
    },
  });
  const quick = [...new Set([...BM.suggestTags(tab.url)])];
  function renderQuickTags() {
    const left = quick.filter((t) => !tagInput.has(t));
    $("#quick-tags").innerHTML = left.map((t) => `<button type="button" class="quick-tag" data-tag="${BM.escapeHTML(t)}">+ ${BM.escapeHTML(t)}</button>`).join("");
  }
  $("#quick-tags").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]");
    if (b) tagInput.add(b.dataset.tag);
  });
  renderQuickTags();

  // Notes
  const notes = $("#f-notes");
  notes.value = m.notes || "";
  const saveNotes = BM.debounce(() => saveMeta({ notes: notes.value.trim() }), 400);
  notes.addEventListener("input", saveNotes);
  notes.addEventListener("change", () => saveNotes.flush());

  // Pin
  $("#f-pin").checked = !!m.pinned;
  $("#f-pin").addEventListener("change", (e) => saveMeta({ pinned: e.target.checked }));

  // Reminder
  const remind = $("#f-remind");
  if (m.remindAt && m.remindAt > Date.now()) {
    const opt = new Option("Reminder: " + new Date(m.remindAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }), "keep", true, true);
    remind.add(opt, 1);
  }
  remind.addEventListener("change", async () => {
    if (remind.value === "keep") return;
    const minutes = parseInt(remind.value, 10) || 0;
    const name = "bm-remind:" + bm.id;
    await chrome.alarms.clear(name);
    if (minutes > 0) {
      chrome.alarms.create(name, { delayInMinutes: minutes });
      await saveMeta({ remindAt: Date.now() + minutes * 60000 });
    } else {
      await saveMeta({ remindAt: null });
    }
  });

  // Actions
  $("#btn-remove").addEventListener("click", async () => {
    await chrome.bookmarks.remove(bm.id);
    window.close();
  });
  $("#btn-done").addEventListener("click", done);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    const t = e.target;
    if (t.tagName === "TEXTAREA" && !(e.ctrlKey || e.metaKey)) return;
    if (t.classList.contains("ti-field") || t.id === "f-newfolder" || t.tagName === "BUTTON" || t.tagName === "SELECT") return;
    e.preventDefault();
    done();
  });

  $("#save-view").hidden = false;
  title.focus();
  title.select();

  async function done() {
    tagInput.get(); // commit any half-typed tag
    await Promise.all([saveTitle.flush(), saveNotes.flush()]);
    await metaChain;
    window.close();
  }
}

function isBookmarkable(url) {
  if (!url) return false;
  if (url.startsWith(chrome.runtime.getURL(""))) return false;
  return !/^(chrome:\/\/newtab|chrome-search:|about:blank|edge:\/\/newtab)/i.test(url);
}

function renderFolders(tree, settings) {
  const folders = BM.flattenFolders(tree);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const recent = (settings.recentFolders || []).filter((id) => byId.has(id)).slice(0, 3);
  let html = "";
  if (recent.length) {
    html += '<optgroup label="Recent">' + recent.map((id) => `<option value="${id}">${BM.escapeHTML(byId.get(id).title)}</option>`).join("") + "</optgroup>";
    html += '<optgroup label="All folders">' + BM.folderOptionsHTML(folders) + "</optgroup>";
  } else {
    html = BM.folderOptionsHTML(folders);
  }
  const sel = $("#f-folder");
  sel.innerHTML = html;
  sel.value = bm.parentId;
}

async function moveTo(parentId) {
  if (parentId !== bm.parentId) {
    bm = await chrome.bookmarks.move(bm.id, { parentId });
  }
  await BM.rememberFolder(parentId);
  $("#f-folder").value = parentId;
  flash();
}

// Serialize metadata writes so quick successive edits never overwrite each other.
let metaChain = Promise.resolve();
function saveMeta(patch) {
  metaChain = metaChain.then(() => BM.updateMeta(bm.id, patch)).then(() => flash(), () => {});
  return metaChain;
}

function flash(text = "Saved") {
  const s = $("#status");
  s.textContent = "✓ " + text;
  s.classList.add("ok");
  clearTimeout(flash.t);
  flash.t = setTimeout(() => {
    s.textContent = "";
    s.classList.remove("ok");
  }, 1400);
}

function showNote(text) {
  const n = $("#pg-note");
  n.textContent = text;
  n.hidden = false;
}

async function showLibraryView() {
  $("#lib-view").hidden = false;
  const [root] = await chrome.bookmarks.getTree();
  let links = 0, folders = 0;
  const walk = (nodes) => nodes.forEach((n) => {
    if (n.url) links++;
    else {
      folders++;
      walk(n.children || []);
    }
  });
  walk(root.children || []);
  $("#total-count").textContent = links;
  $("#folder-count").textContent = folders;
  $("#btn-open").addEventListener("click", openLibrary);
}

function openLibrary() {
  chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
  window.close();
}

async function setupFooter(target) {
  $("#btn-library")?.addEventListener("click", openLibrary);

  const windowId = target ? target.windowId : chrome.windows.WINDOW_ID_CURRENT;
  const tabs = await chrome.tabs.query({ windowId });
  const count = tabs.filter((t) => /^(https?|file):/i.test(t.url || "")).length;
  $("#save-tabs-label").textContent = `Save all ${count} tab${count === 1 ? "" : "s"}`;
  $("#btn-save-tabs").disabled = count === 0;
  $("#btn-save-tabs").addEventListener("click", async () => {
    const name = "Tabs — " + new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    try {
      const { count: n } = await BM.saveTabsToFolder(name, "2", windowId);
      $("#save-tabs-label").textContent = `Saved ${n} tabs to “Other bookmarks”`;
      $("#btn-save-tabs").disabled = true;
    } catch (e) {
      $("#save-tabs-label").textContent = e.message;
    }
  });

  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === "_execute_action");
    const mod = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
    $("#shortcut").innerHTML = `Shortcut <kbd>${mod}+Shift+D</kbd>` +
      (c && c.shortcut ? ` or <kbd>${BM.escapeHTML(c.shortcut)}</kbd>` : "");
  } catch (e) {}
}
