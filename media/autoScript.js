(function () {
    // --- Guard: prevent double execution (workbench.js + HTML script tag) ---
    if (window._agAutoLoaded) return;
    window._agAutoLoaded = true;

    // --- Dọn dẹp bản cũ ---
    if (window._agToolIntervals) {
        window._agToolIntervals.forEach(clearInterval);
        window.removeEventListener('scroll', window._agScrollListener, true);
    }
    window._agToolIntervals = [];

    // --- Auto-dismiss "corrupt installation" notification ---
    (function suppressCorruptBanner() {
        function dismissCorrupt() {
            var banners = document.querySelectorAll('.notifications-toasts .notification-toast, .notification-list-item');
            banners.forEach(function (b) {
                var text = b.textContent || '';
                if (text.indexOf('corrupt') !== -1 || text.indexOf('reinstall') !== -1) {
                    var closeBtn = b.querySelector('.codicon-notifications-clear, .codicon-close, .action-label[aria-label*="Close"], .action-label[aria-label*="clear"], .clear-notification-action');
                    if (closeBtn) {
                        closeBtn.click();
                        console.log('[AG Auto] 🧹 Dismissed corrupt notification');
                    } else {
                        b.style.display = 'none';
                        console.log('[AG Auto] 🧹 Hidden corrupt notification');
                    }
                }
            });
        }
        dismissCorrupt();
        var attempts = 0;
        var timer = setInterval(function () {
            dismissCorrupt();
            if (++attempts > 30) clearInterval(timer);
        }, 1000);
        try {
            var observer = new MutationObserver(function () { dismissCorrupt(); });
            var target = document.body || document.documentElement;
            observer.observe(target, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); }, 30000);
        } catch (e) { }
    })();

    var PAUSE_SCROLL_MS = /*{{PAUSE_SCROLL_MS}}*/7000;
    var CLICK_INTERVAL_MS = /*{{CLICK_INTERVAL_MS}}*/1000;
    var SCROLL_INTERVAL_MS = /*{{SCROLL_INTERVAL_MS}}*/500;
    var CLICK_PATTERNS = /*{{CLICK_PATTERNS}}*/["Allow", "Always Allow", "Allow Once", "Run", "Run in Terminal", "Keep Waiting", "Accept all", "Accept", "Proceed", "Continue", "Retry", "Submit", "Confirm", "Cho phép", "Luôn cho phép", "Chạy", "Tiếp tục", "Thử lại", "Chấp nhận", "Chấp thuận", "Đồng ý", "Xác nhận"];
    window._agAcceptChatOnly = /*{{ACCEPT_IN_CHAT_ONLY}}*/true;

    // Live ON/OFF flag — exposed on window for all scopes + DevTools access
    window._agAutoEnabled = /*{{ENABLED}}*/true;
    window._agScrollEnabled = /*{{SCROLL_ENABLED}}*/true; // separate scroll toggle

    // --- ON/OFF polling via HTTP server (dynamic port discovery) ---
    var AG_HTTP_PORT_START = 48787;
    var AG_HTTP_PORT_END = 48850;
    var AG_HTTP_PORT = 0; // Will be discovered dynamically
    var _agPollCount = 0;
    var _agPollErrors = 0;
    var _agPortScanning = false;
    var _agSessionStats = {};
    var _agSessionTotal = 0;

    // --- Port Discovery: check cached/default first, then scan range ---
    function _agDiscoverPort(callback) {
        if (_agPortScanning) return;
        _agPortScanning = true;

        function probePort(p, onResult) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'http://127.0.0.1:' + p + '/ag-status?t=' + Date.now(), true);
            xhr.timeout = 600;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try {
                        var cfg = JSON.parse(xhr.responseText);
                        if (typeof cfg.enabled === 'boolean') {
                            onResult(true, cfg);
                            return;
                        }
                    } catch (_) { }
                }
                onResult(false, null);
            };
            xhr.onerror = function () { onResult(false, null); };
            xhr.ontimeout = function () { onResult(false, null); };
            xhr.send();
        }

        function onPortFound(port, cfg) {
            AG_HTTP_PORT = port;
            _agPortScanning = false;
            try { localStorage.setItem('ag_last_port', String(port)); } catch (_) { }
            console.log('[AG Auto] ✅ Discovered server on port ' + port);
            if (callback) callback(port, cfg);
        }

        // 1. Try cached port from localStorage
        var cachedPort = 0;
        try {
            var cp = parseInt(localStorage.getItem('ag_last_port') || '0', 10);
            if (cp >= AG_HTTP_PORT_START && cp <= AG_HTTP_PORT_END) cachedPort = cp;
        } catch (_) { }

        function tryDefaultThenScan() {
            probePort(AG_HTTP_PORT_START, function (ok, cfg) {
                if (ok) {
                    onPortFound(AG_HTTP_PORT_START, cfg);
                    return;
                }
                // Fallback to range scan
                doRangeScan();
            });
        }

        function doRangeScan() {
            var found = false;
            var pending = 0;
            function tryBatch(from) {
                if (from > AG_HTTP_PORT_END || found) {
                    if (!found) {
                        _agPortScanning = false;
                        console.log('[AG Auto] Port scan: no server found in range ' + AG_HTTP_PORT_START + '-' + AG_HTTP_PORT_END);
                    }
                    return;
                }
                var batchEnd = Math.min(from + 7, AG_HTTP_PORT_END);
                pending = 0;
                for (var p = from; p <= batchEnd; p++) {
                    (function (port) {
                        pending++;
                        probePort(port, function (ok, cfg) {
                            if (found) return;
                            if (ok) {
                                found = true;
                                onPortFound(port, cfg);
                            }
                            pending--;
                            if (pending <= 0 && !found) tryBatch(batchEnd + 1);
                        });
                    })(p);
                }
            }
            tryBatch(AG_HTTP_PORT_START);
        }

        if (cachedPort > 0) {
            probePort(cachedPort, function (ok, cfg) {
                if (ok) {
                    onPortFound(cachedPort, cfg);
                } else {
                    tryDefaultThenScan();
                }
            });
        } else {
            tryDefaultThenScan();
        }
    }

    function _agApplyConfig(cfg) {
        if (typeof cfg.enabled === 'boolean') {
            if (window._agAutoEnabled !== cfg.enabled) {
                console.log('[AG Auto] ' + (cfg.enabled ? '✅ BẬT' : '❌ TẮT') + ' (live toggle via HTTP)');
            }
            window._agAutoEnabled = cfg.enabled;
        }
        if (typeof cfg.scrollEnabled === 'boolean') window._agScrollEnabled = cfg.scrollEnabled;
        if (cfg.clickPatterns && Array.isArray(cfg.clickPatterns)) {
            CLICK_PATTERNS = cfg.clickPatterns;
        }
        if (typeof cfg.acceptInChatOnly === 'boolean') window._agAcceptChatOnly = cfg.acceptInChatOnly;
        if (cfg.pauseScrollMs) PAUSE_SCROLL_MS = cfg.pauseScrollMs;
        if (cfg.scrollIntervalMs) SCROLL_INTERVAL_MS = cfg.scrollIntervalMs;
        if (cfg.clickIntervalMs) CLICK_INTERVAL_MS = cfg.clickIntervalMs;
        if (cfg.clickStats) window._agClickStats = cfg.clickStats;
        if (typeof cfg.totalClicks === 'number') window._agTotalClicks = cfg.totalClicks;
        if (cfg.resetStats) {
            window._agClickStats = {};
            window._agTotalClicks = 0;
            _agSessionStats = {};
            _agSessionTotal = 0;
            console.log('[AG Auto] 🔄 Stats reset by user');
        }
    }

    // Initial port discovery
    _agDiscoverPort(function (port, cfg) {
        _agApplyConfig(cfg);
        _agPollErrors = 0;
    });

    var _agConfigReload = setInterval(function () {
        _agPollCount++;
        if (AG_HTTP_PORT === 0) {
            if (_agPollCount % 5 === 0) _agDiscoverPort(function (port, cfg) { _agApplyConfig(cfg); _agPollErrors = 0; });
            return;
        }
        if (_agPollErrors > 3) {
            AG_HTTP_PORT = 0;
            _agPollErrors = 0;
            _agDiscoverPort(function (port, cfg) { _agApplyConfig(cfg); });
            return;
        }
        try {
            var xhr = new XMLHttpRequest();
            var statsParam = '';
            if (_agSessionTotal > 0) {
                statsParam = '&total=' + _agSessionTotal + '&stats=' + encodeURIComponent(JSON.stringify(_agSessionStats));
                _agSessionStats = {};
                _agSessionTotal = 0;
            }
            xhr.open('GET', 'http://127.0.0.1:' + AG_HTTP_PORT + '/ag-status?t=' + Date.now() + statsParam, true);
            xhr.timeout = 1500;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    _agPollErrors = 0;
                    var cfg = JSON.parse(xhr.responseText);
                    _agApplyConfig(cfg);
                    if (_agPollCount <= 2) console.log('[AG Auto] HTTP Poll #' + _agPollCount + ' OK on port ' + AG_HTTP_PORT + ', enabled=' + window._agAutoEnabled + ', patterns=' + CLICK_PATTERNS.length);
                }
            };
            xhr.onerror = function () { _agPollErrors++; };
            xhr.ontimeout = function () { _agPollErrors++; };
            xhr.send();
        } catch (e) {
            _agPollErrors++;
            if (_agPollCount <= 3) console.log('[AG Auto] HTTP Poll #' + _agPollCount + ' error:', e.message);
        }
    }, 2000);
    window._agToolIntervals.push(_agConfigReload);

    // =================================================================
    // Approval and Action Buttons Detection
    // =================================================================
    var REJECT_WORDS = ['Reject', 'Deny', 'Cancel', 'Dismiss', 'Don\'t Allow', 'Decline', 'Skip', 'Abort', 'Từ chối', 'Hủy', 'Bỏ qua', 'Không cho phép'];

    // Explicitly detect and block only user prompt submit / send buttons (never auto-click user prompt send while typing)
    // NOTE: Does NOT block Agent interaction submit/continue buttons (e.g. data-testid="interaction-continue-button")!
    function isUserPromptSendButton(el) {
        if (!el) return false;

        // Never consider Antigravity agent interaction confirmation buttons as user prompt buttons!
        if (el.getAttribute && el.getAttribute('data-testid') === 'interaction-continue-button') return false;
        if (el.closest && el.closest('[data-testid="interaction-continue-button"]')) return false;

        // Check test id or tooltip specifically for user prompt send button
        var testId = el.getAttribute ? el.getAttribute('data-testid') : '';
        if (testId === 'send-button' || testId === 'composer-send-button') return true;

        var tooltipId = el.getAttribute ? el.getAttribute('data-tooltip-id') : '';
        if (tooltipId && tooltipId.indexOf('send') !== -1 && tooltipId.indexOf('input') !== -1) return true;

        var ariaLabel = (el.getAttribute ? el.getAttribute('aria-label') : '') || '';
        if (ariaLabel === 'Send message' || ariaLabel === 'Gửi tin nhắn' || ariaLabel === 'Send Prompt') return true;

        // Check if button is inside the chat input / composer textarea container (where user types)
        if (el.closest && (
            el.closest('.chat-input-actions') ||
            el.closest('.composer-submit-action') ||
            el.closest('.interactive-input-part') ||
            el.closest('[class*="chat-input"]') ||
            el.closest('[class*="composer-actions"]')
        )) {
            return true;
        }

        return false;
    }

    function getAllClickables(root) {
        if (!root) return [];
        var results = [];
        try {
            var elements = root.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, div[role="button"], span.cursor-pointer, .cursor-pointer, .bg-ide-button-background, vscode-button, input[type="button"]');
            for (var i = 0; i < elements.length; i++) {
                results.push(elements[i]);
            }
            // Check iframes
            var iframes = root.querySelectorAll('iframe, webview');
            for (var j = 0; j < iframes.length; j++) {
                try {
                    var frameDoc = iframes[j].contentDocument || (iframes[j].contentWindow && iframes[j].contentWindow.document);
                    if (frameDoc) {
                        results = results.concat(getAllClickables(frameDoc));
                    }
                } catch (_) {}
            }
            // Check shadow roots
            var allEls = root.querySelectorAll('*');
            for (var k = 0; k < allEls.length; k++) {
                if (allEls[k].shadowRoot) {
                    results = results.concat(getAllClickables(allEls[k].shadowRoot));
                }
            }
        } catch (_) {}
        return results;
    }

    function isInsideAgentOrChat(el) {
        if (!el || !el.closest) return false;
        return !!el.closest('.antigravity-agent-side-panel, [class*="agent-side-panel"], [class*="chat-panel"], [class*="antigravity"], [class*="agent"], [class*="chat"], [class*="composer"], [class*="conversation"], .interactive-session, .chat-list, .notification-toast, .dialog-buttons, [role="dialog"], .monaco-dialog-box, .auxiliarybar, .sidebar, .part.sidebar, .part.auxiliarybar');
    }

    function isApprovalButton(btn) {
        if (btn.getAttribute && btn.getAttribute('data-testid') === 'interaction-continue-button') return true;
        if (isInsideAgentOrChat(btn)) return true;

        var parent = btn.parentElement;
        if (!parent) return false;
        for (var level = 0; level < 4; level++) {
            if (!parent) break;
            var siblingBtns = parent.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background, div[role="button"]');
            for (var i = 0; i < siblingBtns.length; i++) {
                var sib = siblingBtns[i];
                if (sib === btn) continue;
                var sibText = (sib.innerText || sib.textContent || '').trim().toLowerCase();
                for (var j = 0; j < REJECT_WORDS.length; j++) {
                    if (sibText.indexOf(REJECT_WORDS[j].toLowerCase()) !== -1) {
                        return true;
                    }
                }
            }
            parent = parent.parentElement;
        }
        return false;
    }

    function simulateClick(el) {
        if (!el) return;
        try {
            var opts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.click();
        } catch (e) {
            try { el.click(); } catch (_) {}
        }
    }

    // Words in buttons that should NEVER be auto-clicked (editor/diff UI buttons)
    var EDITOR_SKIP_WORDS = ['Accept Changes', 'Accept All', 'Accept Incoming', 'Accept Current', 'Accept Both', 'Accept Combination'];

    var _clicked = new WeakSet();

    // --- Click Stats tracking ---
    if (!window._agClickStats) window._agClickStats = {};
    if (!window._agTotalClicks) window._agTotalClicks = 0;

    // --- 1. AUTO CLICK ---
    var autoClick = setInterval(function () {
        if (!window._agAutoEnabled) return;

        var targetBtn = null;
        var matchedPattern = '';

        // Priority 1: Antigravity Agent Tool Approval / Confirmation Modal
        // Handles "Allow check port status? ... [Skip] [Submit ↵]" to prevent UI hang
        try {
            var allRoots = [document];
            var iframes = document.querySelectorAll('iframe, webview');
            for (var ifr = 0; ifr < iframes.length; ifr++) {
                try {
                    var fDoc = iframes[ifr].contentDocument || (iframes[ifr].contentWindow && iframes[ifr].contentWindow.document);
                    if (fDoc) allRoots.push(fDoc);
                } catch (_) {}
            }

            for (var rIdx = 0; rIdx < allRoots.length; rIdx++) {
                var cRoot = allRoots[rIdx];
                var continueBtns = cRoot.querySelectorAll('[data-testid="interaction-continue-button"]');
                for (var cbIdx = 0; cbIdx < continueBtns.length; cbIdx++) {
                    var cBtn = continueBtns[cbIdx];
                    if (_clicked.has(cBtn)) continue;
                    var isDisabled = cBtn.disabled || cBtn.getAttribute('aria-disabled') === 'true';
                    if (!isDisabled && (cBtn.offsetParent !== null || cBtn.offsetWidth > 0)) {
                        targetBtn = cBtn;
                        matchedPattern = 'Submit';
                        break;
                    } else if (isDisabled) {
                        // If disabled because an option is not selected, select the first option
                        var card = cBtn.closest('.outline-none') || cBtn.closest('[role="dialog"]') || cBtn.parentElement;
                        if (card) {
                            var firstOpt = card.querySelector('input[type="radio"], input[type="checkbox"], label[for^="ask-opt-"], div[data-testid*="interaction-option"]');
                            if (firstOpt && !_clicked.has(firstOpt)) {
                                simulateClick(firstOpt);
                                _clicked.add(firstOpt);
                            }
                        }
                    }
                }
                if (targetBtn) break;
            }
        } catch (_) {}

        // Priority 2: General pattern matching across all clickables
        if (!targetBtn) {
            var clickables = getAllClickables(document);
            for (var i = 0; i < clickables.length; i++) {
                var b = clickables[i];
                if (b.offsetParent === null && b.offsetWidth === 0 && b.offsetHeight === 0) continue;
                if (_clicked.has(b)) continue;

                // Never click user prompt composer send button
                if (isUserPromptSendButton(b)) continue;

                var text = (b.innerText || b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
                if (!text || text.length > 50) continue;

                // Skip diff/merge editor buttons — NEVER click these
                var skipEditor = false;
                for (var se = 0; se < EDITOR_SKIP_WORDS.length; se++) {
                    if (text.indexOf(EDITOR_SKIP_WORDS[se]) === 0) { skipEditor = true; break; }
                }
                if (skipEditor) continue;

                // Skip buttons inside diff/merge editor containers + view-zones (inline widgets)
                if (b.closest && (
                    b.closest('.monaco-diff-editor') || b.closest('.merge-editor-view') ||
                    b.closest('.inline-merge-region') || b.closest('.merged-editor') ||
                    b.closest('.view-zones') || b.closest('.view-lines') ||
                    b.closest('[id*="workbench.parts.editor"]')
                )) continue;

                // Skip diff hunk buttons (inline accept/reject in editor) — NEVER auto-click these
                if (b.classList && (b.classList.contains('diff-hunk-button') || b.classList.contains('revert'))) {
                    var editorAncestor = b.closest && b.closest('[class*="editor"], [id*="editor"]');
                    if (editorAncestor) continue;
                }

                var cleanText = text.replace(/[\r\n\t]+/g, ' ').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
                var cleanLower = cleanText.toLowerCase();
                var matchesPattern = false;
                for (var p = 0; p < CLICK_PATTERNS.length; p++) {
                    var pat = CLICK_PATTERNS[p];
                    if (!pat) continue;
                    var patLower = pat.toLowerCase();
                    if (cleanLower === patLower || cleanLower.indexOf(patLower) === 0) {
                        matchesPattern = true;
                        matchedPattern = pat;
                        break;
                    }
                }
                if (!matchesPattern) continue;

                if (b.tagName === 'SPAN' && b.classList.contains('cursor-pointer')) {
                    targetBtn = b;
                    break;
                }

                if (b.classList && b.classList.contains('bg-ide-button-background')) {
                    targetBtn = b;
                    break;
                }

                if (isApprovalButton(b)) {
                    targetBtn = b;
                    break;
                }
            }
        }

        // Priority 3: Separate Accept handling (chat-only, approval prompts)
        if (!targetBtn && window._agAcceptChatOnly) {
            var clickables = getAllClickables(document);
            for (var ai = 0; ai < clickables.length; ai++) {
                var ab = clickables[ai];
                if (ab.offsetParent === null && ab.offsetWidth === 0 && ab.offsetHeight === 0) continue;
                if (_clicked.has(ab)) continue;

                // Never click user prompt composer send button
                if (isUserPromptSendButton(ab)) continue;

                var aText = (ab.innerText || ab.textContent || ab.getAttribute('aria-label') || '').trim();
                var aClean = aText.replace(/[\r\n\t]+/g, ' ').replace(/\(.*?\)/g, '').trim();
                var aCleanLower = aClean.toLowerCase();

                // Must start with approval/agreement keywords
                var isAcceptWord = aCleanLower.startsWith('accept') ||
                                   aCleanLower.startsWith('chấp nhận') ||
                                   aCleanLower.startsWith('chấp thuận') ||
                                   aCleanLower.startsWith('đồng ý') ||
                                   aCleanLower.startsWith('agree') ||
                                   aCleanLower.startsWith('confirm') ||
                                   aCleanLower.startsWith('proceed') ||
                                   aCleanLower.startsWith('xác nhận');
                if (!isAcceptWord) continue;

                // Block known editor/bulk accept patterns
                if (/^accept\s+(all|changes|incoming|current|both|combination)/i.test(aClean)) continue;

                // BLOCK: skip if inside editor area
                if (ab.closest && (
                    ab.closest('.editor-scrollable') ||
                    ab.closest('.monaco-diff-editor') ||
                    ab.closest('.view-zones') ||
                    ab.closest('.merge-editor-view') ||
                    ab.closest('[id*="workbench.parts.editor"]')
                )) {
                    continue;
                }

                // Skip diff hunk buttons by CSS class
                if (ab.classList && (ab.classList.contains('diff-hunk-button') || ab.classList.contains('revert'))) {
                    continue;
                }

                // PASSED all checks → click it
                targetBtn = ab;
                matchedPattern = 'Accept';
                break;
            }
        }

        if (targetBtn) {
            var btnLabel = (targetBtn.innerText || targetBtn.textContent || targetBtn.getAttribute('aria-label') || '').trim();
            try {
                var _lx = new XMLHttpRequest();
                _lx.open('POST', 'http://127.0.0.1:' + AG_HTTP_PORT + '/api/click-log', true);
                _lx.setRequestHeader('Content-Type', 'application/json');
                _lx.timeout = 3000;
                _lx.send(JSON.stringify({ button: btnLabel.substring(0, 100), pattern: matchedPattern }));
            } catch (_e) { }
            console.log("[AG Auto] 🎯 Click: [" + btnLabel + "]");
            _clicked.add(targetBtn);
            simulateClick(targetBtn);
            // Track click in session delta (server will accumulate)
            _agSessionTotal++;
            if (!_agSessionStats[matchedPattern]) _agSessionStats[matchedPattern] = 0;
            _agSessionStats[matchedPattern]++;
            // Also update window display stats immediately
            window._agTotalClicks++;
            if (!window._agClickStats[matchedPattern]) window._agClickStats[matchedPattern] = 0;
            window._agClickStats[matchedPattern]++;
        }
    }, CLICK_INTERVAL_MS);
    window._agToolIntervals.push(autoClick);

    // --- 2. SMART SCROLL: Stick-to-bottom (like Discord/Slack) ---
    var isAutoScrolling = false;
    var _agWasAtBottom = new WeakMap(); // track per-element: was the element at bottom?
    var _agJustScrolled = new WeakSet(); // elements we just scrolled programmatically
    var BOTTOM_THRESHOLD = 150; // pixels from bottom to consider "at bottom"

    var CHAT_SCROLL_SELECTOR = '.antigravity-agent-side-panel, [class*="agent-side-panel"], [class*="chat-panel"], [class*="antigravity"], [id*="antigravity.agent"], [class*="agent"], [class*="chat"], [class*="composer"], .interactive-session, .chat-list, .chat-scrollable';

    // --- 3. AUTO SCROLL (Independent from Auto Click/Accept) ---
    var autoScroll = setInterval(function () {
        if (!window._agScrollEnabled) return;

        var scrollables = Array.from(document.querySelectorAll('*')).filter(function (el) {
            var style = window.getComputedStyle(el);
            var hasScrollbar = el.scrollHeight > el.clientHeight &&
                (style.overflowY === 'auto' || style.overflowY === 'scroll');
            if (!hasScrollbar) return false;
            if (el.tagName === 'TEXTAREA') return false;
            // Only scroll inside chat / agent panel
            var inChatPanel = el.closest(CHAT_SCROLL_SELECTOR);
            if (!inChatPanel) return false;
            return true;
        });

        if (scrollables.length > 0) {
            isAutoScrolling = true;
            scrollables.forEach(function (el) {
                var gap = el.scrollHeight - el.scrollTop - el.clientHeight;
                var wasBottom = _agWasAtBottom.get(el);

                // First time seeing this element — check if currently at bottom
                if (wasBottom === undefined) {
                    wasBottom = gap <= BOTTOM_THRESHOLD;
                    _agWasAtBottom.set(el, wasBottom);
                }

                if (wasBottom) {
                    // User was at bottom → scroll to stay at bottom
                    if (gap > 5) {
                        _agJustScrolled.add(el); // Mark: ignore next scroll event from this element
                        el.scrollTop = el.scrollHeight;
                    }
                }
                // If NOT at bottom, don't scroll — user is reading
            });
            setTimeout(function () { isAutoScrolling = false; }, 200);
        }

    }, SCROLL_INTERVAL_MS);
    window._agToolIntervals.push(autoScroll);

    // --- Track scroll position to update wasAtBottom per element ---
    window._agScrollListener = function (e) {
        var el = e.target;
        if (!el || el.nodeType !== 1) return;
        // Only track scrolling inside chat panel
        if (!el.closest || !el.closest(CHAT_SCROLL_SELECTOR)) return;

        // Skip scroll events caused by our programmatic scrolling
        if (_agJustScrolled.has(el)) {
            _agJustScrolled.delete(el);
            return;
        }
        if (isAutoScrolling) return;

        var gap = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (gap <= BOTTOM_THRESHOLD) {
            // User scrolled back to bottom → resume auto-scroll
            _agWasAtBottom.set(el, true);
        } else {
            // User scrolled up → stop auto-scroll for this element
            _agWasAtBottom.set(el, false);
        }
    };
    window.addEventListener('scroll', window._agScrollListener, true);

    console.log("[AG Auto] 🚀 v4.12 | Live toggle via window._agAutoEnabled | Patterns:", JSON.stringify(CLICK_PATTERNS));
})();
