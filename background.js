// Background service worker for Bookmark Organizer
// Handles metadata fetching and caching

const CACHE_KEY = 'bookmark_metadata_cache';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

// Listen for messages from the newtab page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchMetadata') {
    handleMetadataFetch(request.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'openOrganizer') {
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'clearCache') {
    chrome.storage.local.remove(CACHE_KEY, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function handleMetadataFetch(url) {
  // Check cache first
  const cached = await getCachedMetadata(url);
  if (cached) return cached;

  try {
    const metadata = await fetchPageMetadata(url);
    await cacheMetadata(url, metadata);
    return metadata;
  } catch (e) {
    // Return fallback with favicon only
    const fallback = {
      favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`,
      ogImage: null,
      title: null,
      description: null,
      cached: false
    };
    return fallback;
  }
}

async function fetchPageMetadata(url) {
  const hostname = new URL(url).hostname;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error('Fetch failed');

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const ogImage = doc.querySelector('meta[property="og:image"]')?.content ||
      doc.querySelector('meta[name="twitter:image"]')?.content ||
      null;

    const ogDesc = doc.querySelector('meta[property="og:description"]')?.content ||
      doc.querySelector('meta[name="description"]')?.content ||
      null;

    const title = doc.querySelector('meta[property="og:title"]')?.content ||
      doc.querySelector('title')?.textContent ||
      null;

    return {
      favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
      ogImage: ogImage && ogImage.startsWith('http') ? ogImage : null,
      title: title?.trim() || null,
      description: ogDesc?.trim() || null,
      cached: true,
      fetchedAt: Date.now()
    };
  } catch (e) {
    return {
      favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
      ogImage: null,
      title: null,
      description: null,
      cached: false,
      fetchedAt: Date.now()
    };
  }
}

async function getCachedMetadata(url) {
  return new Promise(resolve => {
    chrome.storage.local.get(CACHE_KEY, result => {
      const cache = result[CACHE_KEY] || {};
      const entry = cache[url];
      if (entry && (Date.now() - entry.fetchedAt) < CACHE_EXPIRY) {
        resolve(entry);
      } else {
        resolve(null);
      }
    });
  });
}

async function cacheMetadata(url, metadata) {
  return new Promise(resolve => {
    chrome.storage.local.get(CACHE_KEY, result => {
      const cache = result[CACHE_KEY] || {};
      cache[url] = metadata;
      // Limit cache size to 500 entries
      const keys = Object.keys(cache);
      if (keys.length > 500) {
        keys.sort((a, b) => (cache[a].fetchedAt || 0) - (cache[b].fetchedAt || 0));
        keys.slice(0, 50).forEach(k => delete cache[k]);
      }
      chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
    });
  });
}
