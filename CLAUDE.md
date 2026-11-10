# Bookmark Organizer — Claude Code Guide

## Project Overview
A Chrome extension (Manifest V3) that transforms browser bookmarks into a full-featured personal link library with tagging, search, link health tracking, and metadata enrichment.

## Architecture

```
manifest.json      — Extension config (v2.1.0, MV3); toolbar popup (Alt+Shift+D command)
lib.js             — Shared helpers (storage, tags, URL utils, page-meta fetch, link check, tag-chip input).
                     Loaded by popup/newtab via <script> and by background.js via importScripts(). 
shared.css         — Design tokens (light/dark) + shared components (fields, buttons, tag input)
shortcut.js        — Content script: Ctrl/Cmd+Shift+D on web pages opens the save popup (Chrome reserves that key, so it can't be a command)
background.js      — Service worker: context menus (save page/link), reminders, meta cleanup on delete
popup.html/js      — One-click save (like Chrome's star bubble): saves on open, fields auto-save
newtab.html/js     — Library UI (full page, opened from the popup or the icon's right-click menu; does NOT replace the New Tab page)
icons/             — Extension icons: real transparent PNGs at 16/32/48/128 + icon.svg source
docs/              — User guide (index.html + screenshots/), GitHub Pages ready; live copy published as a claude.ai artifact
```

## Conventions
- Extension pages run under MV3 CSP: **never use inline `onclick=` handlers** — use `data-action` /
  `data-filter` attributes handled by the delegated click handler in `newtab.js`.
- Storage keys live in `BM.KEYS`. Per-bookmark metadata (`bm_meta_v2`) is keyed by bookmark id; always
  write it with `BM.updateMeta` / `BM.patchMetaMany` (read-modify-write) instead of overwriting the whole map.
- The library re-renders automatically on `chrome.bookmarks.*` and `storage.onChanged` events, so
  operations generally don't need to reload state manually.
- Chrome's own Ctrl+D / star is never intercepted; those bookmarks just show up in the library.

## Tech Stack
- **Platform**: Chrome Extension (Manifest V3)
- **Frontend**: Vanilla JS + HTML + CSS (no build step, no frameworks)
- **Storage**: `chrome.storage.local` for metadata; Chrome Bookmarks API for bookmark data
- **Fonts**: Google Fonts (Instrument Serif, Inter, JetBrains Mono)

## Key Permissions
`bookmarks`, `storage`, `tabs`, `favicon`, `contextMenus`, `alarms`, `notifications`, `<all_urls>`

## Core Features
- Tag-based organization with suggestions
- Link health checking (on demand from the Broken links view; 404/410 or unreachable = broken)
- Thumbnails from og:image, fetched lazily (4 at a time) with a 7-day cache; favicons via Chrome's _favicon API
- Folder tree with drag-and-drop navigation
- Grid/list view modes
- Pinned bookmarks and notes
- Search and tag/folder filtering
- Save open tabs as a bookmark folder
- Dark/light theme support

## Development Notes
- No build step — load directly as an unpacked extension in Chrome
- State is managed in `newtab.js` (bookmarks tree, metadata, filters, view mode)
- Background service worker caches metadata and health check results in `chrome.storage.local`
- All UI is in `newtab.html` — the new tab page is the main interface
