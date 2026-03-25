// newtab.js — Bookmark Organizer Core v3.0

let state = {
  tree: [],
  all: [],
  folders: [],
  meta: {},
  broken: [],
  duplicates: [],
  filter: "all",
  view: "grid",
  search: "",
  collapsed: new Set(),
  currentEditId: null,
  tags: [],
};

// ── Initialization ──

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  await loadState();
  registerEvents();
  renderSidebar();
  renderMain();
  const params = new URLSearchParams(window.location.search);
  if (params.has("edit")) openEdit(params.get("edit"));
});

function initTheme() {
  if (localStorage.getItem("dark-mode") === "true")
    document.body.classList.add("dark");
  state.collapsed = new Set(
    JSON.parse(localStorage.getItem("bm-collapsed") || "[]"),
  );
}

async function loadState() {
  const raw = await new Promise((r) => chrome.bookmarks.getTree(r));
  state.tree = raw[0].children || [];
  state.all = flatten(state.tree);
  state.folders = getFolders(state.tree);

  state.meta =
    (await chrome.storage.local.get("bm_meta_v2"))["bm_meta_v2"] || {};
  state.view = localStorage.getItem("view-mode") || "grid";

  const tagSet = new Set();
  Object.values(state.meta).forEach((m) =>
    (m.tags || []).forEach((t) => tagSet.add(t)),
  );
  state.tags = Array.from(tagSet).sort();

  checkBrokenLinks();
  loadDuplicates();
}

// ── Duplicates ──

function loadDuplicates() {
  chrome.runtime.sendMessage({ action: "getDuplicates" }, (res) => {
    if (res && res.duplicates) {
      state.duplicates = res.duplicates;
      document.getElementById("count-dupes").textContent =
        res.duplicates.length;
      if (state.filter === "duplicates") renderMain();
    }
  });
}

// ── Rendering ──

function renderSidebar() {
  document.getElementById("count-all").textContent = state.all.length;
  document.getElementById("count-broken").textContent = state.broken.length;
  const fs = document.getElementById("folder-sidebar");
  fs.innerHTML = "";
  renderFolderNode(state.tree, fs, 0);

  const tagList = document.getElementById("tag-list");
  tagList.innerHTML = state.tags
    .slice(0, 10)
    .map(
      (t) =>
        `<button class="tag" style="padding: 2px 8px; cursor: pointer; border: none; font-size: 10px; border-radius: 4px; background: var(--surface-thick);" onclick="setFilter('tag:${t}')"># ${t}</button>`,
    )
    .join("");
  document.getElementById("tag-suggestions").innerHTML = state.tags
    .map((t) => `<option value="${t}">`)
    .join("");
}

function renderFolderNode(nodes, container, depth) {
  nodes
    .filter((n) => !n.url)
    .forEach((f) => {
      const isCollapsed = state.collapsed.has(f.id);
      const hasSub = f.children && f.children.some((c) => !c.url);
      const row = document.createElement("div");
      row.className = `folder-row ${state.filter === "folder:" + f.id ? "active" : ""}`;
      row.style.paddingLeft = depth * 10 + "px";
      row.draggable = true;
      row.innerHTML = `<div class="folder-arrow ${!isCollapsed ? "expanded" : ""}" style="visibility: ${hasSub ? "visible" : "hidden"}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div><div class="folder-content"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>${escapeHTML(f.title || "Folder")}</span></div>`;

      row.ondragstart = (e) => {
        e.dataTransfer.setData("sourceId", f.id);
        e.dataTransfer.setData("sourceType", "folder");
      };
      row.ondragover = (e) => {
        e.preventDefault();
        row.classList.add("drag-over");
      };
      row.ondragleave = () => row.classList.remove("drag-over");
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        handleDrop(e, f.id);
      };
      if (hasSub)
        row.querySelector(".folder-arrow").onclick = (e) => {
          e.stopPropagation();
          toggleFolder(f.id);
        };
      row.querySelector(".folder-content").onclick = () =>
        setFilter("folder:" + f.id);
      container.appendChild(row);
      if (hasSub) {
        const childContainer = document.createElement("div");
        childContainer.className = `folder-children ${!isCollapsed ? "visible" : ""}`;
        container.appendChild(childContainer);
        renderFolderNode(f.children, childContainer, depth + 1);
      }
    });
}

function renderMain() {
  const container = document.getElementById("content");
  container.innerHTML = "";

  // ── Special views ──
  if (state.filter === "insights") {
    container.className = "insights-view";
    container.style.display = "block";
    renderInsights(container);
    return;
  }
  if (state.filter === "duplicates") {
    container.className = "duplicates-view";
    container.style.display = "block";
    renderDuplicates(container);
    return;
  }

  // ── Normal views ──
  if (state.filter === "all" && !state.search) {
    container.className = "grouped-view";
    container.style.display = "block";
    renderGroupedView(container);
  } else if (state.filter.startsWith("folder:") && !state.search) {
    const id = state.filter.split(":")[1];
    const node = findNode(state.tree, id);
    container.className = "grouped-view";
    container.style.display = "block";
    renderGroup(container, node ? node.title : "Folder", getFilteredList(), id);
  } else {
    container.className = state.view;
    container.style.display = "grid";
    container.style.alignItems = "start";
    getFilteredList().forEach((bm) => container.appendChild(createCard(bm)));
  }
}

function renderGroupedView(container) {
  const pinned = state.all.filter((bm) => state.meta[bm.id]?.pinned);
  if (pinned.length > 0) renderGroup(container, "Pinned", pinned, "pinned");
  state.tree.forEach((node) => {
    if (!node.url) {
      const bms = flatten([node]);
      if (bms.length > 0) renderGroup(container, node.title, bms, node.id);
    }
  });
}

function renderGroup(container, title, bms, folderId) {
  const hdr = document.createElement("div");
  hdr.className = "group-header";
  hdr.innerHTML = `<div class="group-title">${escapeHTML(title)} <span style="opacity:0.3; font-size:12px;">${bms.length}</span></div><div style="display: flex; gap: 8px;"><button class="btn btn-export" style="padding: 4px 8px; font-size: 11px;">Export HTML</button><button class="btn btn-copy" style="padding: 4px 8px; font-size: 11px;">Copy Links</button></div>`;
  hdr.querySelector(".btn-export").onclick = () => exportToHTML(folderId);
  hdr.querySelector(".btn-copy").onclick = () => shareFolder(folderId);
  container.appendChild(hdr);

  const inner = document.createElement("div");
  inner.className = state.view;
  inner.style.display = "grid";
  inner.style.gap = state.view === "grid" ? "20px" : "8px";
  inner.style.gridTemplateColumns =
    state.view === "grid" ? "repeat(auto-fill, minmax(280px, 1fr))" : "1fr";
  inner.style.alignItems = "start";
  bms.forEach((bm) => inner.appendChild(createCard(bm)));
  container.appendChild(inner);
}

function createCard(bm) {
  const meta = state.meta[bm.id] || {};
  const isBroken = state.broken.includes(bm.id);
  const div = document.createElement("div");
  div.className = `card ${isBroken ? "broken" : ""}`;
  div.draggable = true;
  const domain = new URL(bm.url || "http://unknown").hostname.replace(
    "www.",
    "",
  );
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

  const tagsHTML = (meta.tags || [])
    .map((t) => `<span class="c-tag">#${escapeHTML(t)}</span>`)
    .join("");
  const notesSnippet = meta.notes
    ? `<div class="c-notes">${escapeHTML(meta.notes)}</div>`
    : "";

  // Wayback Machine button for broken links
  const waybackHTML = isBroken
    ? `<button class="wayback-btn" onclick="event.stopPropagation(); window.open('https://web.archive.org/web/*/${encodeURIComponent(bm.url)}', '_blank')">View Archived</button>`
    : "";

  div.innerHTML = `
    <div class="visual"><img class="lazy-thumb" data-url="${bm.url}" src="" alt=""><div class="favicon-overlay"><img src="${favicon}" alt=""></div></div>
    <div class="details">
        <div class="c-title-row">
            <div class="c-title">${escapeHTML(bm.title || bm.url)}</div>
            <div class="c-meta">${domain}</div>
        </div>
        <div class="c-tags-wrap">${tagsHTML}</div>
        ${notesSnippet}
        ${waybackHTML}
    </div>
    <div class="card-actions">
        <button class="action-circle btn-copy-one" title="Copy URL"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="action-circle btn-pin ${meta.pinned ? "active" : ""}" title="Pin/Unpin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></button>
        <button class="action-circle btn-edit" title="Edit Properties"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
    </div>`;

  div.ondragstart = (e) => {
    e.dataTransfer.setData("sourceId", bm.id);
    e.dataTransfer.setData("sourceType", "bookmark");
    div.classList.add("dragging");
  };
  div.ondragend = () => div.classList.remove("dragging");
  div.onclick = (e) => {
    if (e.target.closest(".action-circle") || e.target.closest(".wayback-btn")) return;
    window.open(bm.url, "_blank");
  };
  div.querySelector(".btn-pin").onclick = (e) => {
    e.stopPropagation();
    togglePin(bm.id);
  };
  div.querySelector(".btn-edit").onclick = (e) => {
    e.stopPropagation();
    openEdit(bm.id);
  };
  div.querySelector(".btn-copy-one").onclick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(bm.url);
    showToast("URL Copied.");
  };
  loadThumbnail(div.querySelector(".lazy-thumb"), bm.url);
  return div;
}

// ── Insights Dashboard ──

function renderInsights(container) {
  const total = state.all.length;
  const folderCount = state.folders.length;
  const tagCount = state.tags.length;
  const brokenCount = state.broken.length;
  const tagged = state.all.filter((bm) => (state.meta[bm.id]?.tags || []).length > 0).length;
  const untagged = total - tagged;

  // Domain distribution
  const domainMap = {};
  state.all.forEach((bm) => {
    try {
      const d = new URL(bm.url).hostname.replace("www.", "");
      domainMap[d] = (domainMap[d] || 0) + 1;
    } catch (e) {}
  });
  const topDomains = Object.entries(domainMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const maxDomain = topDomains.length ? topDomains[0][1] : 1;

  // Tag frequency
  const tagFreq = {};
  Object.values(state.meta).forEach((m) =>
    (m.tags || []).forEach((t) => {
      tagFreq[t] = (tagFreq[t] || 0) + 1;
    }),
  );
  const sortedTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]);

  // Stale bookmarks (oldest with no tags/notes)
  const stale = state.all
    .filter((bm) => {
      const m = state.meta[bm.id];
      return !m || ((!m.tags || m.tags.length === 0) && !m.notes);
    })
    .sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0))
    .slice(0, 8);

  container.innerHTML = `
    <div class="group-header" style="margin-top:0;"><div class="group-title">Insights</div></div>

    <div class="insights-grid">
      <div class="insight-card"><div class="insight-num">${total}</div><div class="insight-label">Total Bookmarks</div></div>
      <div class="insight-card"><div class="insight-num">${folderCount}</div><div class="insight-label">Folders</div></div>
      <div class="insight-card"><div class="insight-num">${tagCount}</div><div class="insight-label">Unique Tags</div></div>
      <div class="insight-card"><div class="insight-num">${brokenCount}</div><div class="insight-label" style="color:var(--red)">Broken Links</div></div>
      <div class="insight-card"><div class="insight-num">${tagged}</div><div class="insight-label" style="color:var(--green)">Tagged</div></div>
      <div class="insight-card"><div class="insight-num">${untagged}</div><div class="insight-label">Untagged</div></div>
    </div>

    <div class="insight-section">
      <div class="insight-section-title">Top Domains</div>
      ${topDomains
        .map(
          ([d, c]) =>
            `<div class="domain-bar-row"><div class="domain-bar-label">${escapeHTML(d)}</div><div class="domain-bar-track"><div class="domain-bar-fill" style="width:${Math.round((c / maxDomain) * 100)}%">${c}</div></div></div>`,
        )
        .join("")}
    </div>

    <div class="insight-section">
      <div class="insight-section-title">Tag Cloud</div>
      <div class="tag-cloud">
        ${sortedTags
          .map(
            ([t, c]) =>
              `<span class="tag-cloud-item" onclick="setFilter('tag:${t}')" style="font-size:${Math.min(10 + c * 2, 22)}px">#${escapeHTML(t)} <span style="opacity:0.5;font-size:10px">${c}</span></span>`,
          )
          .join("")}
        ${sortedTags.length === 0 ? '<span style="color:var(--ink-fade);font-size:13px">No tags yet. Tag your bookmarks to see them here.</span>' : ""}
      </div>
    </div>

    <div class="insight-section">
      <div class="insight-section-title">Needs Attention <span style="opacity:0.4;font-size:13px">(untagged, oldest first)</span></div>
      ${stale
        .map((bm) => {
          const d = new URL(bm.url || "http://x").hostname.replace("www.", "");
          const age = bm.dateAdded ? Math.floor((Date.now() - bm.dateAdded) / 86400000) : "?";
          return `<div class="dupe-item" style="cursor:pointer" onclick="openEdit('${bm.id}')"><div class="dupe-item-title">${escapeHTML(bm.title || bm.url)}</div><div class="dupe-item-folder">${d} · ${age}d old</div></div>`;
        })
        .join("")}
      ${stale.length === 0 ? '<span style="color:var(--ink-fade);font-size:13px">All bookmarks are tagged!</span>' : ""}
    </div>
  `;
}

// ── Duplicates View ──

function renderDuplicates(container) {
  if (state.duplicates.length === 0) {
    container.innerHTML = `
      <div class="group-header" style="margin-top:0;"><div class="group-title">Duplicates</div></div>
      <div style="text-align:center; padding:60px 0; color:var(--ink-dim);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
        <p style="margin-top:12px; font-size:15px;">No duplicate bookmarks found.</p>
      </div>`;
    return;
  }

  let html = `<div class="group-header" style="margin-top:0;"><div class="group-title">Duplicates <span style="opacity:0.3; font-size:12px;">${state.duplicates.length} groups</span></div></div>`;

  state.duplicates.forEach((group, gi) => {
    html += `<div class="dupe-group"><div class="dupe-url">${escapeHTML(group[0].url)}</div>`;
    group.forEach((bm, bi) => {
      const isKeep = bi === 0;
      html += `<div class="dupe-item">
        <div class="dupe-item-title">${escapeHTML(bm.title || bm.url)} ${isKeep ? '<span style="font-size:10px;color:var(--green);font-weight:700">KEEP</span>' : ""}</div>
        <div class="dupe-item-folder">ID: ${bm.id}</div>
        ${!isKeep ? `<button class="dupe-remove-btn" onclick="removeDuplicate('${bm.id}', ${gi})">Remove</button>` : ""}
      </div>`;
    });
    html += `</div>`;
  });

  container.innerHTML = html;
}

// ── Folder Actions ──

async function exportToHTML(id) {
  let nodes = [];
  if (id === "all") nodes = state.tree;
  else if (id === "pinned")
    nodes = state.all.filter((bm) => state.meta[bm.id]?.pinned);
  else nodes = await new Promise((r) => chrome.bookmarks.getSubTree(id, r));

  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><TITLE>Export</TITLE><H1>Bookmarks</H1><DL><p>\n`;
  const walk = (items, indent) => {
    items.forEach((n) => {
      const tabs = "    ".repeat(indent);
      if (n.url)
        html += `${tabs}<DT><A HREF="${n.url}">${escapeHTML(n.title)}</A>\n`;
      else {
        html += `${tabs}<DT><H3>${escapeHTML(n.title)}</H3>\n${tabs}<DL><p>\n`;
        walk(n.children || [], indent + 1);
        html += `${tabs}</DL><p>\n`;
      }
    });
  };
  walk(nodes, 1);
  html += `</DL><p>`;
  const blob = new Blob([html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "export.html";
  a.click();
  showToast("Exporting...");
}

async function shareFolder(id) {
  let list = [];
  if (id === "all") list = state.all;
  else if (id === "pinned")
    list = state.all.filter((bm) => state.meta[bm.id]?.pinned);
  else {
    const nodes = await new Promise((r) => chrome.bookmarks.getSubTree(id, r));
    list = flatten(nodes);
  }
  const links = list.map((b) => `${b.title}\n${b.url}`).join("\n\n");
  navigator.clipboard.writeText(links);
  showToast("Links copied to clipboard.");
}

// ── Internal Helpers ──

async function handleDrop(e, targetId) {
  if (targetId === "all") return;
  const sourceId = e.dataTransfer.getData("sourceId");
  try {
    await chrome.bookmarks.move(sourceId, { parentId: targetId });
    showToast(`Moved.`);
    await loadState();
    renderSidebar();
    renderMain();
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

async function createNewFolder() {
  const parentId = document.getElementById("edit-folder").value;
  const name = prompt("New Folder Name:");
  if (name) {
    const folder = await chrome.bookmarks.create({ parentId, title: name });
    await loadState();
    const fp = document.getElementById("edit-folder");
    fp.innerHTML = state.folders
      .map(
        (f) =>
          `<option value="${f.id}">${"&nbsp;".repeat(f.depth * 2)}${escapeHTML(f.title)}</option>`,
      )
      .join("");
    fp.value = folder.id;
    renderSidebar();
    showToast("Folder created.");
  }
}

function toggleFolder(id) {
  if (state.collapsed.has(id)) state.collapsed.delete(id);
  else state.collapsed.add(id);
  localStorage.setItem(
    "bm-collapsed",
    JSON.stringify(Array.from(state.collapsed)),
  );
  renderSidebar();
}

async function togglePin(id) {
  if (!state.meta[id]) state.meta[id] = {};
  state.meta[id].pinned = !state.meta[id].pinned;
  await chrome.storage.local.set({ bm_meta_v2: state.meta });
  renderMain();
}

async function handleEdit(e) {
  e.preventDefault();
  const id = state.currentEditId;
  const title = document.getElementById("edit-title").value;
  const url = document.getElementById("edit-url").value;
  const parentId = document.getElementById("edit-folder").value;
  const tags = document
    .getElementById("edit-tags")
    .value.split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t);
  const notes = document.getElementById("edit-notes").value;
  await chrome.bookmarks.update(id, { title, url });
  await chrome.bookmarks.move(id, { parentId });
  state.meta[id] = { ...state.meta[id], tags, notes };
  await chrome.storage.local.set({ bm_meta_v2: state.meta });
  showToast("Updated.");
  closeModal();
  await loadState();
  renderSidebar();
  renderMain();
}

async function removeDuplicate(id, groupIndex) {
  chrome.runtime.sendMessage({ action: "removeDuplicates", ids: [id] }, async () => {
    showToast("Removed duplicate.");
    await loadState();
    renderSidebar();
    renderMain();
  });
}

function getFilteredList() {
  let list = state.all;
  if (state.filter === "pinned")
    list = list.filter((bm) => state.meta[bm.id]?.pinned);
  else if (state.filter === "broken")
    list = list.filter((bm) => state.broken.includes(bm.id));
  else if (state.filter.startsWith("folder:")) {
    const id = state.filter.split(":")[1];
    const node = findNode(state.tree, id);
    list = node ? flatten([node]) : [];
  } else if (state.filter.startsWith("tag:")) {
    const t = state.filter.split(":")[1];
    list = list.filter((bm) => (state.meta[bm.id]?.tags || []).includes(t));
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(
      (bm) =>
        (bm.title || "").toLowerCase().includes(q) ||
        (bm.url || "").toLowerCase().includes(q) ||
        (state.meta[bm.id]?.tags || []).some((t) => t.includes(q)) ||
        (state.meta[bm.id]?.notes || "").toLowerCase().includes(q),
    );
  }
  return list;
}

function flatten(nodes) {
  let out = [];
  nodes.forEach((n) => {
    if (n.url) out.push(n);
    if (n.children) out = out.concat(flatten(n.children));
  });
  return out;
}

function getFolders(nodes) {
  let out = [];
  nodes
    .filter((n) => !n.url)
    .forEach((n) => {
      out.push({ id: n.id, title: n.title, depth: 0 });
      out = out.concat(getNestedFolders(n.children || [], 1));
    });
  return out;
}
function getNestedFolders(nodes, depth) {
  let out = [];
  nodes
    .filter((n) => !n.url)
    .forEach((n) => {
      out.push({ id: n.id, title: n.title, depth });
      out = out.concat(getNestedFolders(n.children || [], depth + 1));
    });
  return out;
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const res = findNode(n.children, id);
      if (res) return res;
    }
  }
  return null;
}

function registerEvents() {
  document.getElementById("search-input").oninput = (e) => {
    state.search = e.target.value;
    renderMain();
  };
  document.getElementById("nav-all").onclick = () => setFilter("all");
  document.getElementById("nav-pinned").onclick = () => setFilter("pinned");
  document.getElementById("nav-broken").onclick = () => setFilter("broken");
  document.getElementById("nav-duplicates").onclick = () => setFilter("duplicates");
  document.getElementById("nav-insights").onclick = () => setFilter("insights");
  document.getElementById("view-grid").onclick = () => setView("grid");
  document.getElementById("view-list").onclick = () => setView("list");
  document.getElementById("btn-dark-toggle").onclick = () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("dark-mode", document.body.classList.contains("dark"));
  };
  document.getElementById("btn-save-tabs").onclick = () => {
    const name = prompt("Folder name?");
    if (name)
      chrome.runtime.sendMessage({ action: "saveTabs", folderName: name }, () =>
        loadState().then(() => {
          renderSidebar();
          renderMain();
        }),
      );
  };
  document.getElementById("btn-export-all").onclick = () => exportToHTML("all");
  document.getElementById("modal-cancel").onclick = closeModal;
  document.getElementById("edit-form").onsubmit = handleEdit;
  document.getElementById("btn-new-folder").onclick = createNewFolder;
  document.getElementById("btn-delete").onclick = async () => {
    if (confirm("Remove?")) {
      await chrome.bookmarks.remove(state.currentEditId);
      closeModal();
      await loadState();
      renderSidebar();
      renderMain();
    }
  };
}

function setFilter(f) {
  state.filter = f;
  document
    .querySelectorAll(".nav-item, .folder-row")
    .forEach((el) => el.classList.remove("active"));
  const navEl = document.querySelector(`[data-id="${f}"], #nav-${f}`);
  if (navEl) navEl.classList.add("active");
  renderSidebar();
  renderMain();
}

function setView(v) {
  state.view = v;
  localStorage.setItem("view-mode", v);
  renderMain();
}

function openEdit(id) {
  const bm = state.all.find((x) => x.id === id);
  if (!bm) return;
  state.currentEditId = id;
  const m = state.meta[id] || {};
  document.getElementById("edit-title").value = bm.title;
  document.getElementById("edit-url").value = bm.url;
  document.getElementById("edit-tags").value = (m.tags || []).join(", ");
  document.getElementById("edit-notes").value = m.notes || "";
  const fp = document.getElementById("edit-folder");
  fp.innerHTML = state.folders
    .map(
      (f) =>
        `<option value="${f.id}">${"&nbsp;".repeat(f.depth * 2)}${escapeHTML(f.title)}</option>`,
    )
    .join("");
  fp.value = bm.parentId || "";
  document.getElementById("edit-modal").classList.add("active");
}

function closeModal() {
  document.getElementById("edit-modal").classList.remove("active");
}
function showToast(m) {
  const t = document.getElementById("toast");
  t.textContent = m;
  t.classList.add("active");
  setTimeout(() => t.classList.remove("active"), 2000);
}
function escapeHTML(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}

function loadThumbnail(img, url) {
  if (state.view === "list") return;
  chrome.runtime.sendMessage({ action: "fetchMetadata", url }, (res) => {
    if (res?.success && res.data?.ogImage) {
      img.src = res.data.ogImage;
      img.onload = () => img.classList.add("loaded");
    }
  });
}

function checkBrokenLinks() {
  state.all.forEach((bm) => {
    chrome.runtime.sendMessage(
      { action: "checkHealth", url: bm.url },
      (res) => {
        if (res?.status === "broken" && !state.broken.includes(bm.id)) {
          state.broken.push(bm.id);
          document.getElementById("count-broken").textContent =
            state.broken.length;
          renderMain();
        }
      },
    );
  });
}

window.setFilter = setFilter;
window.openEdit = openEdit;
window.removeDuplicate = removeDuplicate;
window.handleDragOver = (e) => e.preventDefault();
window.handleDrop = handleDrop;
