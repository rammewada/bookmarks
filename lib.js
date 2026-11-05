// lib.js — shared helpers for the popup, the library page and the service worker.
// Loaded via <script> in pages and importScripts() in background.js.

(function (global) {
  "use strict";

  const KEYS = {
    META: "bm_meta_v2", // per-bookmark user data: { tags, notes, pinned, remindAt }
    PAGE: "bm_metadata_v2", // page metadata cache keyed by URL: { ogImage, title, description, fetchedAt }
    HEALTH: "bm_health_v3", // link health cache keyed by URL: { status, checkedAt, dismissed? }  (v2 had false positives)
    SETTINGS: "bm_settings_v1", // { lastFolderId, recentFolders, lastScan }
  };

  const ROOT_IDS = new Set(["0", "1", "2", "3"]);
  const PAGE_TTL = 7 * 24 * 60 * 60 * 1000;

  // ── Storage ──

  async function read(key, fallback = {}) {
    const res = await chrome.storage.local.get(key);
    return res[key] ?? fallback;
  }

  async function write(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  function isEmptyMeta(m) {
    return !m || (!m.pinned && !(m.tags || []).length && !m.notes && !m.remindAt);
  }

  /** Merge `patch` into one bookmark's metadata (null removes it). Returns the full meta map. */
  async function updateMeta(id, patch) {
    return patchMetaMany({ [id]: patch });
  }

  /** Apply several patches in one read-modify-write. */
  async function patchMetaMany(patches) {
    const meta = await read(KEYS.META);
    for (const [id, patch] of Object.entries(patches)) {
      if (patch === null) {
        delete meta[id];
        continue;
      }
      const next = { ...(meta[id] || {}), ...patch };
      if (next.tags) next.tags = normalizeTags(next.tags);
      delete next.pinnedAt; // legacy field
      if (isEmptyMeta(next)) delete meta[id];
      else meta[id] = next;
    }
    await write(KEYS.META, meta);
    return meta;
  }

  async function getSettings() {
    return read(KEYS.SETTINGS);
  }

  async function setSettings(patch) {
    const s = await getSettings();
    const next = { ...s, ...patch };
    await write(KEYS.SETTINGS, next);
    return next;
  }

  /** Remember the folder the user last saved into (like Chrome's star bubble does). */
  async function rememberFolder(id) {
    const s = await getSettings();
    const recent = [id, ...(s.recentFolders || []).filter((f) => f !== id)].slice(0, 4);
    return setSettings({ lastFolderId: id, recentFolders: recent });
  }

  /** Returns `id` if it is still an existing folder, else the Bookmarks Bar. */
  async function validFolder(id) {
    if (id && id !== "0") {
      try {
        const [n] = await chrome.bookmarks.get(id);
        if (n && !n.url) return n.id;
      } catch (e) {}
    }
    return "1";
  }

  // ── Tags ──

  function normalizeTags(input) {
    const list = Array.isArray(input) ? input : String(input || "").split(",");
    const out = [];
    for (const raw of list) {
      const t = String(raw)
        .trim()
        .toLowerCase()
        .replace(/^#+/, "")
        .replace(/\s+/g, "-");
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  const DOMAIN_TAGS = {
    "github.com": ["dev", "code"], "gitlab.com": ["dev", "code"], "bitbucket.org": ["dev", "code"],
    "stackoverflow.com": ["dev", "qa"], "stackexchange.com": ["dev", "qa"],
    "youtube.com": ["video"], "youtu.be": ["video"], "vimeo.com": ["video"], "twitch.tv": ["video", "gaming"],
    "medium.com": ["article", "blog"], "dev.to": ["dev", "article"], "hashnode.com": ["dev", "blog"], "substack.com": ["article", "newsletter"],
    "twitter.com": ["social"], "x.com": ["social"], "reddit.com": ["social", "forum"], "linkedin.com": ["career", "social"],
    "amazon.com": ["shopping"], "amazon.in": ["shopping"], "ebay.com": ["shopping"], "flipkart.com": ["shopping"],
    "wikipedia.org": ["reference", "wiki"],
    "docs.google.com": ["docs"], "drive.google.com": ["docs"], "notion.so": ["productivity", "docs"],
    "figma.com": ["design"], "dribbble.com": ["design"], "behance.net": ["design"], "canva.com": ["design"],
    "npmjs.com": ["dev", "package"], "pypi.org": ["dev", "package"],
    "arxiv.org": ["research", "paper"], "scholar.google.com": ["research"],
    "netflix.com": ["entertainment"], "spotify.com": ["music"], "soundcloud.com": ["music"],
    "codepen.io": ["dev", "code"], "jsfiddle.net": ["dev", "code"], "replit.com": ["dev", "code"],
    "trello.com": ["productivity"], "asana.com": ["productivity"], "atlassian.net": ["productivity"],
    "slack.com": ["communication"], "discord.com": ["communication"],
    "news.ycombinator.com": ["dev", "news"], "techcrunch.com": ["tech", "news"],
    "vercel.com": ["dev", "hosting"], "netlify.com": ["dev", "hosting"],
    "kaggle.com": ["data", "ml"], "huggingface.co": ["dev", "ml", "ai"],
    "developer.mozilla.org": ["dev", "docs"],
  };

  function suggestTags(url) {
    const host = domain(url);
    if (!host) return [];
    if (DOMAIN_TAGS[host]) return DOMAIN_TAGS[host].slice();
    for (const d in DOMAIN_TAGS) if (host.endsWith("." + d)) return DOMAIN_TAGS[d].slice();
    if (/^docs?\./.test(host) || /\/docs?\//.test(url)) return ["docs"];
    if (/^blog\./.test(host) || /\/blog\//.test(url)) return ["blog"];
    return [];
  }

  // ── URLs ──

  function domain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  /** Accepts "example.com" style input and returns a full URL, or null if invalid. */
  function normalizeUrl(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^(javascript|data|mailto|about):/i.test(s)) s = "https://" + s;
    try {
      return new URL(s).href;
    } catch (e) {
      return null;
    }
  }

  function isWebUrl(url) {
    return /^https?:\/\//i.test(url || "");
  }

  /** Chrome's built-in favicon cache (works offline, no third-party requests). */
  function favicon(url, size = 32) {
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url || "")}&size=${size}`);
  }

  function hue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  // ── Bookmark tree ──

  /** Flattened folder list (excluding the invisible root) with depth for indented pickers. */
  function flattenFolders(tree) {
    const out = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        if (n.url) continue;
        if (n.id === "0") {
          walk(n.children || [], 0);
          continue;
        }
        // Chrome hides the empty "Mobile bookmarks" root, so do we.
        if (n.parentId === "0" && n.id !== "1" && n.id !== "2" && !(n.children || []).length) continue;
        out.push({ id: n.id, title: n.title || "Untitled", depth, parentId: n.parentId });
        walk(n.children || [], depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }

  function folderOptionsHTML(folders, selectedId) {
    return folders
      .map(
        (f) =>
          `<option value="${f.id}"${f.id === selectedId ? " selected" : ""}>${" ".repeat(f.depth)}${escapeHTML(f.title)}</option>`,
      )
      .join("");
  }

  async function saveTabsToFolder(name, parentId, windowId = chrome.windows.WINDOW_ID_CURRENT) {
    const tabs = await chrome.tabs.query({ windowId });
    const own = chrome.runtime.getURL("");
    const ok = tabs.filter((t) => /^(https?|file|ftp):/i.test(t.url || "") && !t.url.startsWith(own));
    if (!ok.length) throw new Error("No web pages are open in this window.");
    const folder = await chrome.bookmarks.create({ parentId, title: name });
    for (const t of ok) {
      await chrome.bookmarks.create({ parentId: folder.id, title: t.title || t.url, url: t.url });
    }
    return { folder, count: ok.length };
  }

  // ── Network ──

  async function readHead(res, max) {
    if (!res.body) return (await res.text()).slice(0, max);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let out = "";
    while (out.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (out.includes("</head>") || out.includes("</HEAD>")) break;
    }
    reader.cancel().catch(() => {});
    return out;
  }

  function decodeEntities(text) {
    return String(text || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  // Reads <title> and <meta> tags with a plain text scan. We deliberately don't use DOMParser:
  // parsing a fetched page into a document makes Chrome report a CSP violation for every inline
  // handler in it (e.g. <body onload="…">), flooding the extension's error log.
  function parseMeta(html, base) {
    const headEnd = html.search(/<\/head\s*>/i);
    const head = headEnd > 0 ? html.slice(0, headEnd) : html;

    const meta = {};
    for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
      const attrs = {};
      for (const m of tag.matchAll(/([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
        attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
      }
      const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
      if (key && attrs.content && !(key in meta)) meta[key] = decodeEntities(attrs.content).trim();
    }

    const t = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const docTitle = t ? decodeEntities(t[1]).replace(/\s+/g, " ").trim() : "";

    let ogImage = meta["og:image"] || meta["og:image:url"] || meta["og:image:secure_url"] ||
                  meta["twitter:image"] || meta["twitter:image:src"] || meta["image"] || null;
    const title = meta["og:title"] || docTitle || null;
    const description = meta["description"] || meta["og:description"] || null;
    if (ogImage) {
      try {
        ogImage = new URL(ogImage, base).href;
        if (!isWebUrl(ogImage)) ogImage = null;
      } catch (e) {
        ogImage = null;
      }
    }
    return { ogImage, title, description };
  }

  async function fetchPageMeta(url) {
    const empty = { ogImage: null, title: null, description: null };
    if (!isWebUrl(url)) return empty;
    const res = await fetch(url, { credentials: "omit", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) {
      res.body?.cancel().catch(() => {});
      return empty;
    }
    return parseMeta(await readHead(res, 300000), res.url || url);
  }

  // Apps that answer "404" for private content when you're not signed in (so a 404 there
  // usually means "no access", not "deleted").
  const AUTH_WALLED = [
    "figma.com", "github.com", "gitlab.com", "bitbucket.org", "docs.google.com", "drive.google.com",
    "notion.so", "notion.site", "miro.com", "canva.com", "dropbox.com", "trello.com", "atlassian.net",
    "linear.app", "airtable.com", "loom.com", "onedrive.live.com", "sharepoint.com", "slack.com",
  ];
  function isAuthWalled(url) {
    const host = domain(url);
    return AUTH_WALLED.some((d) => host === d || host.endsWith("." + d));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function probe(url, method) {
    // credentials: "include" sends your login cookies, so pages you can open in the browser
    // (private Figma files, Google Docs…) aren't mistaken for missing pages.
    const res = await fetch(url, {
      method,
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    res.body?.cancel().catch(() => {});
    return res.status;
  }

  /**
   * 'ok' | 'broken' (confirmed 404/410 or host unreachable) | 'restricted' (sign-in needed)
   * | 'slow' (timed out) | 'skipped' (non-web URL)
   *
   * A link is only reported broken after a full GET confirms it — many sites (Figma included)
   * answer HEAD requests with 404/405 even when the page exists.
   */
  async function checkLink(url) {
    if (!isWebUrl(url)) return "skipped";
    let status;
    try {
      status = await probe(url, "HEAD");
      if (status >= 400 || status === 0) status = await probe(url, "GET");
    } catch (e) {
      if (e && e.name === "TimeoutError") return "slow";
      // Network hiccups are common — retry once before calling it unreachable.
      await sleep(1500);
      try {
        status = await probe(url, "GET");
      } catch (e2) {
        return e2 && e2.name === "TimeoutError" ? "slow" : "broken";
      }
    }
    if (status === 404 || status === 410) return isAuthWalled(url) ? "restricted" : "broken";
    if (status === 401 || status === 403) return "restricted";
    return "ok";
  }

  // ── Concurrency ──

  async function pool(items, limit, fn) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          await fn(items[idx], idx);
        } catch (e) {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }

  function limiter(n) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= n || !queue.length) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--;
        next();
      });
    };
    return (fn) => new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  }

  function debounce(fn, ms) {
    let t;
    const d = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    d.flush = (...args) => {
      clearTimeout(t);
      return fn(...args);
    };
    return d;
  }

  // ── Formatting ──

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
    if (s < 86400 * 365) return Math.floor(s / (86400 * 30)) + "mo ago";
    return Math.floor(s / (86400 * 365)) + "y ago";
  }

  // ── Tag input component (chips + autocomplete) ──

  function createTagInput(root, { value = [], suggestions = [], placeholder = "Add tags…", onChange = () => {} } = {}) {
    root.classList.add("tag-input");
    root.innerHTML =
      '<span class="ti-chips"></span><input class="ti-field" type="text" autocomplete="off" spellcheck="false" aria-label="Tags" />' +
      '<div class="ti-menu" role="listbox" hidden></div>';
    const chipsEl = root.querySelector(".ti-chips");
    const input = root.querySelector(".ti-field");
    const menu = root.querySelector(".ti-menu");
    let tags = normalizeTags(value);
    let pool_ = suggestions.slice();
    let items = [];
    let active = -1;

    const render = () => {
      chipsEl.innerHTML = tags
        .map((t) => `<span class="ti-chip">#${escapeHTML(t)}<button type="button" tabindex="-1" data-remove="${escapeHTML(t)}" aria-label="Remove ${escapeHTML(t)}">×</button></span>`)
        .join("");
      input.placeholder = tags.length ? "" : placeholder;
    };
    const emit = () => onChange(tags.slice());
    const hideMenu = () => {
      menu.hidden = true;
      items = [];
      active = -1;
    };
    const showMenu = () => {
      const q = normalizeTags(input.value)[0] || "";
      if (!q) return hideMenu();
      items = pool_.filter((s) => !tags.includes(s) && s.includes(q))
        .sort((a, b) => (b.startsWith(q) - a.startsWith(q)) || a.localeCompare(b))
        .slice(0, 6);
      if (!items.length) return hideMenu();
      if (active >= items.length) active = items.length - 1;
      menu.innerHTML = items
        .map((s, i) => `<div class="ti-option${i === active ? " active" : ""}" role="option" data-pick="${escapeHTML(s)}">#${escapeHTML(s)}</div>`)
        .join("");
      menu.hidden = false;
    };
    const add = (raw) => {
      let changed = false;
      for (const t of normalizeTags(raw)) {
        if (!tags.includes(t)) {
          tags.push(t);
          changed = true;
        }
      }
      input.value = "";
      hideMenu();
      render();
      if (changed) emit();
    };
    const remove = (t) => {
      tags = tags.filter((x) => x !== t);
      render();
      emit();
    };

    input.addEventListener("input", () => {
      if (input.value.includes(",")) add(input.value);
      else {
        active = -1;
        showMenu();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && items.length) {
        e.preventDefault();
        active = (active + 1) % items.length;
        showMenu();
      } else if (e.key === "ArrowUp" && items.length) {
        e.preventDefault();
        active = active <= 0 ? items.length - 1 : active - 1;
        showMenu();
      } else if ((e.key === "Enter" || e.key === "Tab") && (input.value.trim() || active >= 0)) {
        e.preventDefault();
        e.stopPropagation();
        add(active >= 0 ? items[active] : input.value);
      } else if (e.key === "Backspace" && !input.value && tags.length) {
        remove(tags[tags.length - 1]);
      } else if (e.key === "Escape" && !menu.hidden) {
        e.preventDefault();
        e.stopPropagation();
        hideMenu();
      }
    });
    input.addEventListener("blur", () => setTimeout(() => {
      if (input.value.trim()) add(input.value);
      hideMenu();
    }, 120));
    menu.addEventListener("mousedown", (e) => {
      const opt = e.target.closest("[data-pick]");
      if (opt) {
        e.preventDefault();
        add(opt.dataset.pick);
      }
    });
    chipsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove]");
      if (b) remove(b.dataset.remove);
    });
    root.addEventListener("click", (e) => {
      if (e.target === root || e.target === chipsEl) input.focus();
    });

    render();
    return {
      get: () => {
        if (input.value.trim()) add(input.value);
        return tags.slice();
      },
      set: (v) => {
        tags = normalizeTags(v);
        input.value = "";
        render();
      },
      add,
      has: (t) => tags.includes(t),
      setSuggestions: (s) => (pool_ = s.slice()),
      focus: () => input.focus(),
    };
  }

  global.BM = {
    KEYS, ROOT_IDS, PAGE_TTL,
    read, write, updateMeta, patchMetaMany, getSettings, setSettings, rememberFolder, validFolder,
    normalizeTags, suggestTags,
    domain, normalizeUrl, isWebUrl, favicon, hue,
    flattenFolders, folderOptionsHTML, saveTabsToFolder,
    fetchPageMeta, checkLink, pool, limiter, debounce,
    escapeHTML, timeAgo, createTagInput,
  };
})(typeof self !== "undefined" ? self : window);
