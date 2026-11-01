// Страница опроса: ШАМ (28) + ССПМ (46), по блокам, с черновиком и отправкой в Supabase.
// Зависит от js/survey-data.js и supabaseClient из js/supabase-config.js.

(function () {
    'use strict';

    var KEY_STORE = 'research_user_key';
    var DRAFT_PREFIX = 'hub_survey_draft_v1:';
    var app = document.getElementById('survey-app');

    var INSTRUMENTS = {
        sham: { items: SHAM_ITEMS, options: SHAM_OPTIONS, title: 'Учебная мотивация', intro: 'Почему Вы в настоящее время ходите на занятия в университет?' },
        sspm: { items: SSPM_ITEMS, options: SSPM_OPTIONS, title: 'Саморегуляция', intro: 'Оцените, насколько каждое высказывание описывает Ваше обычное поведение.' }
    };

    var state = {
        key: null,
        group: null,
        course: null,
        answers: { sham: {}, sspm: {} },
        plan: [],
        step: 0,
        startedAt: { sham: 0, sspm: 0 },
        submitted: { sham: false, sspm: false },
        busy: false
    };

    // ---------- утилиты ----------

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function clearApp() {
        while (app.firstChild) app.removeChild(app.firstChild);
        app.removeAttribute('aria-busy');
    }

    function card(title, text) {
        var box = make('div', 'sv-card');
        if (title) box.appendChild(make('h2', null, title));
        if (text) box.appendChild(make('p', null, text));
        return box;
    }

    function showError(node, message) {
        node.textContent = message || '';
        node.hidden = !message;
    }

    function draftKey() {
        return DRAFT_PREFIX + state.key;
    }

    function saveDraft() {
        if (!state.key) return;
        try {
            localStorage.setItem(draftKey(), JSON.stringify({ group: state.group, answers: state.answers }));
        } catch (e) { /* приватный режим */ }
    }

    function loadDraft() {
        try {
            var raw = localStorage.getItem(draftKey());
            if (!raw) return;
            var parsed = JSON.parse(raw);
            if (parsed && parsed.answers) {
                state.answers = {
                    sham: parsed.answers.sham || {},
                    sspm: parsed.answers.sspm || {}
                };
            }
        } catch (e) { /* битый черновик игнорируем */ }
    }

    function rpc(name, params, timeoutMs) {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) {
            return Promise.reject(new Error('Сервер недоступен. Проверьте соединение и обновите страницу.'));
        }

        var query = supabaseClient.rpc(name, params);
        var timer = null;

        // Свой таймаут на конкретный вызов: если сеть «черная дыра» (запрос висит
        // без ответа), не держим человека перед «Загрузкой…» дольше 6 секунд.
        if (typeof AbortController !== 'undefined' && typeof query.abortSignal === 'function') {
            var controller = new AbortController();
            query = query.abortSignal(controller.signal);
            var limit = timeoutMs || 6000;
            timer = setTimeout(function () {
                if (window.hubLog) {
                    window.hubLog.add('net', 'RPC ' + name + ': нет ответа за ' + Math.round(limit / 1000) + ' с');
                }
                controller.abort();
            }, limit);
        }

        return query.then(function (res) {
            if (res.error) throw new Error(res.error.message || 'Ошибка сервера');
            return res.data;
        }).then(function (data) {
            if (timer) clearTimeout(timer);
            return data;
        }, function (error) {
            if (timer) clearTimeout(timer);
            throw error;
        });
    }

    function setBusy(flag) {
        state.busy = flag;
        if (flag) app.setAttribute('aria-busy', 'true');
        else app.removeAttribute('aria-busy');
        var buttons = app.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = flag;
    }

    // ---------- ключ ----------

    function renderKeyGate(message) {
        clearApp();
        var box = card('Анонимный ключ', 'Опрос сохраняется под анонимным ключом — без имени, почты и номера группы в открытом виде. Ключ можно ввести на любом устройстве.');
        if (message) box.appendChild(make('p', 'sv-error', message));

        var chkLabel = make('label', 'sv-check');
        var chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = 'sv-consent';
        chkLabel.appendChild(chk);
        var chkText = make('span');
        chkText.innerHTML = 'Я ознакомлен(а) с <a href="privacy.html" target="_blank" rel="noopener">политикой обработки данных</a> и даю согласие на участие в исследовании.';
        chkLabel.appendChild(chkText);
        box.appendChild(chkLabel);

        var err = make('p', 'sv-error');
        err.hidden = true;
        box.appendChild(err);

        var btn = make('button', 'sv-btn sv-btn--primary', 'Сгенерировать ключ и продолжить');
        btn.type = 'button';
        btn.style.width = '100%';
        box.appendChild(btn);

        var divider = make('p', 'sv-muted', 'или, если ключ уже есть:');
        divider.style.marginTop = '18px';
        box.appendChild(divider);

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'например, зелёный-кедр-77';
        input.className = 'sv-input';
        input.style.cssText = 'width:100%;box-sizing:border-box;min-height:46px;padding:10px 12px;border:2px solid #cbd5e0;border-radius:10px;font-size:15px;';
        box.appendChild(input);

        var loginBtn = make('button', 'sv-btn', 'Войти по ключу');
        loginBtn.type = 'button';
        loginBtn.style.width = '100%';
        loginBtn.style.marginTop = '10px';
        box.appendChild(loginBtn);

        // Частая причина «не открывается» — приватный DNS/блокировщик рекламы,
        // который режет supabase.co (подтверждено логом с телефона, U2-17)
        var dnsNote = make('p', 'sv-muted', 'Если вопросы не открываются: проверьте приватный DNS (AdGuard, NextDNS и подобные) и блокировщики рекламы — они могут блокировать сервер исследования. Помогает отключить фильтр или включить VPN.');
        dnsNote.style.marginTop = '14px';
        box.appendChild(dnsNote);

        btn.addEventListener('click', function () {
            if (!chk.checked) {
                showError(err, 'Отметьте согласие — без него ключ не создаётся.');
                chk.focus();
                return;
            }
            showError(err, null);
            createKey(btn, err);
        });

        loginBtn.addEventListener('click', function () {
            var value = input.value.trim().toLowerCase();
            if (!value) {
                showError(err, 'Введите ключ.');
                input.focus();
                return;
            }
            if (!chk.checked) {
                showError(err, 'Отметьте согласие — без него участие невозможно.');
                chk.focus();
                return;
            }
            showError(err, null);
            loginKey(value, err);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') loginBtn.click();
        });

        app.appendChild(box);
        btn.focus();
    }

    function createKey(btn, err) {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) {
            showError(err, 'Сервер недоступен. Попробуйте позже.');
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Создаём ключ…';
        var attempt = 0;

        function tryInsert() {
            attempt++;
            var key = makeKey();
            supabaseClient.from('users_profiles').insert([{ user_key: key }]).then(function (res) {
                if (!res.error) return done(key);
                if (res.error.code === '23505' && attempt < 5) return tryInsert();
                throw res.error;
            }).catch(function () {
                showError(err, 'Не удалось создать ключ. Проверьте соединение (если сеть блокирует сервер — включите VPN) и попробуйте ещё раз.');
                btn.disabled = false;
                btn.textContent = 'Сгенерировать ключ и продолжить';
            });
        }

        function done(key) {
            localStorage.setItem(KEY_STORE, key);
            state.key = key;
            loadDraft();
            loadRemoteState();
        }

        tryInsert();
    }

    function makeKey() {
        var colors = ['зеленый', 'синий', 'красный', 'желтый', 'белый', 'серый', 'черный', 'быстрый', 'тихий', 'умный'];
        var objects = ['кедр', 'клен', 'орел', 'барс', 'ручей', 'маяк', 'шторм', 'ветер', 'филин', 'камень'];
        var n = Math.floor(Math.random() * 90) + 10;
        return colors[Math.floor(Math.random() * colors.length)] + '-' +
            objects[Math.floor(Math.random() * objects.length)] + '-' + n;
    }

    function loginKey(value, err) {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) {
            showError(err, 'Сервер недоступен. Попробуйте позже.');
            return;
        }
        supabaseClient.from('users_profiles').select('user_key').eq('user_key', value).maybeSingle()
            .then(function (res) {
                if (res.error) throw res.error;
                if (!res.data) {
                    showError(err, 'Такой ключ не найден. Проверьте написание.');
                    return;
                }
                localStorage.setItem(KEY_STORE, res.data.user_key);
                state.key = res.data.user_key;
                loadDraft();
                loadRemoteState();
            })
            .catch(function () {
                showError(err, 'Не удалось проверить ключ. Проверьте соединение (если сеть блокирует сервер — включите VPN) и попробуйте ещё раз.');
            });
    }

    // ---------- загрузка состояния ----------

    function loadRemoteState() {
        clearApp();
        app.appendChild(card('Загрузка…', 'Проверяем, что уже пройдено.'));

        rpc('survey_state', { p_key: state.key }, 6000).then(function (data) {
            state.group = data.group_code || null;
            state.course = data.course || null;
            state.submitted.sham = Boolean(data.sham_done);
            state.submitted.sspm = Boolean(data.sspm_done);

            if (state.submitted.sham && state.submitted.sspm) {
                renderDone();
                return;
            }
            buildPlan();
            renderIntro();
        }).catch(function (e) {
            console.warn(e);
            var text = String((e && e.message) || '');
            if (/unknown user_key/i.test(text)) {
                localStorage.removeItem(KEY_STORE);
                state.key = null;
                renderKeyGate('Ключ не найден на сервере. Создайте новый или проверьте написание.');
                return;
            }

            var timedOut = (e && e.name === 'AbortError') || /abort|signal/i.test(text);
            clearApp();
            var box = card(
                timedOut ? 'Сервер исследования не отвечает' : 'Не удалось загрузить',
                timedOut
                    ? 'Запрос к серверу данных не прошёл за 6 секунд — похоже, его блокирует сеть, приватный DNS (AdGuard и подобные) или блокировщик рекламы. Ключ и черновик сохранены на этом устройстве.'
                    : 'Сервер не ответил. Проверьте соединение — ответы никуда не делись.'
            );
            box.setAttribute('data-survey-offline', '');

            if (timedOut) {
                box.appendChild(make('p', 'sv-muted', 'Если VPN нет — отключите приватный DNS/блокировщик или откройте страницу позже с другой сети: ключ останется в этом браузере.'));
            }

            var retry = make('button', 'sv-btn sv-btn--primary', 'Повторить');
            retry.type = 'button';
            retry.style.width = '100%';
            retry.addEventListener('click', loadRemoteState);
            box.appendChild(retry);
            app.appendChild(box);

            // Браузер сообщил, что сеть появилась, — пробуем ещё раз сами
            if (!state.retryOnReconnect) {
                state.retryOnReconnect = true;
                window.addEventListener('online', function () {
                    state.retryOnReconnect = false;
                    loadRemoteState();
                }, { once: true });
            }
        });
    }

    function buildPlan() {
        var shamBlocks = [];
        var sspmBlocks = [];
        var i;
        for (i = 0; i < SHAM_ITEMS.length; i += 10) {
            shamBlocks.push({ instrument: 'sham', from: i, to: Math.min(i + 10, SHAM_ITEMS.length) });
        }
        for (i = 0; i < SSPM_ITEMS.length; i += 10) {
            sspmBlocks.push({ instrument: 'sspm', from: i, to: Math.min(i + 10, SSPM_ITEMS.length) });
        }
        state.plan = (state.submitted.sham ? [] : shamBlocks).concat(state.submitted.sspm ? [] : sspmBlocks);
        state.step = 0;
        for (var s = 0; s < state.plan.length; s++) {
            if (missingInBlock(state.plan[s]).length) {
                state.step = s;
                break;
            }
        }
    }

    // ---------- вступление ----------

    function renderIntro() {
        clearApp();
        var box = card('Опрос об учебной мотивации и саморегуляции');
        box.appendChild(make('p', null, 'Исследование самостоятельной учебной деятельности студентов-психологов ПетрГУ. Две методики, 74 утверждения, около 10 минут. Один раз, без правильных ответов.'));
        box.appendChild(make('p', 'sv-muted', 'Ответы сохраняются под вашим анонимным ключом. Промежуточные ответы не теряются: если закрыть страницу, можно продолжить с этого места.'));

        var groupBlock = make('div', 'sv-field');
        var label = make('label', null, 'Ваша группа');
        label.setAttribute('for', 'sv-group');
        var select = document.createElement('select');
        select.id = 'sv-group';
        select.appendChild(new Option('Выберите группу', ''));
        // Сортировка по направлениям, внутри — по курсу: психология → 821, 831, 841
        // (раунд 4). Список плоский по коду 821, 822, 823… читался как каша.
        groupOptionsByProgram().forEach(function (program) {
            var optgroup = document.createElement('optgroup');
            optgroup.label = program.name;
            program.groups.forEach(function (g) {
                optgroup.appendChild(new Option(g.code + ' — ' + g.course + ' курс, ' + g.program, g.code));
            });
            select.appendChild(optgroup);
        });
        if (state.group) select.value = state.group;
        groupBlock.appendChild(label);
        groupBlock.appendChild(select);
        box.appendChild(groupBlock);

        var err = make('p', 'sv-error');
        err.hidden = true;
        box.appendChild(err);

        var start = make('button', 'sv-btn sv-btn--primary', 'Начать опрос');
        start.type = 'button';
        start.style.width = '100%';
        box.appendChild(start);

        start.addEventListener('click', function () {
            var value = select.value;
            if (!value) {
                showError(err, 'Выберите группу — она нужна для сравнения по курсам.');
                select.focus();
                return;
            }
            showError(err, null);
            setBusy(true);
            rpc('set_group', { p_key: state.key, p_group: value }).then(function () {
                state.group = value;
                var found = SURVEY_GROUPS.filter(function (g) { return g.code === value; })[0];
                state.course = found ? found.course : null;
                saveDraft();
                setBusy(false);
                renderBlock();
            }).catch(function () {
                setBusy(false);
                showError(err, 'Не удалось сохранить группу. Проверьте соединение.');
            });
        });

        app.appendChild(box);
    }

    // ---------- блоки вопросов ----------

    function currentBlock() {
        return state.plan[state.step];
    }

    function totalAnswered(instrument) {
        return Object.keys(state.answers[instrument]).length;
    }

    function renderBlock() {
        clearApp();
        var block = currentBlock();
        if (!block) {
            renderDone();
            return;
        }
        var instrument = INSTRUMENTS[block.instrument];
        var total = state.plan.length;
        state.startedAt[block.instrument] = state.startedAt[block.instrument] || Date.now();

        var progress = make('div', 'sv-progress');
        var row = make('div', 'sv-progress__row');
        row.appendChild(make('span', null, 'Шаг ' + (state.step + 1) + ' из ' + total));
        row.appendChild(make('span', null, 'Вопросы ' + (block.from + 1) + '–' + block.to + ' из ' + instrument.items.length));
        progress.appendChild(row);
        var bar = make('div', 'sv-bar');
        var fill = make('div', 'sv-bar__fill');
        fill.style.width = Math.round(((state.step + 1) / total) * 100) + '%';
        bar.appendChild(fill);
        progress.appendChild(bar);
        app.appendChild(progress);

        var head = card(instrument.title, block.instrument === 'sham' ? instrument.intro : instrument.intro);
        var legend = make('div', 'sv-legend');
        legend.innerHTML = instrument.options.map(function (o) {
            return '<b>' + o.value + '</b> — ' + o.label;
        }).join(' · ');
        head.appendChild(legend);
        app.appendChild(head);

        var err = make('p', 'sv-error');
        err.hidden = true;
        app.appendChild(err);

        for (var i = block.from; i < block.to; i++) {
            app.appendChild(renderItem(block.instrument, i));
        }

        var nav = make('div', 'sv-nav');
        var back = make('button', 'sv-btn sv-btn--ghost', 'Назад');
        back.type = 'button';
        back.disabled = state.step === 0;
        back.addEventListener('click', function () {
            if (state.step > 0) {
                state.step--;
                saveDraft();
                renderBlock();
                window.scrollTo(0, 0);
            }
        });

        var isLast = state.step === state.plan.length - 1;
        var next = make('button', 'sv-btn sv-btn--primary', isLast ? 'Завершить опрос' : 'Далее');
        next.type = 'button';
        next.addEventListener('click', function () {
            var missing = missingInBlock(block);
            if (missing.length) {
                showError(err, 'Ответьте на все утверждения: без ответа ' + missing.length + '.');
                var first = app.querySelector('[data-item="' + missing[0] + '"]');
                if (first) {
                    first.classList.add('is-missing');
                    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
                return;
            }
            showError(err, null);
            advance(block);
        });

        nav.appendChild(back);
        nav.appendChild(next);
        app.appendChild(nav);
    }

    function renderItem(instrumentKey, index) {
        var instrument = INSTRUMENTS[instrumentKey];
        var fieldset = document.createElement('fieldset');
        fieldset.className = 'sv-item';
        fieldset.setAttribute('data-item', index + 1);

        var legend = document.createElement('legend');
        legend.textContent = (index + 1) + '. ' + instrument.items[index];
        fieldset.appendChild(legend);

        var opts = make('div', 'sv-opts');
        var name = instrumentKey + '-' + (index + 1);
        instrument.options.forEach(function (option) {
            var label = make('label', 'sv-opt');
            var input = document.createElement('input');
            input.type = 'radio';
            input.name = name;
            input.value = String(option.value);
            input.setAttribute('aria-label', option.value + ' — ' + option.label);
            if (String(state.answers[instrumentKey][index + 1]) === String(option.value)) {
                input.checked = true;
            }
            var box = make('span', null, option.short);
            label.appendChild(input);
            label.appendChild(box);
            opts.appendChild(label);

            input.addEventListener('change', function () {
                state.answers[instrumentKey][index + 1] = option.value;
                fieldset.classList.remove('is-missing');
                saveDraft();
            });
        });
        fieldset.appendChild(opts);
        return fieldset;
    }

    function missingInBlock(block) {
        var missing = [];
        for (var i = block.from; i < block.to; i++) {
            if (state.answers[block.instrument][i + 1] == null) missing.push(i + 1);
        }
        return missing;
    }

    function advance(block) {
        var isLastOfInstrument = block.to >= INSTRUMENTS[block.instrument].items.length;
        if (isLastOfInstrument && !state.submitted[block.instrument]) {
            setBusy(true);
            submitInstrument(block.instrument).then(function () {
                setBusy(false);
                state.submitted[block.instrument] = true;
                saveDraft();
                nextStepOrFinish();
            }).catch(function (e) {
                setBusy(false);
                var err = app.querySelector('.sv-error');
                if (err) showError(err, 'Не удалось отправить ответы: ' + (e.message || 'ошибка сети') + '. Попробуйте ещё раз.');
            });
            return;
        }
        nextStepOrFinish();
    }

    function nextStepOrFinish() {
        state.step++;
        if (state.step >= state.plan.length) {
            renderDone();
            return;
        }
        saveDraft();
        renderBlock();
        window.scrollTo(0, 0);
    }

    function submitInstrument(instrument) {
        var answers = {};
        Object.keys(state.answers[instrument]).forEach(function (k) {
            answers[k] = Number(state.answers[instrument][k]);
        });
        var duration = Date.now() - (state.startedAt[instrument] || Date.now());
        return rpc('submit_instrument', {
            p_key: state.key,
            p_instrument: instrument,
            p_answers: answers,
            p_duration_ms: duration
        });
    }

    // ---------- финал ----------

    function renderDone() {
        clearApp();
        var box = card('Спасибо, это всё');
        box.className += ' sv-done';
        box.appendChild(make('p', 'sv-emoji', '✅'));
        box.appendChild(make('p', null, 'Ответы сохранены. Вторая часть исследования — короткое эссе после сессии; оно откроется в конце января, ссылка появится на главной странице.'));
        box.appendChild(make('p', 'sv-muted', 'Ваш анонимный ключ остаётся в этом браузере — по нему можно вернуться на портал с любого устройства.'));

        var link = make('a', 'sv-btn sv-btn--primary', 'Вернуться на портал');
        link.href = 'index.html';
        link.style.display = 'inline-block';
        link.style.marginTop = '12px';
        box.appendChild(link);

        app.appendChild(box);
        try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ }
    }

    // ---------- старт ----------

    function boot() {
        var saved = null;
        try { saved = localStorage.getItem(KEY_STORE); } catch (e) { /* ignore */ }
        if (!saved) {
            renderKeyGate();
            return;
        }
        state.key = saved;
        loadDraft();
        loadRemoteState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
