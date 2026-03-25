// background.js - Bookmark health & metadata system (v2.2)

const CACHE_KEY = 'bm_metadata_v2';
const HEALTH_CACHE_KEY = 'bm_health_v2';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

// Open organizer when a new bookmark is created (Star Hijack)
chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    if (bookmark.url) {
        chrome.tabs.create({ 
            url: chrome.runtime.getURL('newtab.html') + '?edit=' + id 
        });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

async function handleMetadataFetch(url) {
  const cache = await getStorage(CACHE_KEY);
  if (cache[url] && (Date.now() - cache[url].fetchedAt) < CACHE_EXPIRY) return cache[url];

  const meta = await fetchPageMetadata(url);
  cache[url] = { ...meta, fetchedAt: Date.now() };
  await setStorage(CACHE_KEY, cache);
  return meta;
}

async function handleHealthCheck(url) {
  const cache = await getStorage(HEALTH_CACHE_KEY);
  if (cache[url] && (Date.now() - cache[url].checkedAt) < (24 * 60 * 60 * 1000)) {
    return cache[url].status;
  }

  let status = 'alive';
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
  } catch (e) {
    status = 'broken';
  }

  cache[url] = { status, checkedAt: Date.now() };
  await setStorage(HEALTH_CACHE_KEY, cache);
  return status;
}

async function fetchPageMetadata(url) {
  const hostname = new URL(url).hostname;
  const fallback = {
    favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
    ogImage: null, title: null, description: null
  };

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return fallback;
    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || 
                         html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

    return {
      favicon: fallback.favicon,
      ogImage: ogImageMatch ? ogImageMatch[1] : null,
      title: titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : null,
      description: descMatch ? decodeHTMLEntities(descMatch[1].trim()) : null
    };
  } catch (e) { return fallback; }
}

function decodeHTMLEntities(text) {
  return text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
             .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function saveAllTabsToFolder(name) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    // Root [0] Usually "Bookmarks"
    // Children [1] Usually "Bookmarks Bar"
    const root = await chrome.bookmarks.getTree();
    
    // Find Bookmarks Bar or Desktop bookmarks folder
    const desktopFolder = root[0].children.find(c => c.id === '1' || c.title.toLowerCase().includes('bar')) || root[0].children[0];

    const folder = await chrome.bookmarks.create({ parentId: desktopFolder.id, title: name || `Session (${new Date().toLocaleDateString()})` });
    for (const tab of tabs) {
      if (tab.url.startsWith('http')) {
        await chrome.bookmarks.create({ parentId: folder.id, title: tab.title, url: tab.url });
      }
    }
}

function getStorage(key) {
  return new Promise(r => chrome.storage.local.get(key, res => r(res[key] || {})));
}
function setStorage(key, val) {
  return new Promise(r => chrome.storage.local.set({ [key]: val }, r));
}
