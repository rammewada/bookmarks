// background.js — service worker: context menus, reminders, metadata cleanup.
// Saving from the toolbar is handled by popup.html (opened by the icon or Ctrl+Shift+D).
// Chrome's own star / Ctrl+D is left untouched — those bookmarks appear in the library automatically.

importScripts("lib.js");

// ── Context menus ──

chrome.runtime.onInstalled.addListener(() => {
  // v2 link-health results contained false "broken" flags (e.g. every Figma link) — drop them.
  chrome.storage.local.remove("bm_health_v2");
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-page", title: "Save page to Library", contexts: ["page"] });
    chrome.contextMenus.create({ id: "save-link", title: "Save link to Library", contexts: ["link"] });
    chrome.contextMenus.create({ id: "open-library", title: "Open Library", contexts: ["action"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-library") {
    chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
    return;
  }
  const isLink = info.menuItemId === "save-link";
  const url = isLink ? info.linkUrl : tab?.url || info.pageUrl;
  if (!url) return;
  const tabId = tab?.id;
  try {
    const existing = await chrome.bookmarks.search({ url });
    if (existing.some((b) => b.url)) return badge(tabId, "✓", "#5f6368", "Already in your library");

    let title = isLink ? info.selectionText || info.linkText || "" : tab?.title || "";
    if (!title || title === url) {
      try {
        title = (await BM.fetchPageMeta(url)).title || url;
      } catch (e) {
        title = url;
      }
    }
    const settings = await BM.getSettings();
    const parentId = await BM.validFolder(settings.lastFolderId);
    await chrome.bookmarks.create({ parentId, title, url });
    badge(tabId, "✓", "#188038", "Saved to library");
  } catch (e) {
    console.error("Save from context menu failed:", e);
    badge(tabId, "!", "#d93025", "Could not save: " + e.message);
  }
});

function badge(tabId, text, color, title) {
  const opts = tabId != null ? { tabId } : {};
  chrome.action.setBadgeBackgroundColor({ color, ...opts });
  chrome.action.setBadgeText({ text, ...opts });
  if (title) chrome.action.setTitle({ title, ...opts });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", ...opts });
    chrome.action.setTitle({ title: "Save bookmark", ...opts });
  }, 2500);
}

// ── Reminders ──
// Alarm name: "bm-remind:<bookmarkId>" (older builds used "bm-remind:<json>").

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("bm-remind:")) return;
  const key = alarm.name.slice("bm-remind:".length);

  let title, url, notifKey;
  if (key.startsWith("{")) {
    try {
      ({ title, url } = JSON.parse(key));
      notifKey = url;
    } catch (e) {
      return;
    }
  } else {
    try {
      const [bm] = await chrome.bookmarks.get(key);
      ({ title, url } = bm);
      notifKey = key;
      await serial(() => BM.updateMeta(key, { remindAt: null }));
    } catch (e) {
      return; // bookmark was deleted
    }
  }

  chrome.notifications.create("bm-notif:" + notifKey, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Read later",
    message: title || url,
    contextMessage: BM.domain(url),
  });
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  if (!notifId.startsWith("bm-notif:")) return;
  const key = notifId.slice("bm-notif:".length);
  let url = key;
  if (!/^[a-z]+:/i.test(key)) {
    try {
      url = (await chrome.bookmarks.get(key))[0].url;
    } catch (e) {
      return;
    }
  }
  chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
});

// ── Keep metadata in sync with the bookmark tree ──

let chain = Promise.resolve();
function serial(fn) {
  chain = chain.then(fn, fn);
  return chain;
}

chrome.bookmarks.onRemoved.addListener((id, info) => {
  const ids = [];
  const walk = (n) => {
    ids.push(n.id);
    (n.children || []).forEach(walk);
  };
  if (info.node) walk(info.node);
  else ids.push(id);

  ids.forEach((i) => chrome.alarms.clear("bm-remind:" + i));
  serial(async () => {
    const meta = await BM.read(BM.KEYS.META);
    let changed = false;
    for (const i of ids) {
      if (meta[i]) {
        delete meta[i];
        changed = true;
      }
    }
    if (changed) await BM.write(BM.KEYS.META, meta);
  });
});

// ── Messages ──

chrome.runtime.onMessage.addListener((request, sender) => {
  if (!request) return;
  if (request.action === "openLibrary") {
    chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
  } else if (request.action === "openSavePopup" && sender.tab) {
    openSavePopup(sender.tab);
  }
});

// Ctrl+Shift+D (from shortcut.js): open the toolbar popup; if Chrome refuses (older versions,
// or the window isn't focused), show the same panel in a small window next to the page.
async function openSavePopup(tab) {
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
    return;
  } catch (e) {}
  let left, top;
  try {
    const win = await chrome.windows.get(tab.windowId);
    left = Math.max(0, win.left + win.width - 420);
    top = win.top + 80;
  } catch (e) {}
  chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?tab=${tab.id}`),
    type: "popup",
    width: 392,
    height: 660,
    left,
    top,
    focused: true,
  });
}
