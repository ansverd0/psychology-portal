// Журнал поведения для исследования: страницы, время, прокрутка, переключения вкладок.
// Пишет только при наличии анонимного ключа и только на учебных страницах (не на опросе).
// Отправка — пакетами через RPC log_events; при обрыве события ждут в localStorage.

(function () {
    'use strict';

    var PAGE = (document.body && document.body.dataset.page) || '';
    if (!PAGE || PAGE === 'survey') return;

    var key = null;
    try { key = localStorage.getItem('research_user_key'); } catch (e) { return; }
    if (!key) return;
    if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') return;

    var SESSION_STORE = 'hub_tracker_session';
    var QUEUE_STORE = 'hub_tracker_queue';
    var MAX_QUEUE = 300;
    var GAP_MS = 30 * 60 * 1000;

    var queue = [];
    var session = null;
    var visibleSince = 0;
    var visibleMs = 0;
    var hiddenAt = 0;
    var maxScroll = 0;
    var flushTimer = null;

    function nowIso() {
        return new Date().toISOString();
    }

    function readSession() {
        var raw = null;
        try { raw = localStorage.getItem(SESSION_STORE); } catch (e) { /* ignore */ }
        var parsed = null;
        if (raw) {
            try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
        }
        if (!parsed || !parsed.id || !parsed.last || Date.now() - parsed.last > GAP_MS) {
            parsed = { id: makeId(), last: Date.now() };
        }
        return parsed;
    }

    function makeId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function touchSession() {
        session.last = Date.now();
        try { localStorage.setItem(SESSION_STORE, JSON.stringify(session)); } catch (e) { /* ignore */ }
    }

    function readQueue() {
        var raw = null;
        try { raw = localStorage.getItem(QUEUE_STORE); } catch (e) { return []; }
        if (!raw) return [];
        try {
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
        } catch (e) {
            return [];
        }
    }

    function persistQueue() {
        try {
            localStorage.setItem(QUEUE_STORE, JSON.stringify(queue.slice(-MAX_QUEUE)));
        } catch (e) { /* приватный режим */ }
    }

    function push(event, meta, dwell, scroll) {
        var item = { page: PAGE, event: event, ts: nowIso() };
        if (dwell != null) item.dwell_ms = Math.round(dwell);
        if (scroll != null) item.scroll_pct = Math.max(0, Math.min(100, Math.round(scroll)));
        if (meta && typeof meta === 'object') item.meta = meta;
        queue.push(item);
        touchSession();
        if (queue.length >= 20) flush(false);
        scheduleFlush();
    }

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(function () {
            flushTimer = null;
            flush(false);
        }, 15000);
    }

    function flush(useKeepalive) {
        if (!queue.length) return;
        var batch = queue.splice(0, 100);
        var url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/log_events';
        var body = JSON.stringify({ p_key: key, p_session: session.id, p_events: batch });

        fetch(url, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: body,
            keepalive: Boolean(useKeepalive)
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (queue.length) scheduleFlush();
        }).catch(function () {
            queue = batch.concat(queue).slice(-MAX_QUEUE);
            persistQueue();
        });
    }

    function trackScroll() {
        var doc = document.documentElement;
        var height = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
        if (height <= window.innerHeight) {
            maxScroll = 100;
            return;
        }
        var pct = ((window.scrollY || doc.scrollTop || 0) + window.innerHeight) / height * 100;
        if (pct > maxScroll) maxScroll = pct;
    }

    function pageLeave() {
        if (visibleSince) {
            visibleMs += Date.now() - visibleSince;
            visibleSince = 0;
        }
        if (visibleMs > 0) {
            trackScroll();
            push('page_leave', null, visibleMs, maxScroll);
            visibleMs = 0;
        }
        flush(true);
    }

    function onVisibility() {
        if (document.visibilityState === 'hidden') {
            pageLeave();
            hiddenAt = Date.now();
        } else {
            visibleSince = Date.now();
            if (hiddenAt) {
                push('tab_switch', { away_ms: Date.now() - hiddenAt });
                hiddenAt = 0;
            }
        }
    }

    function start() {
        session = readSession();
        queue = readQueue();
        visibleSince = document.visibilityState === 'hidden' ? 0 : Date.now();
        trackScroll();

        push('page_view', { referrer: document.referrer ? 1 : 0 });
        if (queue.length) flush(false);

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', pageLeave);
        window.addEventListener('pageshow', function (event) {
            if (event.persisted && document.visibilityState !== 'hidden') {
                visibleSince = Date.now();
            }
        });
        window.addEventListener('scroll', trackScroll, { passive: true });
        window.addEventListener('resize', trackScroll, { passive: true });
    }

    window.PsyTracker = {
        event: function (name, meta) { push(name, meta); },
        flush: function () { flush(false); },
        session: function () { return session ? session.id : null; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
