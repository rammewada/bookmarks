// bookmark-overlay.js — content script with Smart Auto-Tags + Read Later Reminders

(async () => {
    if (document.getElementById('bm-overlay-root')) return;

    var result = await chrome.storage.local.get('bm_overlay_pending');
    var data = result.bm_overlay_pending;
    if (!data) return;
    await chrome.storage.local.remove('bm_overlay_pending');

    var title = data.title, url = data.url, folders = data.folders, allTags = data.allTags;

    // ── Smart Auto-Tags: suggest tags based on domain ──
    var DOMAIN_TAGS = {
        'github.com':['dev','code'],'gitlab.com':['dev','code'],'bitbucket.org':['dev','code'],
        'stackoverflow.com':['dev','qa'],'stackexchange.com':['dev','qa'],
        'youtube.com':['video'],'vimeo.com':['video'],'twitch.tv':['video','gaming'],
        'medium.com':['article','blog'],'dev.to':['dev','article'],'hashnode.com':['dev','blog'],
        'twitter.com':['social'],'x.com':['social'],
        'reddit.com':['social','forum'],'linkedin.com':['career','social'],
        'amazon.com':['shopping'],'ebay.com':['shopping'],'flipkart.com':['shopping'],
        'wikipedia.org':['reference','wiki'],
        'docs.google.com':['docs'],'drive.google.com':['docs'],'notion.so':['productivity','docs'],
        'figma.com':['design'],'dribbble.com':['design'],'behance.net':['design'],'canva.com':['design'],
        'npmjs.com':['dev','package'],'pypi.org':['dev','package'],
        'arxiv.org':['research','paper'],'scholar.google.com':['research'],
        'netflix.com':['entertainment'],'spotify.com':['music'],'soundcloud.com':['music'],
        'codepen.io':['dev','code'],'jsfiddle.net':['dev','code'],'replit.com':['dev','code'],
        'trello.com':['productivity'],'asana.com':['productivity'],'jira.atlassian.com':['productivity'],
        'slack.com':['communication'],'discord.com':['communication'],
        'news.ycombinator.com':['dev','news'],'techcrunch.com':['tech','news'],
        'vercel.com':['dev','hosting'],'netlify.com':['dev','hosting'],
        'kaggle.com':['data','ml'],'huggingface.co':['dev','ml','ai'],
    };

    var suggestedTags = [];
    try {
        var hostname = new URL(url).hostname.replace('www.', '');
        // Try exact match then partial match
        if (DOMAIN_TAGS[hostname]) {
            suggestedTags = DOMAIN_TAGS[hostname];
        } else {
            for (var domain in DOMAIN_TAGS) {
                if (hostname.endsWith(domain)) {
                    suggestedTags = DOMAIN_TAGS[domain];
                    break;
                }
            }
        }
    } catch (e) {}

    var suggestedChipsHTML = suggestedTags.map(function(t) {
        return '<button type="button" class="bm-tag-chip" data-tag="' + t + '">' + t + '</button>';
    }).join('');

    // ── Build HTML ──
    var folderOptions = folders.map(function(f) {
        var indent = '\u00a0\u00a0\u00a0\u00a0'.repeat(f.depth);
        var safe = f.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return '<option value="' + f.id + '">' + indent + safe + '</option>';
    }).join('');

    var tagOptions = allTags.map(function(t) {
        return '<option value="' + t.replace(/"/g, '&quot;') + '">';
    }).join('');

    var safeTitle = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    var safeUrl   = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    var overlay = document.createElement('div');
    overlay.id = 'bm-overlay-root';
    overlay.className = 'bm-modal-overlay';
    overlay.innerHTML =
      '<div class="bm-modal">' +
        '<h2 class="bm-modal-heading">Save Bookmark</h2>' +
        '<form id="bm-form">' +

          '<div class="bm-field-group">' +
            '<label class="bm-field-label">Title</label>' +
            '<input class="bm-field-input" id="bm-title" type="text" value="' + safeTitle + '" required />' +
          '</div>' +

          '<div class="bm-field-group">' +
            '<label class="bm-field-label">URL</label>' +
            '<input class="bm-field-input" id="bm-url" type="text" value="' + safeUrl + '" required />' +
          '</div>' +

          '<div class="bm-field-group">' +
            '<label class="bm-field-label bm-label-row">' +
              'Folder' +
              '<button type="button" id="bm-new-folder-btn" class="bm-new-folder-btn">+ NEW FOLDER</button>' +
            '</label>' +
            '<select class="bm-field-input" id="bm-folder">' + folderOptions + '</select>' +
          '</div>' +

          '<div class="bm-field-group">' +
            '<label class="bm-field-label">Tags</label>' +
            (suggestedChipsHTML ? '<div class="bm-tag-suggestions" id="bm-tag-suggestions">' + suggestedChipsHTML + '</div>' : '') +
            '<input class="bm-field-input" id="bm-tags" type="text"' +
                   ' list="bm-tags-datalist" placeholder="comma separated..." />' +
            '<datalist id="bm-tags-datalist">' + tagOptions + '</datalist>' +
          '</div>' +

          '<div class="bm-field-group">' +
            '<label class="bm-field-label">Notes</label>' +
            '<textarea class="bm-field-input bm-textarea" id="bm-notes"></textarea>' +
          '</div>' +

          '<div class="bm-field-group">' +
            '<label class="bm-field-label">Remind Me</label>' +
            '<select class="bm-field-input" id="bm-remind">' +
              '<option value="0">No reminder</option>' +
              '<option value="60">In 1 hour</option>' +
              '<option value="180">In 3 hours</option>' +
              '<option value="480">Tonight (8 hrs)</option>' +
              '<option value="1440">Tomorrow</option>' +
              '<option value="10080">Next week</option>' +
            '</select>' +
          '</div>' +

          '<div class="bm-btn-row">' +
            '<button type="submit" class="bm-btn bm-btn-primary">Save Changes</button>' +
            '<button type="button" class="bm-btn" id="bm-cancel-btn">Cancel</button>' +
          '</div>' +

        '</form>' +
        '<div class="bm-footer-link">' +
          '<a href="#" id="bm-open-library">Open Library</a>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Default folder to Bookmarks Bar
    var sel = document.getElementById('bm-folder');
    var bar = folders.find(function(f) { return f.id === '1'; });
    if (bar) sel.value = bar.id;

    setTimeout(function() {
        var el = document.getElementById('bm-title');
        if (el) el.select();
    }, 80);

    function close() {
        overlay.style.opacity = '0';
        var modal = overlay.querySelector('.bm-modal');
        if (modal) modal.style.transform = 'translateY(16px) scale(0.98)';
        setTimeout(function() { overlay.remove(); }, 200);
    }

    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    document.getElementById('bm-cancel-btn').addEventListener('click', close);
    document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape' && document.getElementById('bm-overlay-root')) {
            close();
            document.removeEventListener('keydown', handler);
        }
    });

    // ── Smart tag chips: click to toggle ──
    var chips = document.querySelectorAll('.bm-tag-chip');
    chips.forEach(function(chip) {
        chip.addEventListener('click', function() {
            var tag = chip.getAttribute('data-tag');
            var input = document.getElementById('bm-tags');
            var current = input.value ? input.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
            if (chip.classList.contains('active')) {
                chip.classList.remove('active');
                current = current.filter(function(t) { return t !== tag; });
            } else {
                chip.classList.add('active');
                if (current.indexOf(tag) === -1) current.push(tag);
            }
            input.value = current.join(', ');
        });
    });

    // Open library
    document.getElementById('bm-open-library').addEventListener('click', function(e) {
        e.preventDefault();
        chrome.runtime.sendMessage({ action: 'openLibrary' });
        close();
    });

    // New folder
    document.getElementById('bm-new-folder-btn').addEventListener('click', function() {
        var name = prompt('New folder name:');
        if (!name || !name.trim()) return;
        chrome.runtime.sendMessage(
            { action: 'createFolder', name: name.trim(), parentId: sel.value },
            function(res) {
                if (!res || !res.id) return;
                var opt = document.createElement('option');
                opt.value = res.id;
                opt.textContent = '\u00a0\u00a0\u00a0\u00a0' + res.title;
                sel.appendChild(opt);
                sel.value = res.id;
            }
        );
    });

    // Save
    document.getElementById('bm-form').addEventListener('submit', function(e) {
        e.preventDefault();
        var tagsRaw = document.getElementById('bm-tags').value;
        var tags = tagsRaw ? tagsRaw.split(',').map(function(t) { return t.trim().toLowerCase(); }).filter(Boolean) : [];
        var remindIn = parseInt(document.getElementById('bm-remind').value, 10) || 0;
        chrome.runtime.sendMessage({
            action: 'saveNewBookmark',
            data: {
                title:    document.getElementById('bm-title').value.trim(),
                url:      document.getElementById('bm-url').value.trim(),
                folderId: sel.value,
                tags:     tags,
                notes:    document.getElementById('bm-notes').value.trim(),
                remindIn: remindIn
            }
        });
        close();
    });
})();
