// Web Vitals: LCP, CLS, INP (+ FCP и TTFB) без внешних зависимостей.
// Что делает:
//   1) пишет запись в localStorage `hub_web_vitals` (последние 20 загрузок) — свой лог;
//   2) выводит её в консоль (info) — удобно смотреть в DevTools;
//   3) при согласии на аналитику отправляет метрики в Яндекс.Метрику через PsyAnalytics.
// Отправка не блокирует страницу и не выполняется до согласия.
(function () {
    'use strict';

    var STORAGE_KEY = 'hub_web_vitals';
    var MAX_ENTRIES = 20;
    var METRIKA_GOAL = 'web_vitals';

    var metrics = { lcp: 0, cls: 0, inp: 0, fcp: 0, ttfb: 0 };
    var clsValue = 0;
    var clsSessionValue = 0;
    var clsSessionStart = 0;
    var clsLastEntry = 0;
    var inpValue = 0;
    var reported = false;

    function isSupported() {
        return typeof window.PerformanceObserver === 'function' && window.performance;
    }

    function round(value, digits) {
        var factor = Math.pow(10, digits || 0);
        return Math.round(value * factor) / factor;
    }

    // TTFB: от начала запроса до первого байта ответа
    function readTtfb() {
        try {
            var nav = performance.getEntriesByType('navigation')[0];
            if (nav && nav.responseStart > 0) metrics.ttfb = Math.max(0, Math.round(nav.responseStart));
        } catch (e) { /* ignore */ }
    }

    // FCP: первая отрисовка контента
    function watchPaint() {
        try {
            new PerformanceObserver(function (list) {
                for (var i = 0; i < list.getEntries().length; i++) {
                    var entry = list.getEntries()[i];
                    if (entry.name === 'first-contentful-paint') {
                        metrics.fcp = Math.round(entry.startTime);
                    }
                }
            }).observe({ type: 'paint', buffered: true });
        } catch (e) { /* ignore */ }
    }

    // LCP: самый крупный элемент первого экрана (берём последнюю запись)
    function watchLcp() {
        try {
            new PerformanceObserver(function (list) {
                var entries = list.getEntries();
                var last = entries[entries.length - 1];
                if (last) metrics.lcp = Math.round(last.startTime);
            }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (e) { /* ignore */ }
    }

    // CLS: сумма сдвигов в худшем «окне» (окна по 1 с, не дольше 5 с)
    function watchCls() {
        try {
            new PerformanceObserver(function (list) {
                for (var i = 0; i < list.getEntries().length; i++) {
                    var entry = list.getEntries()[i];
                    if (entry.hadRecentInput) continue;

                    var gap = entry.startTime - clsLastEntry;
                    if (clsSessionStart && gap < 1000 && entry.startTime - clsSessionStart < 5000) {
                        clsSessionValue += entry.value;
                    } else {
                        clsSessionValue = entry.value;
                        clsSessionStart = entry.startTime;
                    }
                    clsLastEntry = entry.startTime;
                    if (clsSessionValue > clsValue) clsValue = clsSessionValue;
                }
                metrics.cls = round(clsValue, 4);
            }).observe({ type: 'layout-shift', buffered: true });
        } catch (e) { /* ignore */ }
    }

    // INP: худшая по длительности интеракция (приближение через Event Timing)
    function watchInp() {
        try {
            new PerformanceObserver(function (list) {
                for (var i = 0; i < list.getEntries().length; i++) {
                    var entry = list.getEntries()[i];
                    if (entry.duration > inpValue) inpValue = entry.duration;
                }
                metrics.inp = Math.round(inpValue);
            }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
        } catch (e) {
            // Старые браузеры: хотя бы первая интеракция
            try {
                new PerformanceObserver(function (list) {
                    var entries = list.getEntries();
                    var first = entries[0];
                    if (first && first.processingStart >= 0) {
                        inpValue = first.duration;
                        metrics.inp = Math.round(inpValue);
                    }
                }).observe({ type: 'first-input', buffered: true });
            } catch (e2) { /* ignore */ }
        }
    }

    function pageName() {
        var page = document.body && document.body.dataset ? document.body.dataset.page : '';
        if (page) return page;
        var file = location.pathname.split('/').pop() || 'index.html';
        return file.replace(/\.html$/, '') || 'index';
    }

    function collect() {
        var payload = {
            page: pageName(),
            lcp: Math.round(metrics.lcp),
            cls: round(clsValue, 4),
            inp: Math.round(metrics.inp),
            fcp: Math.round(metrics.fcp),
            ttfb: Math.round(metrics.ttfb),
            viewport: window.innerWidth + 'x' + window.innerHeight,
            conn: (navigator.connection && navigator.connection.effectiveType) || '',
            ts: new Date().toISOString()
        };
        return payload;
    }

    function appendLocalLog(payload) {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            var log = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(log)) log = [];
            log.push(payload);
            if (log.length > MAX_ENTRIES) log = log.slice(log.length - MAX_ENTRIES);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
        } catch (e) { /* приватный режим или переполнение */ }
    }

    function sendToMetrika(payload) {
        // Метрика отправляется только при явном согласии; PsyAnalytics объявлен в analytics.js
        var analytics = window.PsyAnalytics;
        if (!analytics || typeof analytics.trackVitals !== 'function') return false;
        try {
            return analytics.trackVitals(payload, METRIKA_GOAL);
        } catch (e) {
            return false;
        }
    }

    function report() {
        if (reported) return;
        reported = true;

        var payload = collect();
        appendLocalLog(payload);

        try {
            console.info(
                '[vitals] ' + payload.page +
                ' · LCP ' + payload.lcp + 'мс' +
                ' · CLS ' + payload.cls +
                ' · INP ' + payload.inp + 'мс' +
                ' · FCP ' + payload.fcp + 'мс' +
                ' · TTFB ' + payload.ttfb + 'мс'
            );
        } catch (e) { /* ignore */ }

        sendToMetrika(payload);
    }

    function init() {
        readTtfb();
        watchPaint();
        watchLcp();
        watchCls();
        watchInp();

        // pagehide надёжнее unload и работает с bfcache; visibilitychange — фолбек
        window.addEventListener('pagehide', report);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') report();
        });
    }

    // Публичный мини-API для ручной проверки в консоли
    window.hubVitals = {
        latest: function () {
            try {
                var log = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                return log.length ? log[log.length - 1] : null;
            } catch (e) { return null; }
        },
        log: function () {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
        },
        clear: function () {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        }
    };

    if (!isSupported()) return;
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
