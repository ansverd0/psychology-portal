// ==========================================================================
// ЖИВОЙ ПОИСК ПО НАЗВАНИЯМ (live-search.js)
// Один компонент для tickets.html и sections.html: поле, выпадашка, клавиатура.
// Поиск только по названиям вопросов/статей — по решению автора (U2-07).
//
//   const search = attachLiveSearch({
//       inputId, resultsId,
//       source: () => [{ title, label, category, payload }],
//       onPick: (item) => {}
//   });
//   search.refresh();  // после обновления данных
// ==========================================================================
(function () {
    const MIN_CHARS = 2;
    const MAX_RESULTS = 30;

    function normalize(value) {
        return String(value || '').toLowerCase().replace(/ё/g, 'е').trim();
    }

    function attachLiveSearch(options) {
        const input = document.getElementById(options.inputId);
        const box = document.getElementById(options.resultsId);
        if (!input || !box) return null;
        if (input.__liveSearch) return input.__liveSearch;

        let matches = [];
        let active = -1;
        let timer = null;

        box.setAttribute('role', 'listbox');
        box.hidden = true;
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', box.id);

        function close() {
            box.hidden = true;
            box.innerHTML = '';
            input.classList.remove('open-dropdown');
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            matches = [];
            active = -1;
        }

        function itemNode(item, index) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-suggest-item';
            btn.id = box.id + '-opt-' + index;
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', 'false');

            if (item.category) {
                const cat = document.createElement('span');
                cat.className = 'search-suggest-category';
                cat.textContent = item.category;
                btn.appendChild(cat);
            }

            const strong = document.createElement('strong');
            strong.textContent = item.label || item.title;
            btn.appendChild(strong);

            btn.addEventListener('click', () => pick(item));
            btn.addEventListener('mousemove', () => setActive(index));
            return btn;
        }

        function note(text) {
            const div = document.createElement('div');
            div.className = 'search-empty';
            div.textContent = text;
            return div;
        }

        function render(query) {
            const q = normalize(query);
            box.innerHTML = '';
            matches = [];
            active = -1;

            if (q.length < MIN_CHARS) {
                box.appendChild(note('Введите минимум ' + MIN_CHARS + ' символа'));
                open();
                return;
            }

            const all = options.source() || [];
            matches = all
                .filter((item) => normalize(item.title).includes(q))
                .slice(0, MAX_RESULTS);

            if (!matches.length) {
                box.appendChild(note('Ничего не найдено. Поиск идёт по названию.'));
                open();
                return;
            }

            const summary = document.createElement('div');
            summary.className = 'search-summary';
            summary.textContent = matches.length === MAX_RESULTS
                ? 'Первые ' + MAX_RESULTS + ' результатов'
                : 'Найдено: ' + matches.length;
            box.appendChild(summary);

            matches.forEach((item, i) => box.appendChild(itemNode(item, i)));
            open();
        }

        function open() {
            box.hidden = false;
            input.classList.add('open-dropdown');
            input.setAttribute('aria-expanded', 'true');
        }

        function setActive(index) {
            if (index < 0 || index >= matches.length) return;
            active = index;
            [...box.querySelectorAll('.search-suggest-item')].forEach((node, i) => {
                const on = i === index;
                node.classList.toggle('is-active', on);
                node.setAttribute('aria-selected', on ? 'true' : 'false');
                if (on) {
                    input.setAttribute('aria-activedescendant', node.id);
                    node.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        function pick(item) {
            if (!item) return;
            input.value = item.label || item.title;
            close();
            if (typeof options.onPick === 'function') options.onPick(item);
        }

        function run() {
            render(input.value);
        }

        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(run, 150);
        });

        input.addEventListener('focus', () => {
            if (input.value.trim().length >= MIN_CHARS) run();
        });

        input.addEventListener('keydown', (e) => {
            if (box.hidden && (e.key === 'ArrowDown' || e.key === 'Enter')) {
                if (input.value.trim().length >= MIN_CHARS) run();
                return;
            }
            if (e.key === 'Escape') {
                close();
                input.blur();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.min(active + 1, matches.length - 1));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(active - 1, 0));
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                pick(matches[active >= 0 ? active : 0]);
            }
        });

        document.addEventListener('click', (e) => {
            if (!box.hidden && !input.contains(e.target) && !box.contains(e.target)) close();
        });

        window.addEventListener('resize', close);

        const api = {
            refresh() {
                if (input.value.trim().length >= MIN_CHARS) run();
            },
            close
        };
        input.__liveSearch = api;
        return api;
    }

    window.attachLiveSearch = attachLiveSearch;
})();
