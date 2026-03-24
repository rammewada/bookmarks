// ─────────────────────────────────────────────────────────────
//  Bookmark Organizer — newtab.js  (complete rewrite)
// ─────────────────────────────────────────────────────────────

// ── State ────────────────────────────────────────────────────
let tree = []; // raw chrome.bookmarks tree children
let flatFolders = []; // [{id, title, parentId, children:[]}]
let activeFolderId = "all";
let viewMode = "grid"; // 'grid' | 'list'
let sortMode = "default";
let searchQuery = "";
let metaCache = {}; // url → {ogImage, favicon}

// ── Theme ─────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("bm-theme");
  if (saved === "dark") applyDark(true);
}

function applyDark(on) {
  document.body.classList.toggle("dark", on);
  // Toggle sun/moon icons
  const sun = document.getElementById("icon-sun");
  const moon = document.getElementById("icon-moon");
  if (sun) sun.style.display = on ? "block" : "none";
  if (moon) moon.style.display = on ? "none" : "block";
  localStorage.setItem("bm-theme", on ? "dark" : "light");
}

function toggleDark() {
  applyDark(!document.body.classList.contains("dark"));
}

function isDark() {
  return document.body.classList.contains("dark");
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadBookmarks();
  wireSidebar();
  // Dark mode toggle
  document
    .getElementById("btn-dark-toggle")
    .addEventListener("click", toggleDark);
});

async function loadBookmarks() {
  showState("loading");
  try {
    const raw = await new Promise((r) => chrome.bookmarks.getTree(r));
    tree = raw[0]?.children || [];
    flatFolders = [];
    collectFolders(tree, null);
    renderFilterBar();
    render();
  } catch (e) {
    console.error(e);
    showState("empty");
  }
}

// Flatten all folders into flatFolders[]
function collectFolders(nodes, parentId) {
  for (const n of nodes) {
    if (!n.url) {
      flatFolders.push({
        id: n.id,
        title: n.title,
        parentId,
        children: n.children || [],
      });
      collectFolders(n.children || [], n.id);
    }
  }
}

// ── Event wiring ─────────────────────────────────────────────
function wireSidebar() {
  // Search
  const inp = document.getElementById("search-input");
  const clear = document.getElementById("search-clear");
  inp.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
  });
  clear.addEventListener("click", () => {
    inp.value = "";
    searchQuery = "";
    render();
  });

  // View toggle
  document
    .getElementById("btn-view-grid")
    .addEventListener("click", () => setView("grid"));
  document
    .getElementById("btn-view-list")
    .addEventListener("click", () => setView("list"));

  // Sort
  document.getElementById("sort-sel").addEventListener("change", (e) => {
    sortMode = e.target.value;
    render();
  });

  // Share modal close
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("share-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Modal copy url
  document.getElementById("modal-copy-url").addEventListener("click", () => {
    const v = document.getElementById("modal-url-input").value;
    navigator.clipboard.writeText(v);
    showToast("URL copied!");
  });

  // Modal copy folder
  document.getElementById("modal-copy-folder").addEventListener("click", () => {
    const v = document.getElementById("modal-folder-text").value;
    navigator.clipboard.writeText(v);
    showToast("All links copied!");
  });

  // Modal share folder email
  document
    .getElementById("modal-share-folder-email")
    .addEventListener("click", () => {
      const subject = document.getElementById("modal-title").textContent;
      const body = document.getElementById("modal-folder-text").value;
      window.open(
        `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      );
    });
}

function setView(v) {
  viewMode = v;
  const g = document.getElementById("btn-view-grid");
  const l = document.getElementById("btn-view-list");
  if (v === "grid") {
    g.style.background = "white";
    g.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
    l.style.background = "transparent";
    l.style.boxShadow = "none";
    g.querySelector("svg rect, g rect").setAttribute && null;
    // update icon colors
    g.querySelectorAll("rect").forEach((r) =>
      r.setAttribute("fill", "var(--ink-2)"),
    );
    l.querySelectorAll("path").forEach((p) =>
      p.setAttribute("stroke", "var(--ink-4)"),
    );
  } else {
    l.style.background = "white";
    l.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
    g.style.background = "transparent";
    g.style.boxShadow = "none";
    l.querySelectorAll("path").forEach((p) =>
      p.setAttribute("stroke", "var(--ink-2)"),
    );
    g.querySelectorAll("rect").forEach((r) =>
      r.setAttribute("fill", "var(--ink-4)"),
    );
  }
  render();
}

// ── Filter bar (folder chips) ─────────────────────────────────
function renderFilterBar() {
  const bar = document.getElementById("filter-bar");
  bar.innerHTML = "";

  // "All" chip
  bar.appendChild(makeChip("all", "All", totalBookmarkCount(tree)));

  // Top-level folders only
  const topFolders = tree.filter((n) => !n.url);
  topFolders.forEach((f) => {
    const count = countBookmarks(f.children || []);
    bar.appendChild(makeChip(f.id, f.title, count));
  });
}

function makeChip(id, title, count) {
  const btn = document.createElement("button");
  btn.className = "folder-chip" + (id === activeFolderId ? " active" : "");
  btn.dataset.id = id;
  btn.innerHTML = `${esc(title)} <span class="chip-count">${count}</span>`;
  btn.addEventListener("click", () => {
    activeFolderId = id;
    searchQuery = "";
    document.getElementById("search-input").value = "";
    document
      .querySelectorAll(".folder-chip")
      .forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
  return btn;
}

// ── Main render ───────────────────────────────────────────────
function render() {
  const content = document.getElementById("content");
  content.innerHTML = "";

  if (searchQuery) {
    renderSearchResults(content);
    return;
  }

  if (activeFolderId === "all") {
    renderAllGrouped(content);
  } else {
    renderSingleFolder(content);
  }
}

// Default: all bookmarks grouped by folder label
function renderAllGrouped(content) {
  const topFolders = tree.filter((n) => !n.url);
  const rootBookmarks = tree.filter((n) => !!n.url);

  let totalShown = 0;

  // Root-level bookmarks (no folder)
  if (rootBookmarks.length > 0) {
    const sect = buildSection(null, "Unsorted", rootBookmarks);
    if (sect) {
      content.appendChild(sect);
      totalShown += rootBookmarks.length;
    }
  }

  // Each top-level folder
  topFolders.forEach((folder, i) => {
    const bms = getAllBookmarks(folder.children || []);
    if (bms.length === 0) return;
    const sorted = applySort(bms);
    const sect = buildSection(folder, folder.title, sorted, i);
    if (sect) {
      content.appendChild(sect);
      totalShown += sorted.length;
    }
  });

  if (totalShown === 0) {
    showState("empty");
    return;
  }
  showState("content");
  updateHeaderCount(totalShown);

  // Progressive metadata fetch
  setTimeout(() => fetchMetaForVisible(), 300);
}

// Single folder: shows a page header with share button, then subfolders + bookmarks
function renderSingleFolder(content) {
  const node = findNode(tree, activeFolderId);
  if (!node) {
    showState("empty");
    return;
  }

  const direct = node.children || [];
  const subfolders = direct.filter((n) => !n.url);
  const allBmsInFolder = getAllBookmarks(direct); // ALL bookmarks incl. nested
  const bms = applySort(direct.filter((n) => !!n.url));

  if (subfolders.length === 0 && allBmsInFolder.length === 0) {
    showState("empty");
    return;
  }
  showState("content");

  // ── Folder page header with share button ──
  const color = folderColor(node.title);
  const pageHdr = document.createElement("div");
  pageHdr.className = "section-header fade-up";
  pageHdr.style.marginBottom = "32px";
  pageHdr.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;">
      <div style="width:40px;height:40px;border-radius:10px;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
          <path d="M1 3.5h12v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" fill="${color.bg}" stroke="${color.icon}" stroke-width="1.2"/>
          <path d="M1 3.5V3a1 1 0 011-1h3l1.5 1.5H13" stroke="${color.icon}" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <h1 class="font-serif" style="font-size:22px;color:var(--ink);letter-spacing:-0.02em;line-height:1.1;">${esc(node.title)}</h1>
        <div class="label" style="margin-top:4px;">${allBmsInFolder.length} bookmark${allBmsInFolder.length !== 1 ? "s" : ""}${subfolders.length > 0 ? ` · ${subfolders.length} subfolder${subfolders.length !== 1 ? "s" : ""}` : ""}</div>
      </div>
    </div>
    <button id="folder-share-btn"
      style="display:flex;align-items:center;gap:7px;padding:9px 16px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);font-family:'Geist',sans-serif;font-size:13px;font-weight:500;color:var(--ink-3);cursor:pointer;transition:background 0.12s,border-color 0.12s;flex-shrink:0;">
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
        <circle cx="10" cy="2" r="1.5" stroke="currentColor" stroke-width="1.1"/>
        <circle cx="2" cy="6" r="1.5" stroke="currentColor" stroke-width="1.1"/>
        <circle cx="10" cy="10" r="1.5" stroke="currentColor" stroke-width="1.1"/>
        <path d="M3.4 6.7L8.6 9.3M8.6 2.7L3.4 5.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      </svg>
      Share folder
    </button>
  `;
  content.appendChild(pageHdr);

  // Wire share button
  pageHdr.querySelector("#folder-share-btn").addEventListener("click", () => {
    openFolderShareModal(node, allBmsInFolder);
  });
  pageHdr
    .querySelector("#folder-share-btn")
    .addEventListener("mouseover", function () {
      this.style.background = "var(--surface-3)";
      this.style.borderColor = "var(--border-strong)";
    });
  pageHdr
    .querySelector("#folder-share-btn")
    .addEventListener("mouseout", function () {
      this.style.background = "var(--surface-2)";
      this.style.borderColor = "var(--border)";
    });

  // Subfolder grid
  if (subfolders.length > 0) {
    const sfLabel = document.createElement("div");
    sfLabel.className = "label fade-up";
    sfLabel.style.marginBottom = "12px";
    sfLabel.textContent = "Subfolders";
    content.appendChild(sfLabel);

    const sfGrid = document.createElement("div");
    sfGrid.style.cssText =
      "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:40px;";
    subfolders.forEach((sf, i) => {
      sfGrid.appendChild(buildSubfolderCard(sf, i));
    });
    content.appendChild(sfGrid);
  }

  if (bms.length > 0) {
    const bmLabel = document.createElement("div");
    bmLabel.className = "label fade-up";
    bmLabel.style.marginBottom = "14px";
    bmLabel.textContent = `${bms.length} bookmark${bms.length !== 1 ? "s" : ""} in this folder`;
    content.appendChild(bmLabel);
    content.appendChild(makeGrid(bms));
  }

  updateHeaderCount(allBmsInFolder.length);
  setTimeout(() => fetchMetaForVisible(), 200);
}

// Search: flat results across everything
function renderSearchResults(content) {
  const results = searchAll(tree, searchQuery);
  if (results.length === 0) {
    showState("empty");
    return;
  }
  showState("content");
  updateHeaderCount(results.length);

  const label = document.createElement("div");
  label.className = "label fade-up";
  label.style.marginBottom = "20px";
  label.textContent = `${results.length} result${results.length !== 1 ? "s" : ""} for "${searchQuery}"`;
  content.appendChild(label);

  const grid = makeGrid(results);
  content.appendChild(grid);
  setTimeout(() => fetchMetaForVisible(), 300);
}

// ── Section builder ───────────────────────────────────────────
function buildSection(folder, title, bookmarks, idx = 0) {
  if (bookmarks.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "bm-section";
  wrap.style.cssText = `margin-bottom:52px;animation-delay:${idx * 60}ms;`;

  // Section header
  const hdr = document.createElement("div");
  hdr.className = "section-header";

  // Left: folder name + count
  const left = document.createElement("div");
  left.style.cssText = "display:flex;align-items:center;gap:14px;";

  const folderBtn = document.createElement("button");
  folderBtn.className = "section-folder-btn";

  // Folder icon with color
  const color = folderColor(title);
  folderBtn.innerHTML = `
    <div style="width:32px;height:32px;border-radius:8px;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 3.5h12v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" fill="${color.bg}" stroke="${color.icon}" stroke-width="1.2"/>
        <path d="M1 3.5V3a1 1 0 011-1h3l1.5 1.5H13" stroke="${color.icon}" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </div>
    <span class="font-serif" style="font-size:19px;color:var(--ink);letter-spacing:-0.01em;">${esc(title)}</span>
    <span class="label">${bookmarks.length} bookmark${bookmarks.length !== 1 ? "s" : ""}</span>
  `;

  if (folder) {
    folderBtn.title = "View only this folder";
    folderBtn.addEventListener("click", () => {
      activeFolderId = folder.id;
      // Mark chip active if top-level
      document.querySelectorAll(".folder-chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.id === folder.id);
      });
      render();
    });
  }

  left.appendChild(folderBtn);
  hdr.appendChild(left);

  // Right: Share folder button
  if (folder) {
    const shareBtn = document.createElement("button");
    shareBtn.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-family:"Geist",sans-serif;font-size:12.5px;font-weight:500;color:var(--ink-3);cursor:pointer;transition:background 0.12s,border-color 0.12s;';
    shareBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="10" cy="2" r="1.5" stroke="currentColor" stroke-width="1.1"/>
        <circle cx="2" cy="6" r="1.5" stroke="currentColor" stroke-width="1.1"/>
        <circle cx="10" cy="10" r="1.5" stroke="currentColor" stroke-width="1.1"/>
        <path d="M3.4 6.7L8.6 9.3M8.6 2.7L3.4 5.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      </svg>
      Share folder
    `;
    shareBtn.addEventListener("mouseover", () => {
      shareBtn.style.background = "var(--surface-3)";
      shareBtn.style.borderColor = "var(--border-strong)";
    });
    shareBtn.addEventListener("mouseout", () => {
      shareBtn.style.background = "var(--surface-2)";
      shareBtn.style.borderColor = "var(--border)";
    });
    shareBtn.addEventListener("click", () =>
      openFolderShareModal(folder, bookmarks),
    );
    hdr.appendChild(shareBtn);
  }

  wrap.appendChild(hdr);
  wrap.appendChild(makeGrid(bookmarks));
  return wrap;
}

// ── Grid / List builder ───────────────────────────────────────
function makeGrid(bookmarks) {
  const grid = document.createElement("div");
  if (viewMode === "grid") {
    grid.className = "bm-grid";
    bookmarks.forEach((bm, i) => {
      const card = buildGridCard(bm, i);
      grid.appendChild(card);
    });
  } else {
    grid.style.cssText = "display:flex;flex-direction:column;gap:8px;";
    bookmarks.forEach((bm, i) => {
      grid.appendChild(buildListCard(bm, i));
    });
  }
  return grid;
}

// ── Grid card ─────────────────────────────────────────────────
function buildGridCard(bm, idx) {
  const domain = getDomain(bm.url);
  const color = domainColor(domain);
  const faviconSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  const title = searchQuery
    ? highlight(bm.title || bm.url)
    : esc(bm.title || bm.url);

  const card = document.createElement("div");
  card.className = "bm-card fade-up";
  card.style.animationDelay = `${Math.min(idx * 18, 300)}ms`;
  card.dataset.url = bm.url;
  card.dataset.bmId = bm.id;

  card.innerHTML = `
    <!-- Visual header: gradient bg + favicon -->
    <div class="card-visual">
      <div class="card-visual-bg" style="background:${color.bg};">
        <div class="card-favicon">
          <img src="${faviconSrc}" alt="" loading="lazy"
            onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22><rect width=%2220%22 height=%2220%22 rx=%224%22 fill=%22${encodeURIComponent(color.icon)}22%22/><text x=%2210%22 y=%2214%22 text-anchor=%22middle%22 font-size=%2212%22 font-family=%22sans-serif%22 fill=%22${encodeURIComponent(color.icon)}%22>${domain.charAt(0).toUpperCase()}</text></svg>'" />
        </div>
      </div>
      <!-- OG image overlaid, hidden until loaded -->
      <img class="og-img" data-url="${esc(bm.url)}" alt="" />
    </div>

    <!-- Body -->
    <div class="card-body">
      <div class="card-title">${title}</div>
      <div class="card-domain">${domain}</div>
    </div>

    <!-- Actions -->
    <div class="card-actions">
      <button class="action-btn btn-open" data-url="${esc(bm.url)}" title="Open in new tab">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M6 1h4v4M10 1L5 6M1 5v5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Open
      </button>
      <button class="action-btn btn-share" data-url="${esc(bm.url)}" data-title="${esc(bm.title || bm.url)}" title="Share">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <circle cx="9" cy="2" r="1.5" stroke="currentColor" stroke-width="1.1"/>
          <circle cx="2" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1.1"/>
          <circle cx="9" cy="9" r="1.5" stroke="currentColor" stroke-width="1.1"/>
          <path d="M3.4 6.2L7.6 8.3M7.6 2.7L3.4 4.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
        Share
      </button>
      <button class="action-btn btn-copy" data-url="${esc(bm.url)}" title="Copy URL" style="flex:0;padding:6px 10px;">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" stroke-width="1.1"/>
          <path d="M2 8V2a.5.5 0 01.5-.5H8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  // Click card → open
  card.addEventListener("click", (e) => {
    if (e.target.closest(".action-btn")) return;
    window.open(bm.url, "_blank");
  });

  card.querySelectorAll(".btn-open").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(b.dataset.url, "_blank");
    }),
  );
  card.querySelectorAll(".btn-share").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openBmShareModal(b.dataset.url, b.dataset.title);
    }),
  );
  card.querySelectorAll(".btn-copy").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(b.dataset.url);
      showToast("Copied!");
    }),
  );

  return card;
}

// ── List card ─────────────────────────────────────────────────
function buildListCard(bm, idx) {
  const domain = getDomain(bm.url);
  const color = domainColor(domain);
  const faviconSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  const title = searchQuery
    ? highlight(bm.title || bm.url)
    : esc(bm.title || bm.url);

  const card = document.createElement("div");
  card.className = "bm-card-list fade-up";
  card.style.animationDelay = `${Math.min(idx * 12, 200)}ms`;

  card.innerHTML = `
    <div class="list-favicon-box" style="background:${color.bg};border-color:${color.border}">
      <img src="${faviconSrc}" alt="" loading="lazy"
        onerror="this.outerHTML='<span style=\\'font-size:16px;font-family:sans-serif;color:${color.icon};\\'>${domain.charAt(0).toUpperCase()}</span>'" />
    </div>
    <div class="list-info">
      <div class="list-title">${title}</div>
      <div class="list-domain">${domain}</div>
    </div>
    <div class="list-actions">
      <button class="list-action-btn btn-open" data-url="${esc(bm.url)}">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M6 1h4v4M10 1L5 6M1 5v5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Open
      </button>
      <button class="list-action-btn btn-share" data-url="${esc(bm.url)}" data-title="${esc(bm.title || bm.url)}">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <circle cx="9" cy="2" r="1.5" stroke="currentColor" stroke-width="1.1"/>
          <circle cx="2" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1.1"/>
          <circle cx="9" cy="9" r="1.5" stroke="currentColor" stroke-width="1.1"/>
          <path d="M3.4 6.2L7.6 8.3M7.6 2.7L3.4 4.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
        Share
      </button>
      <button class="list-action-btn btn-copy" data-url="${esc(bm.url)}" title="Copy URL">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" stroke-width="1.1"/>
          <path d="M2 8V2a.5.5 0 01.5-.5H8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  card.addEventListener("click", (e) => {
    if (e.target.closest(".list-action-btn")) return;
    window.open(bm.url, "_blank");
  });
  card.querySelectorAll(".btn-open").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(b.dataset.url, "_blank");
    }),
  );
  card.querySelectorAll(".btn-share").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openBmShareModal(b.dataset.url, b.dataset.title);
    }),
  );
  card.querySelectorAll(".btn-copy").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(b.dataset.url);
      showToast("Copied!");
    }),
  );

  return card;
}

// ── Subfolder card ────────────────────────────────────────────
function buildSubfolderCard(folder, idx) {
  const count = countBookmarks(folder.children || []);
  const color = folderColor(folder.title);

  const card = document.createElement("button");
  card.className = "fade-up";
  card.style.cssText = `
    display:flex;flex-direction:column;align-items:flex-start;gap:10px;
    padding:14px;border-radius:12px;border:1px solid var(--border);
    background:white;cursor:pointer;text-align:left;width:100%;
    transition:transform 0.15s,box-shadow 0.15s,border-color 0.15s;
    animation-delay:${idx * 30}ms;
  `;
  card.innerHTML = `
    <div style="width:34px;height:34px;border-radius:8px;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 3.5h12v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" fill="${color.bg}" stroke="${color.icon}" stroke-width="1.2"/>
        <path d="M1 3.5V3a1 1 0 011-1h3l1.5 1.5H13" stroke="${color.icon}" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </div>
    <div>
      <div style="font-size:12.5px;font-weight:500;color:var(--ink);margin-bottom:2px;">${esc(folder.title)}</div>
      <div class="label">${count} item${count !== 1 ? "s" : ""}</div>
    </div>
  `;
  card.addEventListener("mouseover", () => {
    card.style.transform = "translateY(-2px)";
    card.style.boxShadow = "0 6px 20px rgba(0,0,0,0.07)";
    card.style.borderColor = "var(--border-strong)";
  });
  card.addEventListener("mouseout", () => {
    card.style.transform = "";
    card.style.boxShadow = "";
    card.style.borderColor = "var(--border)";
  });
  card.addEventListener("click", () => {
    activeFolderId = folder.id;
    render();
    // Update chip if it's a top-level folder
    document.querySelectorAll(".folder-chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.id === folder.id);
    });
  });
  return card;
}

// ── Metadata (OG images) ──────────────────────────────────────
// Fetch first 12 in parallel, then rest sequentially
async function fetchMetaForVisible() {
  const imgs = [...document.querySelectorAll("img.og-img[data-url]")];
  if (imgs.length === 0) return;

  // Split: first 12 fetched in parallel, rest sequentially
  const eager = imgs.slice(0, 12);
  const lazy = imgs.slice(12);

  // Parallel batch for above-fold cards
  await Promise.all(eager.map((img) => fetchOneOg(img)));

  // Sequential for the rest (to avoid overwhelming)
  for (const img of lazy) {
    await fetchOneOg(img);
    await sleep(30);
  }
}

async function fetchOneOg(img) {
  const url = img.dataset.url;
  if (!url || !url.startsWith("http") || !img.isConnected) {
    img.remove();
    return;
  }
  if (metaCache[url]) {
    applyOg(img, metaCache[url]);
    return;
  }
  try {
    const res = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ action: "fetchMetadata", url }, resolve),
    );
    if (res?.success && res.data?.ogImage) {
      metaCache[url] = res.data;
      applyOg(img, res.data);
    } else {
      img.remove();
    }
  } catch {
    img.remove();
  }
}

function applyOg(img, data) {
  if (!data?.ogImage || !img.isConnected) return;
  img.src = data.ogImage;
  img.onload = () => img.classList.add("loaded");
  img.onerror = () => img.remove();
}

// ── Share modals ──────────────────────────────────────────────
function openBmShareModal(url, title) {
  document.getElementById("modal-title").textContent = "Share Bookmark";
  document.getElementById("modal-subtitle").textContent = getDomain(url);
  document.getElementById("modal-bm-title").textContent = title;
  document.getElementById("modal-bm-url").textContent = url;
  document.getElementById("modal-url-input").value = url;

  document.getElementById("modal-single").style.display = "block";
  document.getElementById("modal-folder").style.display = "none";

  // Render platform share buttons
  const platforms = document.getElementById("share-platforms");
  platforms.innerHTML = "";
  const list = [
    { id: "twitter", label: "𝕏 Twitter", bg: "#eaf0f8", color: "#1a3d6b" },
    { id: "linkedin", label: "LinkedIn", bg: "#eaf0f8", color: "#1a3d6b" },
    { id: "whatsapp", label: "WhatsApp", bg: "#edf5f0", color: "#1a6b3c" },
    { id: "email", label: "Email", bg: "#f2f1ee", color: "#3a3a3a" },
  ];
  list.forEach((p) => {
    const btn = document.createElement("button");
    btn.style.cssText = `margin-top:4px;padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:${p.bg};color:${p.color};font-family:'Geist',sans-serif;font-size:12.5px;font-weight:500;cursor:pointer;transition:opacity 0.12s;`;
    btn.textContent = p.label;
    btn.addEventListener("click", () => sharePlatform(p.id, url, title));
    platforms.appendChild(btn);
  });

  openModal();
}

function openFolderShareModal(folder, bookmarks) {
  document.getElementById("modal-title").textContent =
    `Share "${folder.title}"`;
  document.getElementById("modal-subtitle").textContent =
    `${bookmarks.length} bookmarks`;

  document.getElementById("modal-single").style.display = "none";
  document.getElementById("modal-folder").style.display = "block";

  const text = bookmarks
    .map((bm) => `${bm.title || bm.url}\n${bm.url}`)
    .join("\n\n");
  document.getElementById("modal-folder-text").value = text;

  // Dynamic textarea height
  const ta = document.getElementById("modal-folder-text");
  ta.style.height = Math.min(bookmarks.length * 48, 280) + "px";

  openModal();
}

function sharePlatform(platform, url, title) {
  const eu = encodeURIComponent(url);
  const et = encodeURIComponent(title);
  const map = {
    twitter: `https://twitter.com/intent/tweet?url=${eu}&text=${et}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${eu}`,
    whatsapp: `https://wa.me/?text=${et}%20${eu}`,
    email: `mailto:?subject=${et}&body=${eu}`,
  };
  if (map[platform]) window.open(map[platform], "_blank");
  closeModal();
}

function openModal() {
  document.getElementById("share-modal").classList.add("open");
}
function closeModal() {
  document.getElementById("share-modal").classList.remove("open");
}

// ── Helpers ───────────────────────────────────────────────────
function getAllBookmarks(nodes) {
  const result = [];
  for (const n of nodes) {
    if (n.url) result.push(n);
    else result.push(...getAllBookmarks(n.children || []));
  }
  return result;
}

function countBookmarks(nodes) {
  let c = 0;
  for (const n of nodes) {
    if (n.url) c++;
    else c += countBookmarks(n.children || []);
  }
  return c;
}

function totalBookmarkCount(nodes) {
  return countBookmarks(nodes);
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

function searchAll(nodes, q) {
  const res = [];
  const go = (list) => {
    for (const n of list) {
      if (n.url) {
        if (
          (n.title || "").toLowerCase().includes(q) ||
          (n.url || "").toLowerCase().includes(q)
        )
          res.push(n);
      } else go(n.children || []);
    }
  };
  go(nodes);
  return res;
}

function applySort(list) {
  if (sortMode === "az")
    return [...list].sort((a, b) =>
      (a.title || "").localeCompare(b.title || ""),
    );
  if (sortMode === "za")
    return [...list].sort((a, b) =>
      (b.title || "").localeCompare(a.title || ""),
    );
  return list;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(text) {
  const safe = esc(text);
  const re = new RegExp(
    `(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return safe.replace(re, "<mark>$1</mark>");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Color helpers ─────────────────────────────────────────────
// Dark-mode aware palettes
const FOLDER_PALETTES_LIGHT = [
  { bg: "#edf5f0", border: "#c8e4d8", icon: "#1a6b3c" },
  { bg: "#eaf0f8", border: "#c2d5ec", icon: "#1a3d6b" },
  { bg: "#f0eaf8", border: "#d0c2ec", icon: "#3d1a6b" },
  { bg: "#fdf4e7", border: "#ecd8b0", icon: "#7a4f0d" },
  { bg: "#faeaea", border: "#ecc2c2", icon: "#6b1a1a" },
  { bg: "#f0f8ea", border: "#c8e4b0", icon: "#2d6b1a" },
];
const FOLDER_PALETTES_DARK = [
  { bg: "#1a2e22", border: "#2a4a34", icon: "#5fba88" },
  { bg: "#1a2236", border: "#2a3a54", icon: "#5f8aba" },
  { bg: "#261a36", border: "#3a2a54", icon: "#9f6aba" },
  { bg: "#2e2210", border: "#4a3618", icon: "#ba9a5f" },
  { bg: "#2e1a1a", border: "#4a2a2a", icon: "#ba6060" },
  { bg: "#1e2e14", border: "#2e4a1c", icon: "#7aba5f" },
];

function folderColor(title) {
  let h = 0;
  for (let i = 0; i < (title || "").length; i++)
    h = (h * 31 + title.charCodeAt(i)) & 0xffffffff;
  const palette = isDark() ? FOLDER_PALETTES_DARK : FOLDER_PALETTES_LIGHT;
  return palette[Math.abs(h) % palette.length];
}

function domainColor(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i++)
    h = (h * 31 + domain.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(h) % 360;
  if (isDark()) {
    return {
      bg: `hsl(${hue}, 30%, 16%)`,
      border: `hsl(${hue}, 25%, 24%)`,
      icon: `hsl(${hue}, 55%, 65%)`,
    };
  }
  return {
    bg: `hsl(${hue}, 40%, 94%)`,
    border: `hsl(${hue}, 30%, 82%)`,
    icon: `hsl(${hue}, 50%, 38%)`,
  };
}

// ── UI state ──────────────────────────────────────────────────
function showState(state) {
  document.getElementById("state-loading").style.display =
    state === "loading" ? "flex" : "none";
  document.getElementById("state-empty").style.display =
    state === "empty" ? "flex" : "none";
  document.getElementById("content").style.display =
    state === "content" ? "block" : "none";
}

function updateHeaderCount(n) {
  document.getElementById("header-count").textContent =
    `${n} bookmark${n !== 1 ? "s" : ""}`;
}

// ── Toast ─────────────────────────────────────────────────────
let toastTmr;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => t.classList.remove("show"), 2200);
}
