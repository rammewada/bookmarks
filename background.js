// background.js - Bookmark health & metadata system (v3.0)

const META_KEY   = 'bm_meta_v2';       // user metadata: tags, notes, pinned
const CACHE_KEY  = 'bm_metadata_v2';   // page metadata cache: favicon, og:image
const HEALTH_KEY = 'bm_health_v2';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000;

let internalCreate = false;

// ── Extension icon click → show overlay on current tab ──
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.url || !tab.url.startsWith('http')) return;
    await showOverlayOnTab(tab.id, tab.title, tab.url);
});

// ── Star / Ctrl+D → intercept, delete, show overlay ──
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
    if (!bookmark.url) return;
    if (internalCreate) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.startsWith('http')) return;

    await chrome.bookmarks.remove(id);
    await showOverlayOnTab(tab.id, bookmark.title, bookmark.url);
});

async function showOverlayOnTab(tabId, title, url) {
    const tree    = await chrome.bookmarks.getTree();
    const folders = flattenFolders(tree);
    const meta    = await getStorage(META_KEY);
    const allTags = [...new Set(Object.values(meta).flatMap(m => m.tags || []))].sort();

    await chrome.storage.local.set({
        bm_overlay_pending: { title: title || '', url: url || '', folders, allTags }
    });

    await chrome.scripting.insertCSS({ target: { tabId }, files: ['bookmark-overlay.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['bookmark-overlay.js'] });
}

function flattenFolders(nodes, depth, result) {
    depth  = depth  || 0;
    result = result || [];
    for (const node of nodes) {
        if (!node.url) {
            if (node.id !== '0') result.push({ id: node.id, title: node.title, depth });
            if (node.children) flattenFolders(node.children, node.id === '0' ? 0 : depth + 1, result);
        }
    }
    return result;
}

// ── Reminders: alarm fires → show notification ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('bm-remind:')) return;
    const data = JSON.parse(alarm.name.replace('bm-remind:', ''));
    chrome.notifications.create('bm-notif:' + data.url, {
        type:    'basic',
        iconUrl: 'icons/icon128.png',
        title:   'Bookmark Reminder',
        message: data.title || data.url,
    });
});

// Notification click → open the bookmark
chrome.notifications.onClicked.addListener((notifId) => {
    if (!notifId.startsWith('bm-notif:')) return;
    const url = notifId.replace('bm-notif:', '');
    chrome.tabs.create({ url });
    chrome.notifications.clear(notifId);
});

// ── Message handlers ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openLibrary') {
        chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
        return;
    }

    if (request.action === 'saveNewBookmark') {
        (async () => {
            try {
                const { title, url, folderId, tags, notes, remindIn } = request.data;
                internalCreate = true;
                const bm = await chrome.bookmarks.create({ parentId: folderId, title, url });
                internalCreate = false;

                const meta = await getStorage(META_KEY);
                meta[bm.id] = { tags: tags || [], notes: notes || '', pinnedAt: null };
                await setStorage(META_KEY, meta);

                // Set reminder alarm if requested
                if (remindIn && remindIn > 0) {
                    const alarmData = JSON.stringify({ title, url });
                    chrome.alarms.create('bm-remind:' + alarmData, { delayInMinutes: remindIn });
                }
            } catch (e) {
                internalCreate = false;
                console.error('saveNewBookmark failed:', e);
            }
        })();
        return;
    }

    if (request.action === 'createFolder') {
        (async () => {
            try {
                internalCreate = true;
                const folder = await chrome.bookmarks.create({ parentId: request.parentId, title: request.name });
                internalCreate = false;
                sendResponse({ id: folder.id, title: folder.title });
            } catch (e) {
                internalCreate = false;
                sendResponse({ error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'getDuplicates') {
        (async () => {
            const tree = await chrome.bookmarks.getTree();
            const all  = flattenBookmarks(tree);
            const urlMap = {};
            all.forEach(bm => {
                if (!urlMap[bm.url]) urlMap[bm.url] = [];
                urlMap[bm.url].push(bm);
            });
            const dupes = Object.values(urlMap).filter(arr => arr.length > 1);
            sendResponse({ duplicates: dupes });
        })();
        return true;
    }

    if (request.action === 'removeDuplicates') {
        (async () => {
            try {
                for (const id of request.ids) {
                    await chrome.bookmarks.remove(id);
                }
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'fetchMetadata') {
        handleMetadataFetch(request.url)
            .then(data => sendResponse({ success: true, data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'checkHealth') {
        handleHealthCheck(request.url)
            .then(status => sendResponse({ success: true, status }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'saveTabs') {
        saveAllTabsToFolder(request.folderName)
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
});

function flattenBookmarks(nodes) {
    let out = [];
    for (const n of nodes) {
        if (n.url) out.push({ id: n.id, title: n.title, url: n.url, parentId: n.parentId, dateAdded: n.dateAdded });
        if (n.children) out = out.concat(flattenBookmarks(n.children));
    }
    return out;
}

// ── Metadata & health ──

async function handleMetadataFetch(url) {
    const cache = await getStorage(CACHE_KEY);
    if (cache[url] && (Date.now() - cache[url].fetchedAt) < CACHE_EXPIRY) return cache[url];
    const meta = await fetchPageMetadata(url);
    cache[url] = { ...meta, fetchedAt: Date.now() };
    await setStorage(CACHE_KEY, cache);
    return meta;
}

async function handleHealthCheck(url) {
    const cache = await getStorage(HEALTH_KEY);
    if (cache[url] && (Date.now() - cache[url].checkedAt) < (24 * 60 * 60 * 1000)) return cache[url].status;
    let status = 'alive';
    try { await fetch(url, { method: 'HEAD', mode: 'no-cors' }); } catch (e) { status = 'broken'; }
    cache[url] = { status, checkedAt: Date.now() };
    await setStorage(HEALTH_KEY, cache);
    return status;
}

async function fetchPageMetadata(url) {
    const hostname = new URL(url).hostname;
    const fallback = { favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`, ogImage: null, title: null, description: null };
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return fallback;
        const html = await response.text();
        const titleMatch   = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        const descMatch    = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                             html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
        return {
            favicon:     fallback.favicon,
            ogImage:     ogImageMatch ? ogImageMatch[1] : null,
            title:       titleMatch   ? decodeHTMLEntities(titleMatch[1].trim()) : null,
            description: descMatch    ? decodeHTMLEntities(descMatch[1].trim())  : null
        };
    } catch (e) { return fallback; }
}

function decodeHTMLEntities(text) {
    return text.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
               .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function saveAllTabsToFolder(name) {
    internalCreate = true;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const root = await chrome.bookmarks.getTree();
    const bar = root[0].children.find(c => c.id === '1' || c.title.toLowerCase().includes('bar')) || root[0].children[0];
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: name || `Session (${new Date().toLocaleDateString()})` });
    for (const tab of tabs) {
        if (tab.url.startsWith('http')) await chrome.bookmarks.create({ parentId: folder.id, title: tab.title, url: tab.url });
    }
    internalCreate = false;
}

function getStorage(key) {
    return new Promise(r => chrome.storage.local.get(key, res => r(res[key] || {})));
}
function setStorage(key, val) {
    return new Promise(r => chrome.storage.local.set({ [key]: val }, r));
}
