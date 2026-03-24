// popup.js - Popup script for Bookmark Organizer

function countBookmarks(nodes) {
  let bookmarks = 0, folders = 0;
  for (const node of nodes) {
    if (node.url) {
      bookmarks++;
    } else if (node.children) {
      folders++;
      const child = countBookmarks(node.children);
      bookmarks += child.bookmarks;
      folders += child.folders;
    }
  }
  return { bookmarks, folders };
}

document.addEventListener('DOMContentLoaded', () => {
  // Load bookmark counts
  chrome.bookmarks.getTree((tree) => {
    const counts = countBookmarks(tree[0]?.children || []);
    document.getElementById('total-count').textContent = counts.bookmarks;
    document.getElementById('folder-count').textContent = counts.folders;
  });

  // Open full organizer page
  document.getElementById('btn-open').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
    window.close();
  });
});
