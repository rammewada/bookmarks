// newtab.js — Library UI (new tab page)
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = BM.escapeHTML;
const { KEYS } = BM;
const PAGE_SIZE = 60;
const DRAG_TYPE = "application/x-bm-ids";
const BUILTIN_FILTERS = ["all", "recent", "pinned", "untagged", "broken", "duplicates", "insights"];

const svg = (body, size = 14, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  chevron: svg('<polyline points="9 18 15 12 9 6"/>', 12, 2.5),
  folder: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', 16),
  folderSm: '<span class="folder-ico">' + svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', 14) + "</span>",
  folderPlus: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>'),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', 14, 2.4),
  more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', 16, 3),
  star: (on) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>', 14, 3),
  bookmarkBig: svg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 48, 1.5),
  okBig: svg('<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/>', 48, 1.5),
  linkBig: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 48, 1.5),
  searchBig: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 48, 1.5),
};

const state = {
  tree: [],
  all: [],
  byId: new Map(),
  counts: new Map(), // folder id → number of bookmarks inside (recursive)
  folders: [],
  meta: {},
  page: {}, // page-metadata cache (thumbnails)
  health: {},
  settings: {},
  dupes: null,
  filter: localStorage.getItem("bm-filter") || "all",
  view: localStorage.getItem("view-mode") === "list" ? "list" : "grid",
  sort: localStorage.getItem("bm-sort") || "manual",
  search: "",
  expanded: new Set(readJSON("bm-expanded", ["1", "2"])),
  selected: new Set(),
  visibleIds: [],
  rendered: 0,
  edit: null,
  scan: null,
};

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (e) {
    return fallback;
  }
}

// ── Theme (applied immediately to avoid a flash) ──

function applyTheme() {
  let t = localStorage.getItem("theme");
  if (!t && localStorage.getItem("dark-mode") === "true") t = "dark"; // legacy setting
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
}
function toggleTheme() {
  const dark = document.documentElement.classList.contains("dark");
  localStorage.setItem("theme", dark ? "light" : "dark");
  localStorage.removeItem("dark-mode");
  applyTheme();
}
applyTheme();

// ── Init & data ──

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadBookmarks(), loadStorage()]);
  if (!filterExists(state.filter)) state.filter = "all";
  $("#sort-select").value = state.sort;
  bindEvents();
  renderAll();
  const params = new URLSearchParams(location.search);
  if (params.has("edit")) openEdit(params.get("edit"));
});

async function loadBookmarks() {
  const [root] = await chrome.bookmarks.getTree();
  state.tree = root.children || [];
  state.byId = new Map();
  state.counts = new Map();
  state.all = [];
  const walk = (n) => {
    state.byId.set(n.id, n);
    if (n.url) {
      state.all.push(n);
      return 1;
    }
    let c = 0;
    for (const ch of n.children || []) c += walk(ch);
    state.counts.set(n.id, c);
    return c;
  };
  state.tree.forEach(walk);
  state.folders = BM.flattenFolders([root]);
  state.dupes = null;
  for (const id of [...state.selected]) if (!state.byId.has(id)) state.selected.delete(id);
}

async function loadStorage() {
  const r = await chrome.storage.local.get([KEYS.META, KEYS.PAGE, KEYS.HEALTH, KEYS.SETTINGS]);
  state.meta = r[KEYS.META] || {};
  state.page = r[KEYS.PAGE] || {};
  state.health = r[KEYS.HEALTH] || {};
  state.settings = r[KEYS.SETTINGS] || {};
}

const metaOf = (id) => state.meta[id] || {};
const isBroken = (url) => state.health[url]?.status === "broken";
const currentFolderId = () => (state.filter.startsWith("folder:") ? state.filter.slice(7) : null);

function filterExists(f) {
  if (f.startsWith("folder:")) {
    const n = state.byId.get(f.slice(7));
    return !!n && !n.url;
  }
  if (f.startsWith("tag:")) return true;
  return BUILTIN_FILTERS.includes(f);
}

function pathOf(id) {
  const out = [];
  let n = state.byId.get(id);
  while (n) {
    out.unshift(n);
    n = state.byId.get(n.parentId);
  }
  return out;
}

function folderPathText(id) {
  return pathOf(id).map((n) => n.title || "Untitled").join(" › ");
}

function flattenNode(node) {
  if (!node) return [];
  if (node.url) return [node];
  return (node.children || []).flatMap(flattenNode);
}

function tagCounts() {
  const m = new Map();
  for (const bm of state.all) for (const t of metaOf(bm.id).tags || []) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function dupKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch (e) {
    return url;
  }
}

function getDuplicates() {
  if (state.dupes) return state.dupes;
  const map = new Map();
  for (const bm of state.all) {
    const k = dupKey(bm.url);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(bm);
  }
  state.dupes = [...map.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0)));
  return state.dupes;
}

function sortList(list) {
  const arr = list.slice();
  const name = (b) => b.title || b.url;
  switch (state.sort) {
    case "newest": return arr.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    case "oldest": return arr.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
    case "name": return arr.sort((a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: "base", numeric: true }));
    case "domain": return arr.sort((a, b) => BM.domain(a.url).localeCompare(BM.domain(b.url)) || name(a).localeCompare(name(b)));
    default: return arr;
  }
}

function searchItems(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const tagTerms = terms.filter((t) => t.startsWith("#") && t.length > 1).map((t) => t.slice(1));
  const words = terms.filter((t) => !t.startsWith("#"));
  let bms = state.all.filter((bm) => {
    const m = metaOf(bm.id);
    const tags = m.tags || [];
    if (!tagTerms.every((t) => tags.some((x) => x.startsWith(t)))) return false;
    if (!words.length) return true;
    const hay = `${bm.title} ${bm.url} ${tags.join(" ")} ${m.notes || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (state.sort === "manual" && words.length) {
    // Title matches first, then everything else, preserving folder order.
    const score = (bm) => (words.every((w) => (bm.title || "").toLowerCase().includes(w)) ? 0 : 1);
    bms = bms.map((b, i) => [score(b), i, b]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  } else bms = sortList(bms);
  const folders = words.length && !tagTerms.length
    ? state.folders.filter((f) => words.every((w) => f.title.toLowerCase().includes(w)))
    : [];
  return { bms, folders };
}

// ── Rendering ──

let restoreCount = 0;
let observers = [];

function renderAll() {
  renderSidebar();
  renderMain();
  updateToolbar();
  updateBulkBar();
}

/** Re-render while keeping the scroll position (used after live changes). */
function refresh() {
  const c = $("#container");
  const top = c.scrollTop;
  restoreCount = state.rendered;
  renderAll();
  c.scrollTop = top;
  restoreCount = 0;
}

function setCount(name, v) {
  const el = $("#count-" + name);
  if (el) el.textContent = v || "";
}

function renderSidebar() {
  setCount("all", state.all.length);
  setCount("pinned", state.all.filter((b) => metaOf(b.id).pinned).length);
  setCount("untagged", state.all.filter((b) => !(metaOf(b.id).tags || []).length).length);
  setCount("broken", state.all.filter((b) => isBroken(b.url)).length);
  setCount("dupes", getDuplicates().length);
  $$("#main-nav [data-filter]").forEach((el) => el.classList.toggle("active", !state.search && el.dataset.filter === state.filter));

  renderTree();

  const tags = [...tagCounts().entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("#tag-list").innerHTML = tags.length
    ? tags.slice(0, 30).map(([t, c]) =>
        `<button class="tag-pill${state.filter === "tag:" + t && !state.search ? " active" : ""}" data-filter="tag:${esc(t)}">#${esc(t)}<span>${c}</span></button>`).join("") +
      (tags.length > 30 ? `<button class="tag-pill" data-filter="insights">+${tags.length - 30} more</button>` : "")
    : '<div class="empty-hint">Tags you add to bookmarks show up here.</div>';
}

function renderTree() {
  const tree = $("#folder-tree");
  const focusedId = tree.contains(document.activeElement) ? document.activeElement.dataset.folder : null;
  const active = state.search ? null : currentFolderId();
  const rows = [];
  const walk = (nodes, depth) => {
    for (const f of nodes) {
      if (f.url) continue;
      if (f.parentId === "0" && f.id !== "1" && f.id !== "2" && !(f.children || []).length) continue;
      const hasSubs = (f.children || []).some((c) => !c.url);
      const open = hasSubs && state.expanded.has(f.id);
      rows.push(
        `<div class="tree-row${f.id === active ? " active" : ""}" role="treeitem" tabindex="-1"${hasSubs ? ` aria-expanded="${open}"` : ""}` +
          ` data-folder="${f.id}" data-drop-folder="${f.id}" draggable="${!BM.ROOT_IDS.has(f.id)}" style="--depth:${depth}" title="${esc(f.title)}">` +
          `<button class="tree-twisty${hasSubs ? "" : " leaf"}${open ? " open" : ""}" data-toggle="${f.id}" tabindex="-1" aria-label="${open ? "Collapse" : "Expand"}">${ICON.chevron}</button>` +
          `${ICON.folderSm}<span class="tree-label">${esc(f.title || "Untitled")}</span><span class="tree-count">${state.counts.get(f.id) || ""}</span></div>`,
      );
      if (open) walk(f.children, depth + 1);
    }
  };
  walk(state.tree, 0);
  tree.innerHTML = rows.join("");
  const focusRow = (focusedId && tree.querySelector(`[data-folder="${focusedId}"]`)) ||
    (active && tree.querySelector(`[data-folder="${active}"]`)) || tree.querySelector(".tree-row");
  if (focusRow) {
    focusRow.tabIndex = 0;
    if (focusedId) focusRow.focus();
  }
}

function updateToolbar() {
  $("#view-grid").classList.toggle("active", state.view === "grid");
  $("#view-list").classList.toggle("active", state.view === "list");
  const noSort = !state.search && ["insights", "duplicates", "recent"].includes(state.filter);
  $("#sort-select").hidden = noSort;
  $("#container").toggleAttribute("data-drop-folder", false);
  const fid = !state.search && currentFolderId();
  if (fid) $("#container").dataset.dropFolder = fid;
}

function viewHead({ crumbs = "", title, count, sub = "", actions = "" }) {
  return `${crumbs}<div class="view-head"><div><h2 class="view-title serif">${esc(title)}${count != null ? ` <small>${count}</small>` : ""}</h2>` +
    `${sub ? `<p class="view-sub">${sub}</p>` : ""}</div><div class="view-actions">${actions}</div></div>`;
}

function sectionTitle(title, count) {
  const h = document.createElement("h3");
  h.className = "section-title serif";
  h.innerHTML = `${esc(title)}${count != null ? ` <small>${count}</small>` : ""}`;
  return h;
}

function emptyState(title, text, actions = "", icon = ICON.bookmarkBig) {
  return `<div class="empty">${icon}<h3 class="serif">${esc(title)}</h3><p>${text}</p>${actions}</div>`;
}

function renderMain() {
  observers.forEach((o) => o.disconnect());
  observers = [];
  state.visibleIds = [];
  state.rendered = 0;
  const head = $("#view-head");
  const content = $("#content");
  head.innerHTML = "";
  content.innerHTML = "";
  const f = state.filter;

  if (state.search) return renderSearch(head, content);
  if (f === "insights") return renderInsights(head, content);
  if (f === "duplicates") return renderDuplicates(head, content);
  if (f === "broken") return renderBroken(head, content);
  if (f === "recent") return renderRecent(head, content);
  if (f.startsWith("folder:")) return renderFolder(f.slice(7), head, content);

  if (f.startsWith("tag:")) {
    const t = f.slice(4);
    const list = sortList(state.all.filter((b) => (metaOf(b.id).tags || []).includes(t)));
    head.innerHTML = viewHead({
      title: "#" + t,
      count: list.length,
      actions: list.length
        ? `<button class="btn" data-action="rename-tag" data-tag="${esc(t)}">Rename tag</button><button class="btn btn-danger" data-action="delete-tag" data-tag="${esc(t)}">Remove tag</button>`
        : "",
    });
    if (!list.length) content.innerHTML = emptyState("No bookmarks with this tag", "Add the tag to a bookmark from its edit dialog or the toolbar popup.");
    else renderCards(content, list);
    return;
  }

  if (f === "pinned") {
    const list = sortList(state.all.filter((b) => metaOf(b.id).pinned));
    head.innerHTML = viewHead({ title: "Pinned", count: list.length });
    if (!list.length) content.innerHTML = emptyState("Nothing pinned yet", "Hover a bookmark and click the star to keep it at the top of your library.");
    else renderCards(content, list);
    return;
  }

  if (f === "untagged") {
    const list = sortList(state.all.filter((b) => !(metaOf(b.id).tags || []).length));
    head.innerHTML = viewHead({ title: "Untagged", count: list.length, sub: list.length ? "Select several with the checkbox, then use “Add tag” to tag them in one go." : "" });
    if (!list.length) content.innerHTML = emptyState("Everything is tagged", "Nice — every bookmark has at least one tag.", "", ICON.okBig);
    else renderCards(content, list);
    return;
  }

  // All bookmarks
  head.innerHTML = viewHead({ title: "All bookmarks", count: state.all.length });
  if (!state.all.length) {
    content.innerHTML = emptyState(
      "Your library is empty",
      "Click the extension icon (or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> on any page) on any page to save it. You can also right-click any link and choose “Save link to Library”.",
      '<button class="btn btn-primary" data-action="add-bookmark">Add your first bookmark</button>',
    );
    return;
  }
  const pinned = sortList(state.all.filter((b) => metaOf(b.id).pinned));
  if (pinned.length) {
    content.appendChild(sectionTitle("Pinned", pinned.length));
    renderCards(content, pinned);
    content.appendChild(sectionTitle("Everything", state.all.length));
  }
  renderCards(content, sortList(state.all));
}

function renderSearch(head, content) {
  const { bms, folders } = searchItems(state.search);
  head.innerHTML = viewHead({
    title: `Results for “${state.search}”`,
    count: bms.length,
    actions: '<button class="btn" data-action="clear-search">Clear search</button>',
  });
  if (folders.length) {
    content.appendChild(sectionTitle("Folders", folders.length));
    content.insertAdjacentHTML("beforeend", folderTiles(folders.slice(0, 12).map((f) => state.byId.get(f.id))));
    if (bms.length) content.appendChild(sectionTitle("Bookmarks", bms.length));
  }
  if (bms.length) renderCards(content, bms);
  else if (!folders.length) content.innerHTML = emptyState("No matches", "Try fewer words, or search a tag with <kbd>#tag</kbd>.", "", ICON.searchBig);
}

function renderRecent(head, content) {
  const list = state.all.slice().sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0)).slice(0, 300);
  head.innerHTML = viewHead({ title: "Recently added" });
  if (!list.length) {
    content.innerHTML = emptyState("Nothing here yet", "Bookmarks you save will appear here, newest first.");
    return;
  }
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const day = 86400000;
  const buckets = [
    ["Today", startOfDay],
    ["Yesterday", startOfDay - day],
    ["This week", startOfDay - 7 * day],
    ["This month", startOfDay - 30 * day],
    ["Earlier", -Infinity],
  ];
  let i = 0;
  for (const [label, since] of buckets) {
    const group = [];
    while (i < list.length && (list[i].dateAdded || 0) >= since) group.push(list[i++]);
    if (!group.length) continue;
    content.appendChild(sectionTitle(label, group.length));
    renderCards(content, group);
  }
}

function folderTiles(nodes) {
  return `<div class="folder-tiles">${nodes
    .filter(Boolean)
    .map((s) =>
      `<div class="folder-tile" tabindex="0" role="button" data-open-folder="${s.id}" data-drop-folder="${s.id}" draggable="true" title="${esc(folderPathText(s.id))}">` +
      `${ICON.folder}<span class="ft-name">${esc(s.title || "Untitled")}</span><span class="ft-count">${state.counts.get(s.id) || 0}</span></div>`)
    .join("")}</div>`;
}

function renderFolder(id, head, content) {
  const node = state.byId.get(id);
  if (!node) return setFilter("all");
  const path = pathOf(id);
  const subs = (node.children || []).filter((c) => !c.url);
  const bms = sortList((node.children || []).filter((c) => c.url));
  const isRoot = BM.ROOT_IDS.has(id);

  const crumbs = `<div class="crumbs"><button class="crumb" data-filter="all">Library</button>${path
    .slice(0, -1)
    .map((n) => `<span>›</span><button class="crumb" data-filter="folder:${n.id}" data-drop-folder="${n.id}">${esc(n.title)}</button>`)
    .join("")}</div>`;
  const menu =
    `<details class="menu"><summary class="btn" title="More actions">${ICON.more}</summary><div class="menu-list">` +
    `<button data-action="open-all" data-id="${id}">Open all in new tabs</button>` +
    `<button data-action="copy-links" data-id="${id}">Copy all links</button>` +
    `<button data-action="export" data-id="${id}">Export this folder</button>` +
    `<button data-action="sort-folder" data-id="${id}">Sort A–Z permanently</button>` +
    (isRoot ? "" : `<hr><button data-action="rename-folder" data-id="${id}">Rename…</button><button class="danger" data-action="delete-folder" data-id="${id}">Delete folder</button>`) +
    `</div></details>`;

  head.innerHTML = crumbs + viewHead({
    title: node.title || "Untitled",
    count: state.counts.get(id) || 0,
    actions: `<button class="btn" data-action="add-bookmark">${ICON.plus} Bookmark</button><button class="btn" data-action="new-folder" data-parent="${id}">${ICON.folderPlus} Folder</button>${menu}`,
  });

  if (subs.length) content.insertAdjacentHTML("beforeend", folderTiles(subs));
  if (bms.length) {
    if (subs.length) content.appendChild(sectionTitle("Bookmarks", bms.length));
    renderCards(content, bms);
  }
  if (!subs.length && !bms.length) {
    content.innerHTML = emptyState(
      "This folder is empty",
      "Drag bookmarks here, drop a link from another window, or add one.",
      '<button class="btn btn-primary" data-action="add-bookmark">Add bookmark</button>',
    );
  }
}

function renderBroken(head, content) {
  const list = sortList(state.all.filter((b) => isBroken(b.url)));
  const last = state.settings.lastScan;
  const scanning = !!state.scan;
  const restricted = state.all.filter((b) => state.health[b.url]?.status === "restricted").length;
  const restrictedNote = restricted
    ? ` ${restricted} link${restricted === 1 ? "" : "s"} on sign-in sites (Figma, Google Docs, GitHub…) couldn't be verified from outside the app, so ${restricted === 1 ? "it was" : "they were"} not counted as broken.`
    : "";
  head.innerHTML = viewHead({
    title: "Broken links",
    count: list.length,
    sub: scanning ? "" : last
      ? `Last checked ${BM.timeAgo(last)}. Only pages confirmed missing (404) or unreachable are listed.${restrictedNote}`
      : "Check every saved link for pages that no longer exist.",
    actions: scanning ? "" :
      `<button class="btn btn-primary" data-action="scan-links">${last ? "Check again" : "Check links"}</button>` +
      (list.length ? `<button class="btn btn-danger" data-action="delete-broken">Delete all ${list.length}</button>` : ""),
  });
  if (scanning) {
    head.insertAdjacentHTML("beforeend", `<div class="progress" id="scan-progress"><div></div></div><p class="view-sub" id="scan-label" style="margin:-12px 0 20px"></p>`);
    updateScanProgress();
  }
  if (list.length) renderCards(content, list);
  else if (!scanning) {
    content.innerHTML = last
      ? emptyState("No broken links", "Every link responded the last time we checked.", "", ICON.okBig)
      : emptyState("Not checked yet", `Checks all ${state.all.length} links in the background — you can keep browsing while it runs.`, '<button class="btn btn-primary" data-action="scan-links">Check links now</button>', ICON.linkBig);
  }
}

function itemRow(b, right) {
  return `<div class="item-row"><img src="${BM.favicon(b.url, 32)}" alt=""><div class="item-main">` +
    `<a class="item-title" href="${esc(b.url)}">${esc(b.title || b.url)}</a>` +
    `<div class="item-sub">${esc(folderPathText(b.parentId))}${b.dateAdded ? " · " + BM.timeAgo(b.dateAdded) : ""}</div></div>${right}</div>`;
}

function renderDuplicates(head, content) {
  const groups = getDuplicates();
  const extra = groups.reduce((s, g) => s + g.length - 1, 0);
  head.innerHTML = viewHead({
    title: "Duplicates",
    count: groups.length,
    sub: groups.length ? `${extra} extra cop${extra === 1 ? "y" : "ies"} found. The oldest copy of each link is kept.` : "",
    actions: groups.length ? `<button class="btn btn-primary" data-action="remove-dupes">Remove ${extra} extra cop${extra === 1 ? "y" : "ies"}</button>` : "",
  });
  if (!groups.length) {
    content.innerHTML = emptyState("No duplicates", "Every link in your library is unique.", "", ICON.okBig);
    return;
  }
  content.innerHTML = groups
    .slice(0, 300)
    .map((g) =>
      `<div class="group-box"><div class="group-url">${esc(g[0].url)}</div>${g
        .map((b, i) => itemRow(b, i === 0 ? '<span class="keep">KEEP</span>' : `<button class="btn btn-ghost btn-danger" data-action="remove-one" data-id="${b.id}">Remove</button>`))
        .join("")}</div>`)
    .join("");
}

function renderInsights(head, content) {
  const total = state.all.length;
  const tc = tagCounts();
  const untagged = state.all.filter((b) => !(metaOf(b.id).tags || []).length).length;
  const broken = state.all.filter((b) => isBroken(b.url)).length;
  const domains = new Map();
  for (const b of state.all) {
    const d = BM.domain(b.url);
    if (d) domains.set(d, (domains.get(d) || 0) + 1);
  }
  const top = [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const max = top.length ? top[0][1] : 1;
  const tags = [...tc.entries()].sort((a, b) => b[1] - a[1]);
  const stale = state.all
    .filter((b) => { const m = metaOf(b.id); return !(m.tags || []).length && !m.notes; })
    .sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0))
    .slice(0, 8);
  const card = (num, label, filter) =>
    filter
      ? `<button class="insight-card" data-filter="${filter}"><div class="insight-num serif">${num}</div><div class="insight-label">${label}</div></button>`
      : `<div class="insight-card"><div class="insight-num serif">${num}</div><div class="insight-label">${label}</div></div>`;

  head.innerHTML = viewHead({ title: "Insights" });
  content.innerHTML = `
    <div class="insights-grid">
      ${card(total, "Bookmarks", "all")}
      ${card(state.folders.length, "Folders")}
      ${card(tc.size, "Tags")}
      ${card(untagged, "Untagged", "untagged")}
      ${card(getDuplicates().length, "Duplicate links", "duplicates")}
      ${card(broken, "Broken links", "broken")}
    </div>
    <h3 class="section-title serif">Top websites</h3>
    ${top.map(([d, c]) => `<div class="bar-row"><div class="bar-label">${esc(d)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round((c / max) * 100)}%">${c}</div></div></div>`).join("") || '<p class="view-sub">No bookmarks yet.</p>'}
    <h3 class="section-title serif">All tags</h3>
    <div class="tag-cloud">${tags.map(([t, c]) => `<button class="tag-pill" data-filter="tag:${esc(t)}">#${esc(t)}<span>${c}</span></button>`).join("") || '<p class="view-sub">No tags yet.</p>'}</div>
    <h3 class="section-title serif">Needs attention <small>oldest without tags or notes</small></h3>
    <div class="group-box">${stale.map((b) => itemRow(b, `<button class="btn btn-ghost" data-action="edit" data-id="${b.id}">Edit</button>`)).join("") || '<p class="view-sub" style="padding:10px 0">Everything is organized.</p>'}</div>`;
}

// ── Cards ──

function renderCards(target, list) {
  const grid = document.createElement("div");
  grid.className = `cards ${state.view}`;
  target.appendChild(grid);
  list.forEach((b) => state.visibleIds.push(b.id));

  const sentinel = document.createElement("div");
  sentinel.className = "sentinel";
  let i = 0;
  const more = (count) => {
    const frag = document.createDocumentFragment();
    const slice = list.slice(i, i + count);
    slice.forEach((bm) => frag.appendChild(createCard(bm)));
    i += slice.length;
    state.rendered += slice.length;
    grid.appendChild(frag);
    if (i < list.length) {
      grid.appendChild(sentinel);
      io.unobserve(sentinel);
      io.observe(sentinel);
    } else {
      sentinel.remove();
      io.disconnect();
    }
  };
  const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(PAGE_SIZE), {
    root: $("#container"),
    rootMargin: "800px",
  });
  observers.push(io);
  more(Math.max(PAGE_SIZE, restoreCount));
}

function createCard(bm) {
  const m = metaOf(bm.id);
  const d = BM.domain(bm.url) || (bm.url || "").split(":")[0];
  const broken = isBroken(bm.url);
  const sel = state.selected.has(bm.id);
  const el = document.createElement("div");
  el.className = `card${broken ? " broken" : ""}${sel ? " selected" : ""}`;
  el.dataset.id = bm.id;
  el.draggable = true;
  el.style.setProperty("--hue", BM.hue(d));
  const tags = (m.tags || []).map((t) => `<button class="c-tag" data-filter="tag:${esc(t)}">#${esc(t)}</button>`).join("");
  const dot = '<span class="dot"></span>';
  el.innerHTML =
    `<div class="visual"><img class="fallback-icon" src="${BM.favicon(bm.url, 64)}" alt=""><img class="thumb" alt="" referrerpolicy="no-referrer"></div>` +
    `<div class="details"><img class="favicon" src="${BM.favicon(bm.url, 32)}" alt=""><div class="text">` +
    `<a class="c-title" href="${esc(bm.url)}" draggable="false" title="${esc(bm.title || bm.url)}&#10;${esc(bm.url)}">${esc(bm.title || bm.url)}</a>` +
    `<div class="c-meta"><span class="c-domain">${esc(d)}</span>${m.pinned ? dot + '<span class="badge-pin">Pinned</span>' : ""}` +
    `${broken ? dot + '<span class="badge-broken">Broken</span>' : ""}${bm.dateAdded ? dot + `<span>${BM.timeAgo(bm.dateAdded)}</span>` : ""}</div>` +
    `${tags ? `<div class="c-tags">${tags}</div>` : ""}${m.notes ? `<div class="c-notes">${esc(m.notes)}</div>` : ""}` +
    `${broken ? `<div class="c-fix"><button class="c-fix-btn" data-action="not-broken" title="This link works — stop flagging it">Not broken</button>` +
      `<button class="c-fix-btn" data-action="recheck">Check again</button>` +
      `<a class="c-wayback" href="https://web.archive.org/web/*/${esc(bm.url)}" target="_blank" rel="noopener">Archived copy ↗</a></div>` : ""}` +
    `</div></div>` +
    `<button class="card-check" data-action="select" title="Select" aria-pressed="${sel}">${ICON.check}</button>` +
    `<div class="card-actions">` +
    `<button class="act${m.pinned ? " on" : ""}" data-action="pin" title="${m.pinned ? "Unpin" : "Pin"}">${ICON.star(m.pinned)}</button>` +
    `<button class="act" data-action="copy" title="Copy link">${ICON.copy}</button>` +
    `<button class="act" data-action="edit" title="Edit">${ICON.edit}</button>` +
    `<button class="act danger" data-action="delete" title="Delete">${ICON.trash}</button></div>`;
  if (state.view === "grid" && BM.isWebUrl(bm.url)) thumbObserver().observe(el.querySelector(".visual"));
  return el;
}

// ── Thumbnails (lazy, cached, rate-limited) ──

const thumbQueue = BM.limiter(4);
const inflight = new Map();
let _thumbIO = null;

function thumbObserver() {
  if (!_thumbIO) {
    _thumbIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        _thumbIO.unobserve(e.target);
        loadThumb(e.target);
      }
    }, { root: $("#container"), rootMargin: "300px" });
  }
  return _thumbIO;
}

function loadThumb(visual) {
  const bm = state.byId.get(visual.closest(".card")?.dataset.id);
  if (!bm) return;
  const cached = state.page[bm.url];
  if (cached && Date.now() - cached.fetchedAt < BM.PAGE_TTL) return setThumb(visual, cached.ogImage);
  if (!inflight.has(bm.url)) {
    inflight.set(bm.url, thumbQueue(async () => {
      let data = {};
      try {
        data = await BM.fetchPageMeta(bm.url);
      } catch (e) {}
      state.page[bm.url] = { ogImage: data.ogImage || null, description: data.description || null, fetchedAt: Date.now() };
      savePageCache();
      inflight.delete(bm.url);
      return data.ogImage;
    }));
  }
  inflight.get(bm.url).then((src) => visual.isConnected && setThumb(visual, src));
}

function setThumb(visual, src) {
  if (!src) return;
  const img = visual.querySelector(".thumb");
  if (!img || img.src) return;
  img.onload = () => img.classList.add("loaded");
  img.onerror = () => img.remove();
  img.src = src;
}

const savePageCache = BM.debounce(() => {
  const urls = new Set(state.all.map((b) => b.url));
  const pruned = {};
  for (const [u, v] of Object.entries(state.page)) if (urls.has(u)) pruned[u] = v;
  state.page = pruned;
  BM.write(KEYS.PAGE, pruned);
}, 1500);

const saveHealth = BM.debounce(() => {
  const urls = new Set(state.all.map((b) => b.url));
  const pruned = {};
  for (const [u, v] of Object.entries(state.health)) if (urls.has(u)) pruned[u] = v;
  BM.write(KEYS.HEALTH, pruned);
}, 1000);

// ── Navigation ──

function setFilter(f) {
  state.filter = f;
  localStorage.setItem("bm-filter", f);
  if (state.search) {
    state.search = "";
    $("#search-input").value = "";
  }
  state.selected.clear();
  const fid = currentFolderId();
  if (fid) {
    pathOf(fid).slice(0, -1).forEach((n) => state.expanded.add(n.id));
    saveExpanded();
  }
  renderAll();
  $("#container").scrollTop = 0;
}

function setView(v) {
  state.view = v;
  localStorage.setItem("view-mode", v);
  refresh();
}

function saveExpanded() {
  localStorage.setItem("bm-expanded", JSON.stringify([...state.expanded]));
}

function toggleExpand(id, force) {
  const open = force ?? !state.expanded.has(id);
  if (open) state.expanded.add(id);
  else state.expanded.delete(id);
  saveExpanded();
  renderTree();
}

function onTreeRowClick(id) {
  const node = state.byId.get(id);
  if (!node) return;
  const hasSubs = (node.children || []).some((c) => !c.url);
  if (currentFolderId() === id && !state.search) {
    if (hasSubs) toggleExpand(id); // clicking the open folder again folds/unfolds it
    return;
  }
  if (hasSubs) state.expanded.add(id);
  setFilter("folder:" + id);
}

function onTreeKey(e) {
  const row = e.target.closest(".tree-row");
  if (!row) return;
  const rows = $$("#folder-tree .tree-row");
  const i = rows.indexOf(row);
  const id = row.dataset.folder;
  const hasSubs = row.hasAttribute("aria-expanded");
  const open = row.getAttribute("aria-expanded") === "true";
  const focus = (r) => {
    if (!r) return;
    rows.forEach((x) => (x.tabIndex = -1));
    r.tabIndex = 0;
    r.focus();
  };
  switch (e.key) {
    case "ArrowDown": focus(rows[i + 1]); break;
    case "ArrowUp": focus(rows[i - 1]); break;
    case "Home": focus(rows[0]); break;
    case "End": focus(rows[rows.length - 1]); break;
    case "ArrowRight":
      if (hasSubs && !open) toggleExpand(id, true);
      else if (open) focus(rows[i + 1]);
      break;
    case "ArrowLeft":
      if (open) toggleExpand(id, false);
      else focus(rows.find((r) => r.dataset.folder === state.byId.get(id)?.parentId));
      break;
    case "Enter":
    case " ":
      setFilter("folder:" + id);
      break;
    default:
      return;
  }
  e.preventDefault();
}

// ── Events ──

function bindEvents() {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeyDown);
  $("#folder-tree").addEventListener("keydown", onTreeKey);

  const search = $("#search-input");
  const doSearch = BM.debounce(() => {
    state.search = search.value.trim();
    state.selected.clear();
    renderAll();
    $("#container").scrollTop = 0;
  }, 120);
  search.addEventListener("input", doSearch);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      search.value = "";
      doSearch.flush();
      search.blur();
    } else if (e.key === "Enter" || e.key === "ArrowDown") {
      doSearch.flush();
      const first = $("#content .c-title, #content .folder-tile");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  $("#sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    localStorage.setItem("bm-sort", state.sort);
    renderMain();
  });
  $("#bulk-move").addEventListener("change", (e) => {
    const v = e.target.value;
    e.target.value = "";
    if (v) moveNodes([...state.selected], v);
  });

  bindDragAndDrop();
  bindDialogs();
  bindLiveUpdates();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}

function onDocClick(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;

  // Close open overflow menus when clicking elsewhere / choosing an item.
  $$("details.menu[open]").forEach((d) => {
    if (!d.contains(t) || t.closest(".menu-list button")) d.open = false;
  });

  const quick = t.closest("[data-quick-tag]");
  if (quick) return editTags?.add(quick.dataset.quickTag);

  const twisty = t.closest("[data-toggle]");
  if (twisty) return toggleExpand(twisty.dataset.toggle);

  const row = t.closest(".tree-row");
  if (row) return onTreeRowClick(row.dataset.folder);

  const act = t.closest("[data-action]");
  const filt = t.closest("[data-filter]");
  const card = t.closest(".card");
  if (card) {
    if (act) {
      e.preventDefault();
      return cardAction(act.dataset.action, card.dataset.id);
    }
    if (filt) {
      e.preventDefault();
      return setFilter(filt.dataset.filter);
    }
    if (t.closest(".c-wayback")) return;
    if (state.selected.size) {
      e.preventDefault();
      return toggleSelect(card.dataset.id);
    }
    return; // regular link: let the browser open it (Ctrl/middle-click opens a new tab)
  }
  if (filt) return setFilter(filt.dataset.filter);

  const tile = t.closest("[data-open-folder]");
  if (tile) return setFilter("folder:" + tile.dataset.openFolder);

  if (act) globalAction(act.dataset.action, act);
}

function onKeyDown(e) {
  if (document.querySelector("dialog[open]")) return;
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (e.key === "/" && !typing) {
    e.preventDefault();
    $("#search-input").focus();
    $("#search-input").select();
    return;
  }
  if (typing || e.ctrlKey && !["a", "A"].includes(e.key) || e.altKey) return;

  if (e.key === "Escape") {
    if (state.selected.size) clearSelection();
    $$("details.menu[open]").forEach((d) => (d.open = false));
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    state.visibleIds.forEach((id) => state.selected.add(id));
    syncSelection();
  } else if ((e.key === "Delete" || e.key === "Backspace") && state.selected.size) {
    e.preventDefault();
    deleteNodes([...state.selected]);
  } else if (e.key === "Enter" && e.target.matches?.("[data-open-folder]")) {
    setFilter("folder:" + e.target.dataset.openFolder);
  } else if (e.key === "n" && !e.metaKey) {
    e.preventDefault();
    openAdd();
  }
}

async function cardAction(action, id) {
  const bm = state.byId.get(id);
  if (!bm) return;
  switch (action) {
    case "select":
      return toggleSelect(id);
    case "pin": {
      const pinned = !metaOf(id).pinned;
      state.meta = await BM.updateMeta(id, { pinned });
      toast(pinned ? "Pinned" : "Unpinned");
      return refresh();
    }
    case "copy":
      await navigator.clipboard.writeText(bm.url);
      return toast("Link copied");
    case "edit":
      return openEdit(id);
    case "delete":
      return deleteNodes([id]);
    case "not-broken":
      state.health[bm.url] = { status: "ok", checkedAt: Date.now(), dismissed: true };
      saveHealth.flush();
      toast("Marked as working — it won't be flagged again");
      return refresh();
    case "recheck": {
      toast("Checking…");
      const status = await BM.checkLink(bm.url);
      state.health[bm.url] = { status, checkedAt: Date.now() };
      saveHealth.flush();
      toast(status === "broken" ? "Still broken" : status === "restricted" ? "Works, but needs sign-in" : status === "slow" ? "Site is slow to respond — not marked broken" : "Link works");
      return refresh();
    }
  }
}

async function globalAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case "theme": return toggleTheme();
    case "view": return setView(el.dataset.view);
    case "add-bookmark": return openAdd();
    case "save-tabs": return saveTabs();
    case "new-folder": return newFolder(el.dataset.parent || currentFolderId() || "1");
    case "rename-folder": return renameFolder(id);
    case "delete-folder": return deleteNodes([id]);
    case "open-all": return openAll((state.byId.get(id)?.children || []).filter((c) => c.url));
    case "copy-links": return copyLinks(flattenNode(state.byId.get(id)));
    case "export": return exportHTML(id);
    case "sort-folder": return sortFolder(id);
    case "scan-links": return scanLinks();
    case "delete-broken": return deleteNodes(state.all.filter((b) => isBroken(b.url)).map((b) => b.id));
    case "remove-dupes": return deleteNodes(getDuplicates().flatMap((g) => g.slice(1).map((b) => b.id)));
    case "remove-one": return deleteNodes([id]);
    case "edit": return openEdit(id);
    case "rename-tag": return renameTag(el.dataset.tag);
    case "delete-tag": return deleteTag(el.dataset.tag);
    case "clear-search":
      $("#search-input").value = "";
      state.search = "";
      return renderAll();
    case "dlg-new-folder": return dialogNewFolder();
    case "bulk-clear": return clearSelection();
    case "bulk-delete": return deleteNodes([...state.selected]);
    case "bulk-open": return openAll([...state.selected].map((i) => state.byId.get(i)).filter((b) => b?.url));
    case "bulk-tag": return bulkTag();
    case "bulk-pin": return bulkPin();
  }
}

// ── Selection ──

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  syncSelection();
}

function clearSelection() {
  state.selected.clear();
  syncSelection();
}

function syncSelection() {
  $$("#content .card").forEach((c) => {
    const on = state.selected.has(c.dataset.id);
    c.classList.toggle("selected", on);
    c.querySelector(".card-check")?.setAttribute("aria-pressed", on);
  });
  updateBulkBar();
}

function updateBulkBar() {
  const n = state.selected.size;
  $("#bulk-bar").hidden = !n;
  $("#content").classList.toggle("selecting", n > 0);
  $("#toast").classList.toggle("lifted", n > 0);
  if (!n) return;
  $("#bulk-count").textContent = `${n} selected`;
  $("#bulk-move").innerHTML = '<option value="">Move to…</option>' + BM.folderOptionsHTML(state.folders);
}

async function bulkTag() {
  const raw = await ask({ title: `Tag ${state.selected.size} bookmarks`, message: "Separate several tags with commas.", input: true, placeholder: "e.g. reading, work", ok: "Add tags" });
  const add = BM.normalizeTags(raw || "");
  if (!add.length) return;
  const patches = {};
  for (const id of state.selected) patches[id] = { tags: [...(metaOf(id).tags || []), ...add] };
  state.meta = await BM.patchMetaMany(patches);
  toast(`Tagged ${state.selected.size} bookmarks`);
  clearSelection();
  refresh();
}

async function bulkPin() {
  const ids = [...state.selected];
  const pin = !ids.every((id) => metaOf(id).pinned);
  state.meta = await BM.patchMetaMany(Object.fromEntries(ids.map((id) => [id, { pinned: pin }])));
  toast(`${pin ? "Pinned" : "Unpinned"} ${ids.length}`);
  clearSelection();
  refresh();
}

// ── Bookmark & folder operations ──

function snapshot(n) {
  if (!n) return null;
  const m = state.meta[n.id] ? { ...state.meta[n.id], remindAt: null } : null;
  return { id: n.id, parentId: n.parentId, index: n.index, title: n.title, url: n.url, meta: m, children: n.url ? undefined : (n.children || []).map(snapshot) };
}

async function restore(s, parentId, metaPatch) {
  const data = { parentId, title: s.title, url: s.url };
  let node;
  try {
    node = await chrome.bookmarks.create({ ...data, index: s.index });
  } catch (e) {
    try {
      node = await chrome.bookmarks.create(data);
    } catch (e2) {
      node = await chrome.bookmarks.create({ ...data, parentId: "2" });
    }
  }
  if (s.meta) metaPatch[node.id] = s.meta;
  for (const c of s.children || []) await restore(c, node.id, metaPatch);
}

async function deleteNodes(ids) {
  ids = [...new Set(ids)].filter((id) => state.byId.has(id) && !BM.ROOT_IDS.has(id));
  const set = new Set(ids);
  ids = ids.filter((id) => !pathOf(id).slice(0, -1).some((a) => set.has(a.id))); // skip items inside deleted folders
  if (!ids.length) return;

  const folders = ids.filter((id) => !state.byId.get(id).url);
  const inside = folders.reduce((s, id) => s + (state.counts.get(id) || 0), 0);
  if (folders.length || ids.length > 25) {
    const first = state.byId.get(ids[0]);
    const ok = await ask({
      title: ids.length === 1 ? `Delete “${first.title || "Untitled"}”?` : `Delete ${ids.length} items?`,
      message: folders.length ? `This also deletes ${inside} bookmark${inside === 1 ? "" : "s"} inside. You can undo right after.` : "You can undo right after.",
      ok: "Delete",
      danger: true,
    });
    if (!ok) return;
  }

  const fid = currentFolderId();
  const leaving = fid && pathOf(fid).find((n) => set.has(n.id));
  const snaps = ids.map((id) => snapshot(state.byId.get(id))).sort((a, b) => a.index - b.index);
  for (const s of snaps) {
    try {
      if (s.url) await chrome.bookmarks.remove(s.id);
      else await chrome.bookmarks.removeTree(s.id);
    } catch (e) {
      console.warn("Delete failed", e);
    }
  }
  state.selected.clear();
  if (leaving) setFilter("folder:" + leaving.parentId);

  const label = ids.length === 1 ? (snaps[0].url ? "Bookmark deleted" : "Folder deleted") : `${ids.length} items deleted`;
  toast(label, {
    action: "Undo",
    onAction: async () => {
      const metaPatch = {};
      for (const s of snaps) await restore(s, s.parentId, metaPatch);
      if (Object.keys(metaPatch).length) state.meta = await BM.patchMetaMany(metaPatch);
      toast("Restored");
    },
  });
}

async function moveNodes(ids, targetId) {
  const target = state.byId.get(targetId);
  if (!target) return;
  let moved = 0, blocked = 0;
  for (const id of ids) {
    const n = state.byId.get(id);
    if (!n || BM.ROOT_IDS.has(id) || n.parentId === targetId) continue;
    if (!n.url && pathOf(targetId).some((a) => a.id === id)) {
      blocked++;
      continue;
    }
    try {
      await chrome.bookmarks.move(id, { parentId: targetId });
      moved++;
    } catch (e) {
      console.warn(e);
    }
  }
  state.selected.clear();
  updateBulkBar();
  if (moved) {
    toast(`Moved ${moved === 1 ? "" : moved + " items "}to “${target.title}”`, {
      action: currentFolderId() === targetId ? null : "Open",
      onAction: () => setFilter("folder:" + targetId),
    });
  } else if (blocked) toast("A folder can't be moved inside itself");
}

async function newFolder(parentId) {
  const parent = state.byId.get(parentId);
  const name = await ask({ title: "New folder", message: parent ? `Inside “${parent.title}”` : "", input: true, placeholder: "Folder name", ok: "Create" });
  if (!name || !name.trim()) return null;
  const f = await chrome.bookmarks.create({ parentId, title: name.trim() });
  state.expanded.add(parentId);
  saveExpanded();
  toast(`Created “${f.title}”`, { action: "Open", onAction: () => setFilter("folder:" + f.id) });
  return f;
}

async function renameFolder(id) {
  const n = state.byId.get(id);
  if (!n) return;
  const name = await ask({ title: "Rename folder", input: true, value: n.title, ok: "Rename" });
  if (name && name.trim() && name.trim() !== n.title) await chrome.bookmarks.update(id, { title: name.trim() });
}

async function sortFolder(id) {
  const n = state.byId.get(id);
  if (!n) return;
  const ok = await ask({ title: `Sort “${n.title}” A–Z?`, message: "Folders first, then bookmarks by name. This also changes the order in Chrome's bookmarks bar and manager.", ok: "Sort" });
  if (!ok) return;
  const kids = (n.children || []).slice().sort((a, b) =>
    (!!a.url - !!b.url) || (a.title || "").localeCompare(b.title || "", undefined, { numeric: true, sensitivity: "base" }));
  for (let i = 0; i < kids.length; i++) await chrome.bookmarks.move(kids[i].id, { parentId: id, index: i });
  toast("Folder sorted");
}

async function openAll(list) {
  const urls = list.map((b) => b.url).filter((u) => u && !/^javascript:/i.test(u));
  if (!urls.length) return toast("No links to open");
  if (urls.length > 15) {
    const ok = await ask({ title: `Open ${urls.length} tabs?`, message: "That's a lot of tabs at once.", ok: "Open all" });
    if (!ok) return;
  }
  for (const url of urls) chrome.tabs.create({ url, active: false });
}

async function copyLinks(list) {
  if (!list.length) return toast("No links to copy");
  await navigator.clipboard.writeText(list.map((b) => `${b.title || b.url}\n${b.url}`).join("\n\n"));
  toast(`Copied ${list.length} link${list.length === 1 ? "" : "s"}`);
}

async function saveTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const n = tabs.filter((t) => /^(https?|file):/i.test(t.url || "")).length;
  if (!n) return toast("No web pages are open in this window");
  const parentId = currentFolderId() || "2";
  const parent = state.byId.get(parentId);
  const name = await ask({
    title: "Save open tabs",
    message: `Saves ${n} tab${n === 1 ? "" : "s"} from this window into a new folder in “${parent?.title || "Other bookmarks"}”.`,
    input: true,
    value: "Tabs — " + new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
    ok: "Save",
  });
  if (!name || !name.trim()) return;
  try {
    const { folder, count } = await BM.saveTabsToFolder(name.trim(), parentId);
    toast(`Saved ${count} tabs`, { action: "Open", onAction: () => setFilter("folder:" + folder.id) });
  } catch (e) {
    toast(e.message);
  }
}

async function renameTag(oldTag) {
  const raw = await ask({ title: "Rename tag", input: true, value: oldTag, ok: "Rename" });
  const next = BM.normalizeTags(raw || "")[0];
  if (!next || next === oldTag) return;
  const patches = {};
  for (const [id, m] of Object.entries(state.meta)) {
    if ((m.tags || []).includes(oldTag)) patches[id] = { tags: m.tags.map((t) => (t === oldTag ? next : t)) };
  }
  state.meta = await BM.patchMetaMany(patches);
  setFilter("tag:" + next);
  toast(`Renamed to #${next}`);
}

async function deleteTag(tag) {
  const ids = Object.keys(state.meta).filter((id) => (state.meta[id].tags || []).includes(tag));
  const ok = await ask({ title: `Remove #${tag}?`, message: `The tag is removed from ${ids.length} bookmark${ids.length === 1 ? "" : "s"}. The bookmarks themselves stay.`, ok: "Remove tag", danger: true });
  if (!ok) return;
  state.meta = await BM.patchMetaMany(Object.fromEntries(ids.map((id) => [id, { tags: state.meta[id].tags.filter((t) => t !== tag) }])));
  setFilter("all");
  toast(`Removed #${tag}`);
}

function exportHTML(id) {
  const nodes = id === "all" ? state.tree : [state.byId.get(id)].filter(Boolean);
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];
  const date = (ts) => (ts ? ` ADD_DATE="${Math.floor(ts / 1000)}"` : "");
  const walk = (items, depth) => {
    const pad = "    ".repeat(depth);
    for (const n of items) {
      if (n.url) {
        const m = metaOf(n.id);
        const tags = (m.tags || []).join(",");
        lines.push(`${pad}<DT><A HREF="${esc(n.url)}"${date(n.dateAdded)}${tags ? ` TAGS="${esc(tags)}"` : ""}>${esc(n.title || n.url)}</A>`);
        if (m.notes) lines.push(`${pad}<DD>${esc(m.notes)}`);
      } else {
        lines.push(`${pad}<DT><H3${date(n.dateAdded)}${n.id === "1" ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ""}>${esc(n.title)}</H3>`, `${pad}<DL><p>`);
        walk(n.children || [], depth + 1);
        lines.push(`${pad}</DL><p>`);
      }
    }
  };
  walk(nodes, 1);
  lines.push("</DL><p>");
  const name = id === "all" ? "bookmarks" : "bookmarks-" + (state.byId.get(id)?.title || "folder").replace(/[^\w-]+/g, "-").toLowerCase();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/html" }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Export downloaded — import it in any browser");
}

// ── Link health scan ──

async function scanLinks() {
  if (state.scan) return;
  const all = [...new Set(state.all.map((b) => b.url).filter(BM.isWebUrl))]
    .filter((u) => !state.health[u]?.dismissed); // respect "Not broken"
  if (!all.length) return toast("No web links to check");

  // Interleave hosts so one site (e.g. 100 Figma links) isn't hit in a burst, and cap each
  // host at 2 parallel requests — bursts trigger rate limits that look like failures.
  const byHost = new Map();
  for (const u of all) {
    const h = BM.domain(u);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(u);
  }
  const urls = [];
  for (let i = 0; urls.length < all.length; i++) for (const list of byHost.values()) if (list[i]) urls.push(list[i]);
  const hostLimit = new Map();
  const perHost = (url, fn) => {
    const h = BM.domain(url);
    if (!hostLimit.has(h)) hostLimit.set(h, BM.limiter(2));
    return hostLimit.get(h)(fn);
  };

  state.scan = { done: 0, total: urls.length };
  renderMain();
  await BM.pool(urls, 8, async (url) => {
    const status = await perHost(url, () => BM.checkLink(url));
    state.health[url] = { status, checkedAt: Date.now() };
    state.scan.done++;
    updateScanProgress();
    saveHealth();
  });
  state.scan = null;
  saveHealth.flush();
  state.settings = await BM.setSettings({ lastScan: Date.now() });
  const broken = state.all.filter((b) => isBroken(b.url)).length;
  refresh();
  toast(broken ? `Check finished — ${broken} broken link${broken === 1 ? "" : "s"}` : "Check finished — all links work");
}

let scanFrame = 0;
function updateScanProgress() {
  if (scanFrame) return;
  scanFrame = requestAnimationFrame(() => {
    scanFrame = 0;
    if (!state.scan) return;
    const { done, total } = state.scan;
    const bar = $("#scan-progress > div");
    if (bar) bar.style.width = Math.round((done / total) * 100) + "%";
    const label = $("#scan-label");
    if (label) label.textContent = `Checking ${done} of ${total} links… you can keep using the library.`;
    setCount("broken", state.all.filter((b) => isBroken(b.url)).length);
  });
}

// ── Drag & drop ──

function clearDragOver() {
  $$(".drag-over").forEach((x) => x.classList.remove("drag-over"));
}

function bindDragAndDrop() {
  document.addEventListener("dragstart", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const card = t.closest(".card");
    const row = t.closest(".tree-row");
    const tile = t.closest(".folder-tile");
    let ids;
    if (card) {
      const id = card.dataset.id;
      ids = state.selected.has(id) ? [...state.selected] : [id];
      const bm = state.byId.get(id);
      e.dataTransfer.setData("text/uri-list", bm.url);
      e.dataTransfer.setData("text/plain", bm.url);
      card.classList.add("dragging");
    } else if (row && row.draggable) ids = [row.dataset.folder];
    else if (tile) ids = [tile.dataset.openFolder];
    else return;
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copyMove";
  });
  document.addEventListener("dragend", () => {
    $$(".dragging").forEach((x) => x.classList.remove("dragging"));
    clearDragOver();
  });
  document.addEventListener("dragover", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-drop-folder]") : null;
    const types = e.dataTransfer.types;
    const ours = types.includes(DRAG_TYPE);
    if (!target || !(ours || types.includes("text/uri-list"))) return clearDragOver();
    e.preventDefault();
    e.dataTransfer.dropEffect = ours ? "move" : "copy";
    if (!target.classList.contains("drag-over")) {
      clearDragOver();
      target.classList.add("drag-over");
    }
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) clearDragOver();
  });
  document.addEventListener("drop", async (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-drop-folder]") : null;
    clearDragOver();
    if (!target) return;
    e.preventDefault();
    const folderId = target.dataset.dropFolder;
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (raw) return moveNodes(JSON.parse(raw), folderId);

    // A link dragged in from another page or the address bar → save it here.
    const urls = (e.dataTransfer.getData("text/uri-list") || "").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
    if (!urls.length) return;
    for (const url of urls) {
      let title = url;
      try {
        title = (await BM.fetchPageMeta(url)).title || url;
      } catch (err) {}
      await chrome.bookmarks.create({ parentId: folderId, title, url });
    }
    toast(`Saved ${urls.length === 1 ? "link" : urls.length + " links"} to “${state.byId.get(folderId)?.title}”`);
  });
}

// ── Dialogs ──

let editTags = null;
let askResolve = null;

function bindDialogs() {
  for (const dlg of $$("dialog.dlg")) {
    // Click on the dimmed backdrop closes the dialog (but not a drag that ends there).
    let downOnBackdrop = false;
    dlg.addEventListener("mousedown", (e) => (downOnBackdrop = e.target === dlg));
    dlg.addEventListener("click", (e) => {
      if (downOnBackdrop && e.target === dlg) dlg.close();
    });
  }

  // Edit dialog
  $("#edit-form").addEventListener("submit", submitEdit);
  $("#edit-cancel").addEventListener("click", () => $("#edit-dialog").close());
  $("#edit-delete").addEventListener("click", () => {
    $("#edit-dialog").close();
    deleteNodes([state.edit.id]);
  });
  const autofill = BM.debounce(autofillTitle, 600);
  $("#edit-url").addEventListener("input", () => {
    updateEditPreview();
    autofill();
  });
  $("#edit-url").addEventListener("change", () => autofill.flush());

  // Ask dialog
  const askDlg = $("#ask-dialog");
  $("#ask-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("#ask-input");
    if (!inp.hidden && !inp.value.trim()) return inp.focus();
    finishAsk(inp.hidden ? true : inp.value);
  });
  $("#ask-cancel").addEventListener("click", () => finishAsk(null));
  // Esc / backdrop close → treat as cancel (unless a newer prompt is already showing).
  askDlg.addEventListener("close", () => {
    if (!askDlg.open) finishAsk(null);
  });
}

function ask({ title, message = "", input = false, value = "", placeholder = "", ok = "OK", danger = false }) {
  finishAsk(null);
  $("#ask-title").textContent = title;
  $("#ask-msg").textContent = message;
  $("#ask-msg").hidden = !message;
  const inp = $("#ask-input");
  inp.hidden = !input;
  inp.value = value;
  inp.placeholder = placeholder;
  const okBtn = $("#ask-ok");
  okBtn.textContent = ok;
  okBtn.className = "btn " + (danger ? "btn-danger" : "btn-primary");
  $("#ask-dialog").showModal();
  if (input) {
    inp.focus();
    inp.select();
  } else okBtn.focus();
  return new Promise((resolve) => (askResolve = resolve));
}

function finishAsk(value) {
  const r = askResolve;
  askResolve = null;
  if ($("#ask-dialog").open) $("#ask-dialog").close();
  if (r) r(value);
}

function openEdit(id) {
  const bm = state.byId.get(id);
  if (!bm || !bm.url) return;
  state.edit = { mode: "edit", id };
  fillEdit({ url: bm.url, title: bm.title, parentId: bm.parentId, meta: metaOf(id) });
}

async function openAdd(url = "", title = "") {
  const parentId = currentFolderId() || (await BM.validFolder(state.settings.lastFolderId));
  state.edit = { mode: "add" };
  fillEdit({ url, title, parentId, meta: {} });
}

function fillEdit({ url, title, parentId, meta }) {
  const add = state.edit.mode === "add";
  $("#edit-heading").textContent = add ? "Add bookmark" : "Edit bookmark";
  $("#edit-save").textContent = add ? "Add" : "Save";
  $("#edit-delete").hidden = add;
  $("#edit-url").value = url || "";
  $("#edit-title").value = title || "";
  $("#edit-folder").innerHTML = BM.folderOptionsHTML(state.folders, parentId);
  $("#edit-notes").value = meta.notes || "";
  $("#edit-pin").checked = !!meta.pinned;
  const allTags = [...tagCounts().keys()].sort();
  if (!editTags) editTags = BM.createTagInput($("#edit-tags"), { suggestions: allTags, onChange: renderEditQuickTags });
  editTags.setSuggestions(allTags);
  editTags.set(meta.tags || []);
  showEditError("");
  updateEditPreview();
  $("#edit-dialog").showModal();
  const focus = add && !url ? $("#edit-url") : $("#edit-title");
  focus.focus();
  focus.select();
}

function updateEditPreview() {
  const u = BM.normalizeUrl($("#edit-url").value);
  $("#edit-favicon").src = BM.favicon(u || "", 32);
  $("#edit-domain").textContent = u ? BM.domain(u) || u : "Paste or type a link";
  renderEditQuickTags();
}

function renderEditQuickTags() {
  const u = BM.normalizeUrl($("#edit-url").value);
  const quick = u && editTags ? BM.suggestTags(u).filter((t) => !editTags.has(t)) : [];
  $("#edit-quick-tags").innerHTML = quick.map((t) => `<button type="button" class="quick-tag" data-quick-tag="${esc(t)}">+ ${esc(t)}</button>`).join("");
}

async function autofillTitle() {
  if (state.edit?.mode !== "add") return;
  const u = BM.normalizeUrl($("#edit-url").value);
  if (!u) return;
  const dupe = state.all.find((b) => dupKey(b.url) === dupKey(u));
  showEditError(dupe ? `Already saved in “${folderPathText(dupe.parentId)}”.` : "", true);
  const titleEl = $("#edit-title");
  if (titleEl.value.trim() || !BM.isWebUrl(u)) return;
  titleEl.placeholder = "Fetching title…";
  try {
    const m = await BM.fetchPageMeta(u);
    if (!titleEl.value.trim() && m.title && BM.normalizeUrl($("#edit-url").value) === u) titleEl.value = m.title;
  } catch (e) {}
  titleEl.placeholder = "Page title";
}

function showEditError(msg, soft = false) {
  const el = $("#edit-error");
  el.textContent = msg;
  el.hidden = !msg;
  el.style.color = soft ? "var(--amber)" : "";
}

async function submitEdit(e) {
  e.preventDefault();
  const url = BM.normalizeUrl($("#edit-url").value);
  if (!url) {
    showEditError("Please enter a valid link, e.g. example.com");
    return $("#edit-url").focus();
  }
  const title = $("#edit-title").value.trim() || url;
  const parentId = $("#edit-folder").value;
  const patch = { tags: editTags.get(), notes: $("#edit-notes").value.trim(), pinned: $("#edit-pin").checked };
  const adding = state.edit.mode === "add";
  try {
    let id;
    if (adding) {
      id = (await chrome.bookmarks.create({ parentId, title, url })).id;
      BM.rememberFolder(parentId);
    } else {
      id = state.edit.id;
      const bm = state.byId.get(id);
      if (!bm) throw new Error("This bookmark no longer exists.");
      if (bm.title !== title || bm.url !== url) await chrome.bookmarks.update(id, { title, url });
      if (bm.parentId !== parentId) await chrome.bookmarks.move(id, { parentId });
    }
    state.meta = await BM.updateMeta(id, patch);
    $("#edit-dialog").close();
    toast(adding ? "Bookmark added" : "Changes saved");
    refresh();
  } catch (err) {
    showEditError(err.message);
  }
}

async function dialogNewFolder() {
  const parentId = $("#edit-folder").value;
  const parent = state.byId.get(parentId);
  const name = await ask({ title: "New folder", message: parent ? `Inside “${parent.title}”` : "", input: true, placeholder: "Folder name", ok: "Create" });
  if (!name || !name.trim()) return;
  const f = await chrome.bookmarks.create({ parentId, title: name.trim() });
  await loadBookmarks();
  $("#edit-folder").innerHTML = BM.folderOptionsHTML(state.folders, f.id);
}

// ── Live updates (changes from the popup, Chrome's star, other tabs, sync) ──

function bindLiveUpdates() {
  const reload = BM.debounce(async () => {
    await loadBookmarks();
    if (!filterExists(state.filter)) state.filter = "all";
    refresh();
  }, 150);
  for (const ev of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
    chrome.bookmarks[ev]?.addListener(reload);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const m = changes[KEYS.META];
    if (m) {
      const next = m.newValue || {};
      if (JSON.stringify(next) !== JSON.stringify(state.meta)) {
        state.meta = next;
        reload();
      }
    }
    if (changes[KEYS.SETTINGS]) state.settings = changes[KEYS.SETTINGS].newValue || {};
  });
}

// ── Toast ──

let toastTimer = 0;
function toast(msg, { action, onAction, duration } = {}) {
  const t = $("#toast");
  $("#toast-msg").textContent = msg;
  const b = $("#toast-action");
  b.hidden = !action;
  b.textContent = action || "";
  b.onclick = action
    ? () => {
        t.classList.remove("active");
        onAction();
      }
    : null;
  t.classList.add("active");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("active"), duration || (action ? 6000 : 2200));
}
