# Bookmark Organizer — Claude Code Guide

## Project Overview
A Chrome extension (Manifest V3) that transforms browser bookmarks into a full-featured personal link library with tagging, search, link health tracking, and metadata enrichment.

## Architecture

```
manifest.json      — Extension config (v2.0.0, MV3)
background.js      — Service worker: metadata fetching, link health checks, tab saving
popup.html/js      — Quick-access popup (bookmark/folder counts, open organizer)
newtab.html/js     — Main organizer UI (full-page new tab replacement)
icons/             — Extension icons (16, 32, 48, 128px)
```

## Tech Stack
- **Platform**: Chrome Extension (Manifest V3)
- **Frontend**: Vanilla JS + HTML + CSS (no build step, no frameworks)
- **Storage**: `chrome.storage.local` for metadata; Chrome Bookmarks API for bookmark data
- **Fonts**: Google Fonts (Instrument Serif, Inter, JetBrains Mono)

## Key Permissions
`bookmarks`, `storage`, `tabs`, `favicon`, `sessions`, `history`, `contextMenus`, `<all_urls>`

## Core Features
- Tag-based organization with suggestions
- Link health checking (broken link detection) — 24-hour cache
- Metadata extraction (favicon, OG image, title, description) — 7-day cache
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
