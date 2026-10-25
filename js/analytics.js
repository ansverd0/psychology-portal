// Загрузка Яндекс.Метрики только после согласия на аналитику.
// До согласия счётчик не подключается и cookie не ставит.
(function () {
    'use strict';

    var COUNTER_ID = 112398882;
    var STORAGE_KEY = 'analytics_consent';

    function readConsent() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function saveConsent(value) {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* приватный режим */ }
    }

    // Вебвизор не должен записывать то, что пользователь печатает в полях
    function protectInputs() {
        var nodes = document.querySelectorAll('input[type="text"], input[type="search"], textarea');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.add('ym-disable-keys');
        }
    }

    function initMetrika() {
        try {
            if (typeof ym !== 'function') return;

            // Сначала помечаем поля, чтобы Вебвизор не записал ввод
            protectInputs();
            if (document.body) {
                new MutationObserver(protectInputs).observe(document.body, { childList: true, subtree: true });
            }

            ym(COUNTER_ID, 'init', {
                ssr: true,
                webvisor: true,
                clickmap: true,
                ecommerce: 'dataLayer',
                referrer: document.referrer,
                url: location.href,
                accurateTrackBounce: true,
                trackLinks: true
            });

            var key = null;
            try { key = localStorage.getItem('research_user_key'); } catch (e) { /* ignore */ }
            if (key) ym(COUNTER_ID, 'userParams', { UserID: key });
        } catch (e) {
            console.warn('⚠️ Метрика не инициализирована:', e.message);
        }
    }

    function loadMetrika() {
        if (window.__metrikaRequested) return;
        window.__metrikaRequested = true;

        (function (m, e, t, r, i, k, a) {
            m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
            m[i].l = 1 * new Date();
            for (var j = 0; j < document.scripts.length; j++) {
                if (document.scripts[j].src === r) return;
            }
            k = e.createElement(t);
            a = e.getElementsByTagName(t)[0];
            k.async = 1;
            k.src = r;
            k.onerror = function () { console.warn('⚠️ Яндекс.Метрика недоступна'); };
            a.parentNode.insertBefore(k, a);
        })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + COUNTER_ID, 'ym');

        if (document.readyState === 'complete') initMetrika();
        else window.addEventListener('load', initMetrika);
    }

    function showBanner() {
        if (document.getElementById('consent-banner')) return;

        var banner = document.createElement('div');
        banner.id = 'consent-banner';
        banner.className = 'consent-banner';
        banner.innerHTML =
            '<div class="consent-banner__text">' +
                'Мы используем Яндекс.Метрику (cookie и обезличенную статистику), чтобы понимать, как используется портал. ' +
                'Аналитика включается только с вашего согласия. <a href="privacy.html">Подробнее</a>' +
            '</div>' +
            '<div class="consent-banner__actions">' +
                '<button type="button" id="consent-accept">Разрешить аналитику</button>' +
                '<button type="button" id="consent-decline" class="secondary">Только необходимое</button>' +
            '</div>';

        document.body.appendChild(banner);

        banner.querySelector('#consent-accept').addEventListener('click', function () {
            saveConsent('granted');
            banner.remove();
            loadMetrika();
        });

        banner.querySelector('#consent-decline').addEventListener('click', function () {
            saveConsent('denied');
            banner.remove();
        });
    }

    // Публичный мини-API: другие модули (vitals.js) не знают номер счётчика и правила согласия
    window.PsyAnalytics = {
        counterId: COUNTER_ID,
        hasConsent: function () { return readConsent() === 'granted'; },
        trackVitals: function (metrics, goalName) {
            if (readConsent() !== 'granted' || typeof ym !== 'function') return false;
            try {
                ym(COUNTER_ID, 'params', metrics);
                if (goalName) ym(COUNTER_ID, 'reachGoal', goalName, metrics);
                return true;
            } catch (e) {
                return false;
            }
        }
    };

    var choice = readConsent();

    if (choice === 'granted') {
        loadMetrika();
    } else if (choice !== 'denied') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
        else showBanner();
    }
})();
