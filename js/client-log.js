// ==========================================================================
// КЛИЕНТСКИЙ ЖУРНАЛ (client-log.js)
// Ловит ошибки, отказы сети и этапы загрузки, держит последние 80 записей
// в localStorage и отдаёт их файлом/буфером обмена.
//
//   window.hubLog.dump()    — текст журнала
//   window.hubLog.clear()   — очистить
//   window.hubLog.show()    — открыть панель
//
// Подключается ДО supabase.js: обёртка fetch должна встать раньше клиента БД.
// ==========================================================================
(function () {
    if (window.hubLog) return;

    const KEY = 'hub_client_log';
    const MAX = 80;
    const started = Date.now();
    let entries = [];
    let memoryOnly = false;

    try {
        const raw = localStorage.getItem(KEY);
        if (raw) entries = JSON.parse(raw) || [];
    } catch (e) {
        memoryOnly = true;
    }

    function persist() {
        if (memoryOnly) return;
        try {
            localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)));
        } catch (e) {
            memoryOnly = true;
        }
    }

    function add(type, msg, extra) {
        const entry = { t: new Date().toISOString(), type: String(type), msg: String(msg || '').slice(0, 500) };
        if (extra) entry.extra = extra;
        entries.push(entry);
        if (entries.length > MAX) entries = entries.slice(-MAX);
        persist();
        document.dispatchEvent(new CustomEvent('hub:log', { detail: entry }));
        return entry;
    }

    function env() {
        const sw = navigator.serviceWorker && navigator.serviceWorker.controller
            ? navigator.serviceWorker.controller.scriptURL.split('/').pop()
            : 'нет';
        return {
            page: location.pathname + location.search,
            screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}`,
            online: navigator.onLine,
            ua: navigator.userAgent,
            sw
        };
    }

    function dump() {
        const e = env();
        const head = [
            'Диагностика портала «Психология образования»',
            'Время: ' + new Date().toISOString(),
            'Страница: ' + e.page,
            'Экран: ' + e.screen,
            'Онлайн: ' + e.online,
            'Service Worker: ' + e.sw,
            'Браузер: ' + e.ua,
            'Состояние: ' + (document.readyState || '?'),
            'Записей: ' + entries.length,
            ''
        ];
        const body = entries.map((x) => {
            const time = x.t.slice(11, 23);
            let line = `${time}  ${x.type.padEnd(9)} ${x.msg}`;
            if (x.extra && Object.keys(x.extra).length) line += '  ' + JSON.stringify(x.extra);
            return line;
        });
        return head.concat(body).join('\n');
    }

    function clear() {
        entries = [];
        persist();
        render();
        add('log', 'журнал очищен');
    }

    // --- обёртка fetch: фиксируем только сбои и ошибки БД -------------------
    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    if (nativeFetch) {
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const watch = url.includes('supabase.co');
            return nativeFetch(input, init).then(
                (res) => {
                    if (watch && !res.ok) {
                        add('http', 'ответ ' + res.status, { url: url.split('?')[0] });
                    }
                    return res;
                },
                (err) => {
                    add('fetch', (err && err.name) || 'error', {
                        url: url.split('?')[0],
                        msg: String((err && err.message) || err).slice(0, 160)
                    });
                    throw err;
                }
            );
        };
    }

    window.addEventListener('error', (e) => {
        if (e && e.message) {
            add('error', e.message, { file: (e.filename || '').split('/').pop(), line: e.lineno, col: e.colno });
        } else if (e && e.target && e.target.tagName) {
            add('resource', e.target.tagName.toLowerCase() + ' не загрузился', { src: (e.target.src || '').split('/').pop() });
        }
    }, true);

    window.addEventListener('unhandledrejection', (e) => {
        const r = e && e.reason;
        add('rejection', String((r && (r.message || r)) || r).slice(0, 300));
    });

    window.addEventListener('offline', () => add('net', 'браузер сообщил: офлайн'));
    window.addEventListener('online', () => add('net', 'браузер сообщил: онлайн'));

    window.addEventListener('load', () => {
        add('load', 'страница загружена', { ms: Date.now() - started });
        // Страховка: если через 8 с опрос так и не отрисовался — сами предлагаем лог
        setTimeout(() => {
            const app = document.getElementById('survey-app');
            if (app && app.children.length === 0) {
                add('boot', 'опрос не отрисовался за 8 секунд');
                show(true);
            }
        }, 8000);
    });

    add('boot', 'старт страницы', env());

    // --- панель диагностики -------------------------------------------------
    let panel = null;

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function render() {
        if (!panel) return;
        const pre = panel.querySelector('.diag-panel__log');
        if (pre) pre.textContent = dump();
    }

    function download() {
        const blob = new Blob([dump()], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'psy-diagnostika-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 1000);
    }

    async function copy() {
        const text = dump();
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const ta = el('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (err) { /* остаётся скачивание */ }
            ta.remove();
        }
        const btn = panel && panel.querySelector('[data-diag-copy]');
        if (btn) {
            const old = btn.textContent;
            btn.textContent = 'Скопировано';
            setTimeout(() => { btn.textContent = old; }, 1500);
        }
    }

    function close() {
        if (panel) panel.hidden = true;
    }

    function show(force) {
        if (!panel) build();
        if (panel.hidden) {
            panel.hidden = false;
            render();
        } else if (!force) {
            close();
        }
    }

    function build() {
        panel = el('div', 'diag-panel');
        panel.id = 'diag-panel';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-label', 'Диагностика страницы');

        const head = el('div', 'diag-panel__head');
        head.appendChild(el('strong', 'diag-panel__title', 'Диагностика'));
        const x = el('button', 'diag-panel__x', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Закрыть диагностику');
        x.addEventListener('click', close);
        head.appendChild(x);

        const pre = el('pre', 'diag-panel__log');
        pre.setAttribute('tabindex', '0');

        const actions = el('div', 'diag-panel__actions');
        const mk = (label, fn, cls) => {
            const b = el('button', 'diag-btn' + (cls ? ' ' + cls : ''), label);
            b.type = 'button';
            b.addEventListener('click', fn);
            actions.appendChild(b);
            return b;
        };
        const copyBtn = mk('Скопировать', copy);
        copyBtn.dataset.diagCopy = '1';
        mk('Скачать .txt', download);
        mk('Очистить', clear, 'diag-btn--ghost');

        panel.appendChild(head);
        panel.appendChild(pre);
        panel.appendChild(actions);
        document.body.appendChild(panel);
    }

    function mount() {
        if (document.body.dataset.page !== 'survey') return;
        // Кнопку «Диагностика» в интерфейсе не показываем: журнал доступен
        // через window.hubLog и открывается сам, если опрос не отрисовался
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel && !panel.hidden) close();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    window.hubLog = { add, dump, clear, show, close };
})();
