// js/practice.js — «Практикум»: задания верхних уровней таксономии Блума.
// Контракт: docs/SPEC-PRACTICE.md. Данные — appDatabase.practice из
// PAGE_LOADERS.practice (js/supabase-config.js), попытки — через RPC.
// Страница не ставит оценку за компетентность: задание, критерии и эталон нужны
// для самопроверки, а исследование фиксирует работу с задачей.

const PRACTICE_LEVELS = {
    remember:   { label: 'Запоминание', order: 1, className: 'practice-level--remember' },
    understand: { label: 'Понимание',   order: 2, className: 'practice-level--understand' },
    apply:      { label: 'Применение',  order: 3, className: 'practice-level--apply' },
    analyze:    { label: 'Анализ',      order: 4, className: 'practice-level--analyze' },
    evaluate:   { label: 'Оценка',      order: 5, className: 'practice-level--evaluate' },
    create:     { label: 'Создание',    order: 6, className: 'practice-level--create' }
};

// Уровни, которые пилот использует в фильтре (порядок — как в спеке §3)
const PRACTICE_FILTER_LEVELS = ['apply', 'analyze', 'evaluate', 'create'];

const PRACTICE_PROGRESS_STORE = 'hub_practice_progress_v1';
const PRACTICE_DRAFT_PREFIX = 'hub_practice_draft_v1_';
const PRACTICE_MIN_ANSWER = 30;   // RPC принимает text длиной 30…8000

const practiceState = {
    discipline: 'all',
    level: 'all',
    taskId: null,
    view: 'list'
};

let practiceInitialized = false;
let practiceOpenedAt = 0;
let practiceDraftTimer = null;
let practiceSubmitting = false;
let practiceRetryPayload = null;

// ---------------------------------------------------------------------------
// Данные и уровни
// ---------------------------------------------------------------------------

function practiceTasks() {
    const rows = Array.isArray(appDatabase.practice) ? appDatabase.practice.slice() : [];
    return rows.sort((a, b) => {
        const byOrder = (Number(a.order) || 0) - (Number(b.order) || 0);
        if (byOrder) return byOrder;
        const byLevel = practiceLevelOrder(a.level) - practiceLevelOrder(b.level);
        if (byLevel) return byLevel;
        return String(a.title).localeCompare(String(b.title), 'ru');
    });
}

function practiceLevelOrder(level) {
    const meta = PRACTICE_LEVELS[level];
    return meta ? meta.order : 99;
}

function practiceLevelMeta(level) {
    return PRACTICE_LEVELS[level] || { label: level || 'Уровень', order: 99, className: 'practice-level--other' };
}

function practiceFindTask(id) {
    const wanted = Number(id);
    return practiceTasks().find(t => t.id === wanted) || null;
}

function practiceDisciplineMeta(id) {
    if (typeof psyDiscipline === 'function') return psyDiscipline(id);
    return { id: id, title: id, short: id, icon: '📁', order: 999 };
}

// ---------------------------------------------------------------------------
// Хранилище: прогресс и черновики
// ---------------------------------------------------------------------------

function practiceStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function practiceStorageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

function practiceStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* приватный режим */ }
}

function readPracticeProgress() {
    const raw = practiceStorageGet(PRACTICE_PROGRESS_STORE);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function writePracticeProgress(progress) {
    practiceStorageSet(PRACTICE_PROGRESS_STORE, JSON.stringify(progress || {}));
}

function practiceProgressOf(id) {
    const progress = readPracticeProgress();
    return progress[String(id)] || null;
}

function practiceSavedKey() {
    const key = practiceStorageGet('research_user_key');
    return key ? String(key).trim() : null;
}

function practiceMaxNullable(a, b) {
    const hasA = typeof a === 'number' && isFinite(a);
    const hasB = typeof b === 'number' && isFinite(b);
    if (hasA && hasB) return Math.max(a, b);
    if (hasA) return a;
    if (hasB) return b;
    return null;
}

/** Локальный прогресс после успешной попытки (текст ответа сюда не пишем). */
function practiceRememberAttempt(task, res) {
    const progress = readPracticeProgress();
    const id = String(task.id);
    const prev = progress[id] || {};
    const isChoice = task.kind === 'choice';
    progress[id] = {
        attempts: (Number(prev.attempts) || 0) + 1,
        bestSelf: isChoice ? (prev.bestSelf === undefined ? null : prev.bestSelf) : practiceMaxNullable(prev.bestSelf, Number(res.self_score)),
        maxScore: isChoice ? (prev.maxScore === undefined ? null : prev.maxScore) : (Number(res.max_score) || null),
        lastAt: new Date().toISOString(),
        lastCorrect: isChoice ? Boolean(res.is_correct) : (prev.lastCorrect === true ? true : null)
    };
    writePracticeProgress(progress);
}

// ---------------------------------------------------------------------------
// Разметка: санитайзинг и мелкие помощники
// ---------------------------------------------------------------------------

function practiceEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

function practiceEscape(text) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** HTML из БД: только разрешённые теги и атрибуты (спека §6.1). */
function sanitizePracticeHtml(html) {
    const raw = String(html || '');
    if (!raw) return '';
    const purifier = window.DOMPurify;
    if (purifier && typeof purifier.sanitize === 'function') {
        return purifier.sanitize(raw, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre'],
            ALLOWED_ATTR: ['href', 'rel', 'target']
        });
    }
    // Запасной путь: DOMPurify не загрузился — показываем текст без разметки,
    // но не позволяем ему стать разметкой.
    return practiceEscape(raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Вставляет санитайзенный HTML и закрывает внешние ссылки от window.opener. */
function applyPracticeHtml(container, html) {
    if (!container) return;
    container.innerHTML = sanitizePracticeHtml(html);
    container.querySelectorAll('a[href]').forEach((link) => {
        const target = link.getAttribute('target');
        if (target === '_blank') link.setAttribute('rel', 'noopener noreferrer');
    });
}

function practicePlainText(html) {
    const raw = String(html || '');
    if (!raw) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = sanitizePracticeHtml(raw);
    return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

function practiceShortCompetence(task) {
    const text = String((task && task.competence) || '');
    return text.length > 120 ? text.slice(0, 117) + '…' : text;
}

function practiceTrack(name, meta) {
    try {
        if (window.PsyTracker && typeof window.PsyTracker.event === 'function') {
            window.PsyTracker.event(name, meta);
        }
    } catch (e) {
        // журнал не должен ломать интерфейс
    }
}

function practiceToast(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, { type: type || 'info' });
    }
}

function practiceLevelChip(level) {
    const meta = practiceLevelMeta(level);
    return practiceEl('span', 'practice-level ' + meta.className, meta.label);
}

function practiceButton(className, label, attr, value) {
    const btn = practiceEl('button', className, label);
    btn.type = 'button';
    if (attr) btn.setAttribute(attr, value === undefined ? '' : String(value));
    return btn;
}

// ---------------------------------------------------------------------------
// Прогресс: localStorage + RPC practice_progress
// ---------------------------------------------------------------------------

function practiceDurationMs() {
    const elapsed = Date.now() - (practiceOpenedAt || Date.now());
    return Math.min(7200000, Math.max(5000, Math.round(elapsed)));
}

async function practiceLoadProgress() {
    const local = readPracticeProgress();
    const key = practiceSavedKey();

    if (!key || typeof SUPABASE_URL === 'undefined') {
        practiceRefresh();
        return;
    }

    try {
        const rows = await practiceRpc('practice_progress', { p_key: key });
        if (!Array.isArray(rows)) return;
        const merged = Object.assign({}, local);
        rows.forEach((row) => {
            const id = String(row.task_id);
            const prev = merged[id] || {};
            const prevAt = Date.parse(prev.lastAt || '') || 0;
            const rowAt = Date.parse(row.last_at || '') || 0;
            const newer = rowAt >= prevAt;
            merged[id] = {
                attempts: Math.max(Number(prev.attempts) || 0, Number(row.attempts) || 0),
                bestSelf: practiceMaxNullable(prev.bestSelf === undefined ? null : prev.bestSelf, Number.isInteger(row.best_self_score) ? row.best_self_score : null),
                maxScore: practiceMaxNullable(prev.maxScore === undefined ? null : prev.maxScore, Number.isInteger(row.max_score) ? row.max_score : null),
                lastAt: newer ? (row.last_at || prev.lastAt || null) : (prev.lastAt || null),
                lastCorrect: newer ? (typeof row.last_is_correct === 'boolean' ? row.last_is_correct : null) : (typeof prev.lastCorrect === 'boolean' ? prev.lastCorrect : null)
            };
        });
        writePracticeProgress(merged);
        practiceRefresh();
    } catch (e) {
        // RPC недоступен — живём на localStorage, страницу не ломаем
        practiceRefresh();
    }
}

// ---------------------------------------------------------------------------
// Отрисовка: сайдбар и список
// ---------------------------------------------------------------------------

function practiceRefresh() {
    const tasks = practiceTasks();
    practiceRenderSidebar(tasks);

    if (practiceState.view === 'task' && practiceState.taskId && practiceFindTask(practiceState.taskId)) {
        practiceRenderList(tasks);
        practiceHideList();
        practiceHideEmpty();
        return;
    }

    practiceState.view = 'list';
    practiceState.taskId = null;
    practiceRenderList(tasks);
    practiceShowList();
}

function practiceRenderSidebar(tasks) {
    const progress = readPracticeProgress();
    const done = tasks.filter(t => progress[String(t.id)] && Number(progress[String(t.id)].attempts) > 0).length;
    const progressEl = document.getElementById('practice-progress');
    if (progressEl) progressEl.textContent = 'Пройдено ' + done + ' из ' + tasks.length;

    practiceRenderDisciplineTiles(tasks);
    practiceRenderLevelChips(tasks);
}

function practiceRenderDisciplineTiles(tasks) {
    const container = document.getElementById('practice-discipline-tiles');
    if (!container) return;
    container.innerHTML = '';

    const byDiscipline = {};
    tasks.forEach((task) => {
        const id = task.discipline || 'other';
        if (!byDiscipline[id]) byDiscipline[id] = { id: id, count: 0 };
        byDiscipline[id].count += 1;
    });

    const all = practiceEl('button', 'mobile-tile-btn practice-tile');
    all.type = 'button';
    all.setAttribute('data-practice-discipline', 'all');
    all.setAttribute('aria-pressed', practiceState.discipline === 'all' ? 'true' : 'false');
    if (practiceState.discipline === 'all') all.classList.add('active');
    all.appendChild(document.createTextNode('📚 Все дисциплины'));
    all.appendChild(practiceEl('span', 'practice-tile__count', tasks.length));
    container.appendChild(all);

    Object.keys(byDiscipline)
        .map((id) => {
            const meta = practiceDisciplineMeta(id);
            return { id: id, title: meta.title, short: meta.short, icon: meta.icon, order: meta.order, count: byDiscipline[id].count };
        })
        .sort((a, b) => (a.order - b.order) || String(a.title).localeCompare(String(b.title), 'ru'))
        .forEach((entry) => {
            const tile = practiceEl('button', 'mobile-tile-btn practice-tile');
            tile.type = 'button';
            tile.setAttribute('data-practice-discipline', entry.id);
            tile.setAttribute('aria-pressed', practiceState.discipline === entry.id ? 'true' : 'false');
            if (practiceState.discipline === entry.id) tile.classList.add('active');
            tile.appendChild(document.createTextNode(entry.icon + ' ' + entry.short));
            tile.appendChild(practiceEl('span', 'practice-tile__count', entry.count));
            tile.title = entry.title;
            container.appendChild(tile);
        });
}

function practiceRenderLevelChips(tasks) {
    const container = document.getElementById('practice-level-chips');
    if (!container) return;
    container.innerHTML = '';

    const counts = {};
    tasks.forEach((task) => {
        if (!counts[task.level]) counts[task.level] = 0;
        counts[task.level] += 1;
    });

    const addChip = (value, label, count) => {
        const chip = practiceEl('button', 'practice-levels__chip');
        chip.type = 'button';
        chip.setAttribute('data-practice-level', value);
        const active = practiceState.level === value;
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (active) chip.classList.add('active');
        chip.appendChild(document.createTextNode(label));
        chip.appendChild(practiceEl('span', 'practice-levels__count', count));
        container.appendChild(chip);
    };

    addChip('all', 'Все', tasks.length);

    const present = Object.keys(counts)
        .filter((level) => counts[level] > 0)
        .sort((a, b) => practiceLevelOrder(a) - practiceLevelOrder(b));

    // Пилотные уровни показываем в порядке спеки, даже если задач на уровне ещё нет
    const ordered = present.slice().sort((a, b) => {
        const ai = PRACTICE_FILTER_LEVELS.indexOf(a);
        const bi = PRACTICE_FILTER_LEVELS.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        return practiceLevelOrder(a) - practiceLevelOrder(b);
    });

    ordered.forEach((level) => addChip(level, practiceLevelMeta(level).label, counts[level]));
}

function practiceFiltered(tasks) {
    return tasks.filter((task) => {
        const byDiscipline = practiceState.discipline === 'all' || task.discipline === practiceState.discipline;
        const byLevel = practiceState.level === 'all' || task.level === practiceState.level;
        return byDiscipline && byLevel;
    });
}

function practiceStatusText(task) {
    const progress = practiceProgressOf(task.id);
    if (!progress || !Number(progress.attempts)) return 'не начата';
    if (task.kind === 'choice') return progress.lastCorrect === true ? 'верно' : 'есть попытка';
    return 'есть попытка';
}

function practiceRenderList(tasks) {
    const list = document.getElementById('practice-list');
    if (!list) return;
    list.innerHTML = '';

    if (!tasks.length) {
        practiceShowEmpty('Задания практикума не загрузились. Проверьте соединение и обновите страницу.', '📡');
        return;
    }

    const visible = practiceFiltered(tasks);
    if (!visible.length) {
        practiceShowEmpty('В этом фильтре заданий нет. Выберите другую дисциплину или уровень.', '🔎');
        return;
    }

    practiceHideEmpty();
    const fragment = document.createDocumentFragment();
    visible.forEach((task) => fragment.appendChild(practiceCard(task)));
    list.appendChild(fragment);
}

function practiceCard(task) {
    const card = practiceEl('article', 'practice-card');
    card.setAttribute('data-practice-task', String(task.id));

    const meta = practiceEl('div', 'practice-card__meta');
    meta.appendChild(practiceLevelChip(task.level));
    const status = practiceEl('span', 'practice-card__status', practiceStatusText(task));
    if (practiceStatusText(task) === 'верно') status.classList.add('is-correct');
    meta.appendChild(status);
    card.appendChild(meta);

    if (task.competence) {
        card.appendChild(practiceEl('p', 'practice-card__competence', task.competence));
    }

    card.appendChild(practiceEl('h3', 'practice-card__title', task.title));

    const excerpt = practicePlainText(task.situation);
    if (excerpt) {
        card.appendChild(practiceEl('p', 'practice-card__excerpt', excerpt.length > 140 ? excerpt.slice(0, 140) + '…' : excerpt));
    }

    const open = practiceButton('practice-card__open', 'Открыть задание', 'data-practice-open-task', task.id);
    open.setAttribute('aria-label', 'Открыть задание: ' + task.title);
    card.appendChild(open);

    return card;
}

function practiceShowEmpty(text, icon) {
    const empty = document.getElementById('practice-empty');
    if (!empty) return;
    empty.innerHTML = '';
    empty.appendChild(practiceEl('div', 'practice-empty__icon', icon || '🧩'));
    empty.appendChild(practiceEl('h2', 'practice-empty__title', 'Заданий нет'));
    empty.appendChild(practiceEl('p', 'practice-empty__text', text));
    empty.hidden = false;
}

function practiceHideEmpty() {
    const empty = document.getElementById('practice-empty');
    if (empty) empty.hidden = true;
}

function practiceShowList() {
    const list = document.getElementById('practice-list');
    if (list) list.hidden = false;
}

function practiceHideList() {
    const list = document.getElementById('practice-list');
    if (list) list.hidden = true;
}

// ---------------------------------------------------------------------------
// Карточка задачи
// ---------------------------------------------------------------------------

function practiceNextTask(task) {
    const visible = practiceFiltered(practiceTasks());
    const index = visible.findIndex(t => t.id === task.id);
    if (index === -1 || index + 1 >= visible.length) return null;
    return visible[index + 1];
}

function practiceOpenTask(id) {
    const task = practiceFindTask(id);
    if (!task) return;

    practiceState.taskId = task.id;
    practiceState.view = 'task';
    practiceOpenedAt = Date.now();
    practiceRetryPayload = null;
    practiceSyncBodyState();

    const view = document.getElementById('practice-task-view');
    if (!view) return;
    practiceHideEmpty();
    practiceHideList();
    view.hidden = false;
    practiceRenderTaskBody(view, task);

    practiceTrack('task_open', {
        task_id: task.id,
        slug: task.slug,
        level: task.level,
        competence: practiceShortCompetence(task),
        kind: task.kind
    });
}

function practiceRenderTaskBody(view, task) {
    view.innerHTML = '';

    const nav = practiceEl('div', 'practice-task__nav');
    nav.appendChild(practiceButton('practice-task__back', '← К списку', 'data-practice-back', ''));
    const next = practiceButton('practice-task__next', 'Следующее задание →', 'data-practice-next', '');
    const nextTask = practiceNextTask(task);
    if (!nextTask) {
        next.disabled = true;
        next.title = 'Это последнее задание в выбранном фильтре';
    }
    nav.appendChild(next);
    view.appendChild(nav);

    const meta = practiceEl('div', 'practice-task__meta');
    meta.appendChild(practiceLevelChip(task.level));
    if (task.competence) meta.appendChild(practiceEl('span', 'practice-task__competence', task.competence));
    if (task.ai) meta.appendChild(practiceEl('span', 'practice-badge practice-badge--ai', 'Текст сгенерирован ИИ'));
    view.appendChild(meta);

    const title = practiceEl('h2', 'practice-task__title', task.title);
    title.id = 'practice-task-title';
    title.tabIndex = -1;
    view.appendChild(title);

    const situation = practiceEl('section', 'practice-task__block');
    situation.appendChild(practiceEl('h3', 'practice-task__label', 'Ситуация'));
    const situationBody = practiceEl('div', 'practice-task__text');
    applyPracticeHtml(situationBody, task.situation);
    situation.appendChild(situationBody);
    view.appendChild(situation);

    const prompt = practiceEl('section', 'practice-task__block');
    prompt.appendChild(practiceEl('h3', 'practice-task__label', 'Задание'));
    const promptBody = practiceEl('div', 'practice-task__text');
    applyPracticeHtml(promptBody, task.task);
    prompt.appendChild(promptBody);
    view.appendChild(prompt);

    const answer = practiceEl('div', 'practice-task__answer');
    answer.setAttribute('data-practice-answer-area', '');
    if (task.kind === 'choice') {
        practiceBuildChoice(answer, task);
    } else {
        practiceBuildOpen(answer, task);
    }
    view.appendChild(answer);

    const result = practiceEl('div', 'practice-result');
    result.setAttribute('data-practice-result', '');
    result.setAttribute('aria-live', 'polite');
    result.hidden = true;
    view.appendChild(result);

    // Фокус — на заголовок задачи (спека §6.1)
    try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); }
    practiceScrollTo(view, 90);
}

function practiceScrollTo(element, offset) {
    if (!element) return;
    const gap = typeof offset === 'number' ? offset : 16;
    const top = element.getBoundingClientRect().top + window.scrollY - gap;
    const behavior = (typeof getScrollBehavior === 'function') ? getScrollBehavior() : 'auto';
    window.scrollTo({ top: Math.max(0, top), behavior: behavior });
}

function practiceBuildChoice(container, task) {
    const options = practiceEl('div', 'practice-options');
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-labelledby', 'practice-task-title');

    (task.options || []).forEach((option, index) => {
        const label = practiceEl('label', 'practice-option');
        label.setAttribute('data-practice-option', String(index));
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'practice-choice';
        input.value = String(index);
        label.appendChild(input);
        label.appendChild(practiceEl('span', 'practice-option__text', option));
        options.appendChild(label);
    });

    container.appendChild(options);

    const actions = practiceEl('div', 'practice-actions');
    actions.appendChild(practiceButton('practice-btn practice-btn--primary', 'Проверить', 'data-practice-check', ''));
    container.appendChild(actions);

    const status = practiceEl('p', 'practice-note practice-note--error', '');
    status.setAttribute('data-practice-status', '');
    status.hidden = true;
    container.appendChild(status);

    const guest = practiceEl('p', 'practice-note practice-note--guest', '');
    guest.setAttribute('data-practice-guest-note', '');
    guest.hidden = true;
    container.appendChild(guest);
}

function practiceBuildOpen(container, task) {
    container.appendChild(practiceEl('p', 'practice-note practice-note--privacy', 'Не указывайте ФИО и названия групп: это данные исследования.'));

    const textarea = document.createElement('textarea');
    textarea.className = 'practice-textarea';
    textarea.rows = 8;
    textarea.id = 'practice-answer';
    textarea.setAttribute('data-practice-answer', '');
    textarea.setAttribute('aria-labelledby', 'practice-task-title');
    textarea.placeholder = 'Запишите свой ответ: сначала попробуйте сами, критерии откроются по кнопке.';
    container.appendChild(textarea);

    const hint = practiceEl('p', 'practice-hint', '');
    hint.setAttribute('data-practice-hint', '');
    container.appendChild(hint);
    practiceUpdateAnswerHint(container);

    const actions = practiceEl('div', 'practice-actions');
    actions.appendChild(practiceButton('practice-btn', 'Показать критерии', 'data-practice-show-criteria', ''));
    container.appendChild(actions);

    const rubric = practiceEl('div', 'practice-rubric');
    rubric.setAttribute('data-practice-criteria', '');
    rubric.hidden = true;

    rubric.appendChild(practiceEl('h3', 'practice-rubric__title', 'Критерии самопроверки'));
    rubric.appendChild(practiceEl('p', 'practice-rubric__intro', 'Отметьте, насколько выполнен каждый критерий: 0 — нет, 1 — частично, 2 — да. Эталон появится после сохранения попытки.'));

    (task.criteria || []).forEach((criterion, index) => {
        const row = practiceEl('div', 'practice-rubric__row');
        row.setAttribute('data-practice-criterion', String(index));
        row.appendChild(practiceEl('p', 'practice-rubric__text', criterion));

        const scale = practiceEl('div', 'practice-rubric__scale');
        scale.setAttribute('role', 'radiogroup');
        scale.setAttribute('aria-label', 'Оценка по критерию ' + (index + 1));
        [0, 1, 2].forEach((value) => {
            const label = practiceEl('label', 'practice-score');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'practice-self-' + index;
            input.value = String(value);
            label.appendChild(input);
            label.appendChild(practiceEl('span', 'practice-score__value', String(value)));
            scale.appendChild(label);
        });
        row.appendChild(scale);
        rubric.appendChild(row);
    });

    const maxScore = (task.criteria || []).length * 2;
    const total = practiceEl('p', 'practice-rubric__total', '');
    total.appendChild(document.createTextNode('Самооценка: '));
    const totalValue = practiceEl('strong', 'practice-rubric__total-value', '0');
    totalValue.setAttribute('data-practice-self-total', '');
    total.appendChild(totalValue);
    total.appendChild(document.createTextNode(' из ' + maxScore));
    rubric.appendChild(total);

    const completeHint = practiceEl('p', 'practice-hint', 'Отметьте каждый критерий — тогда попытку можно сохранить.');
    completeHint.setAttribute('data-practice-complete-hint', '');
    rubric.appendChild(completeHint);

    const rubricActions = practiceEl('div', 'practice-actions');
    const save = practiceButton('practice-btn practice-btn--primary', 'Сохранить попытку', 'data-practice-save', '');
    save.disabled = true;
    rubricActions.appendChild(save);
    rubric.appendChild(rubricActions);

    container.appendChild(rubric);

    const status = practiceEl('p', 'practice-note practice-note--error', '');
    status.setAttribute('data-practice-status', '');
    status.hidden = true;
    container.appendChild(status);

    const guest = practiceEl('p', 'practice-note practice-note--guest', '');
    guest.setAttribute('data-practice-guest-note', '');
    guest.hidden = true;
    container.appendChild(guest);

    // Черновик ответа возвращаем при открытии задачи
    const draft = practiceStorageGet(PRACTICE_DRAFT_PREFIX + task.id);
    if (draft) {
        textarea.value = draft;
        practiceUpdateAnswerHint(container);
    }
}

function practiceUpdateAnswerHint(container) {
    const textarea = container.querySelector('[data-practice-answer]');
    const hint = container.querySelector('[data-practice-hint]');
    if (!textarea || !hint) return;
    const length = (textarea.value || '').trim().length;
    if (length === 0) {
        hint.textContent = 'Минимальная длина ответа — ' + PRACTICE_MIN_ANSWER + ' символов.';
        hint.classList.remove('is-ok');
        return;
    }
    const left = PRACTICE_MIN_ANSWER - length;
    hint.textContent = left > 0
        ? 'Ещё минимум ' + left + ' символов.'
        : 'Длина ответа: ' + length + ' символов.';
    hint.classList.toggle('is-ok', left <= 0);
}

function practiceUpdateSelfTotal(task) {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    let total = 0;
    let rated = 0;
    (task.criteria || []).forEach((criterion, index) => {
        const picked = view.querySelector('input[name="practice-self-' + index + '"]:checked');
        if (picked) {
            total += Number(picked.value) || 0;
            rated += 1;
        }
    });
    const totalValue = view.querySelector('[data-practice-self-total]');
    if (totalValue) totalValue.textContent = String(total);
    const complete = rated === (task.criteria || []).length;
    const save = view.querySelector('[data-practice-save]');
    if (save) save.disabled = !complete;
    const hint = view.querySelector('[data-practice-complete-hint]');
    if (hint) hint.hidden = complete;
    return { total: total, complete: complete };
}

// ---------------------------------------------------------------------------
// Результат
// ---------------------------------------------------------------------------

function practiceResultBox() {
    return document.querySelector('#practice-task-view [data-practice-result]');
}

function practiceHtmlBlock(title, html) {
    const block = practiceEl('div', 'practice-result__block');
    block.appendChild(practiceEl('h3', 'practice-result__label', title));
    const body = practiceEl('div', 'practice-result__text');
    applyPracticeHtml(body, html);
    block.appendChild(body);
    return block;
}

function practiceRenderChoiceResult(task, isCorrect, options) {
    const box = practiceResultBox();
    if (!box) return;
    box.innerHTML = '';

    const verdict = practiceEl('p', 'practice-result__verdict ' + (isCorrect ? 'is-correct' : 'is-wrong'), isCorrect ? 'Верно' : 'Неверно');
    box.appendChild(verdict);

    const correctText = (task.options || [])[task.correct] || '';
    const line = practiceEl('p', 'practice-result__answer');
    line.appendChild(document.createTextNode('Правильный вариант: '));
    line.appendChild(practiceEl('strong', '', correctText));
    box.appendChild(line);

    if (task.explanation) box.appendChild(practiceHtmlBlock('Почему так', task.explanation));
    if (task.model) box.appendChild(practiceHtmlBlock('Эталон', task.model));

    if (options && options.saved) {
        box.appendChild(practiceEl('p', 'practice-result__saved', 'Попытка сохранена.'));
    }

    box.hidden = false;
    practiceScrollTo(box, 90);
}

function practiceRenderOpenResult(task, res, options) {
    const box = practiceResultBox();
    if (!box) return;
    box.innerHTML = '';

    const saved = options && options.saved;
    const selfScore = Number(res && res.self_score);
    const maxScore = Number(res && res.max_score) || (task.criteria || []).length * 2;
    const title = saved ? 'Самопроверка сохранена' : 'Самопроверка';
    box.appendChild(practiceEl('p', 'practice-result__verdict ' + (saved ? 'is-correct' : 'is-wrong'), title));

    const score = practiceEl('p', 'practice-result__score');
    score.appendChild(document.createTextNode('Ваша самооценка: '));
    score.appendChild(practiceEl('strong', '', (isFinite(selfScore) ? selfScore : 0) + ' из ' + maxScore));
    box.appendChild(score);

    box.appendChild(practiceEl('p', 'practice-result__hint', 'Сравните свой ответ с эталоном: эталон — один из возможных ответов, а не единственно верный.'));

    if ((task.criteria || []).length) {
        const list = practiceEl('ol', 'practice-result__criteria');
        (task.criteria || []).forEach((criterion, index) => {
            const item = practiceEl('li', 'practice-result__criterion');
            item.appendChild(practiceEl('span', 'practice-result__criterion-text', criterion));
            const picked = document.querySelector('input[name="practice-self-' + index + '"]:checked');
            const value = picked ? Number(picked.value) || 0 : 0;
            item.appendChild(practiceEl('span', 'practice-result__criterion-score', value + ' из 2'));
            list.appendChild(item);
        });
        box.appendChild(list);
    }

    if (task.model) box.appendChild(practiceHtmlBlock('Эталон', task.model));

    box.hidden = false;
    practiceScrollTo(box, 90);
}

// ---------------------------------------------------------------------------
// Гость, статусы, отправка
// ---------------------------------------------------------------------------

function practiceGuestNote() {
    const view = document.getElementById('practice-task-view');
    return view ? view.querySelector('[data-practice-guest-note]') : null;
}

function practiceShowGuestInvite(text) {
    const note = practiceGuestNote();
    if (!note) return;
    note.innerHTML = '';
    note.appendChild(document.createTextNode(text + ' '));
    const btn = practiceButton('practice-link-btn', 'Создать ID', 'data-practice-create-id', '');
    note.appendChild(btn);
    note.hidden = false;
}

function practiceHideGuestInvite() {
    const note = practiceGuestNote();
    if (note) note.hidden = true;
}

function practiceShowStatus(text) {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    const status = view.querySelector('[data-practice-status]');
    if (!status) return;
    status.textContent = text;
    status.hidden = false;
}

function practiceHideStatus() {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    const status = view.querySelector('[data-practice-status]');
    if (status) {
        status.hidden = true;
        status.textContent = '';
    }
}

function practiceSetBusy(busy, label) {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    view.querySelectorAll('[data-practice-check], [data-practice-save]').forEach((btn) => {
        if (busy) {
            if (!btn.dataset.restoreLabel) btn.dataset.restoreLabel = btn.textContent;
            btn.disabled = true;
            btn.textContent = label || 'Сохраняем…';
        } else {
            btn.disabled = false;
            if (btn.dataset.restoreLabel) {
                btn.textContent = btn.dataset.restoreLabel;
                delete btn.dataset.restoreLabel;
            }
        }
    });
}

async function practiceRpc(name, payload) {
    if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
        throw new Error('supabase is not configured');
    }
    const url = String(SUPABASE_URL).replace(/\/$/, '') + '/rest/v1/rpc/' + name;
    const init = {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    };
    const response = (typeof fetchWithTimeout === 'function')
        ? await fetchWithTimeout(url, init)
        : await fetch(url, init);

    let data = null;
    try { data = await response.json(); } catch (e) { data = null; }

    if (!response.ok) {
        const message = (data && (data.message || data.hint)) || ('HTTP ' + response.status);
        const error = new Error(String(message));
        error.practiceMessage = String(message);
        throw error;
    }
    return data;
}

async function practiceSubmitAttempt(task, answer, selfScore) {
    if (practiceSubmitting) return;

    const key = practiceSavedKey();
    if (!key) {
        return;
    }

    practiceSubmitting = true;
    practiceHideStatus();
    practiceSetBusy(true);
    practiceHideGuestInvite();

    const payload = {
        p_key: key,
        p_task_id: task.id,
        p_answer: answer,
        p_self_score: selfScore,
        p_duration_ms: practiceDurationMs()
    };

    try {
        const res = await practiceRpc('submit_practice_attempt', payload);
        practiceRetryPayload = null;
        practiceAfterSavedAttempt(task, answer, res);
    } catch (error) {
        const message = String((error && (error.practiceMessage || error.message)) || '');
        if (/unknown user_key/i.test(message)) {
            practiceRetryPayload = null;
            practiceShowStatus('ID не найден в базе. Создайте новый — тогда попытка сохранится.');
            practiceShowGuestInvite('Создайте ID, чтобы сохранить попытку.');
        } else {
            practiceRetryPayload = { task: task, answer: answer, selfScore: selfScore };
            practiceShowStatus('Не удалось сохранить попытку. Ответ не потерян — нажмите «Повторить».');
            practiceShowRetryButton();
            practiceToast('Не удалось сохранить попытку', 'error');
        }
    } finally {
        practiceSubmitting = false;
        practiceSetBusy(false);
    }
}

function practiceShowRetryButton() {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    const status = view.querySelector('[data-practice-status]');
    if (!status || !practiceRetryPayload) return;
    if (status.querySelector('[data-practice-retry]')) return;
    const retry = practiceButton('practice-link-btn', 'Повторить', 'data-practice-retry', '');
    status.appendChild(document.createTextNode(' '));
    status.appendChild(retry);
}

function practiceAfterSavedAttempt(task, answer, res) {
    practiceRememberAttempt(task, res);
    practiceHideStatus();
    practiceHideGuestInvite();

    if (task.kind === 'choice') {
        practiceLockChoice();
        practiceRenderChoiceResult(task, Boolean(res && res.is_correct), { saved: true });
        practiceTrack('task_submit', {
            task_id: task.id,
            slug: task.slug,
            level: task.level,
            competence: practiceShortCompetence(task),
            kind: task.kind,
            correct: Boolean(res && res.is_correct)
        });
    } else {
        const selfScore = Number(res && res.self_score) || 0;
        const maxScore = Number(res && res.max_score) || (task.criteria || []).length * 2;
        practiceLockOpenAnswer();
        practiceStorageRemove(PRACTICE_DRAFT_PREFIX + task.id);
        practiceRenderOpenResult(task, res, { saved: true });
        practiceTrack('self_check', {
            task_id: task.id,
            level: task.level,
            self_score: selfScore,
            max_score: maxScore
        });
        practiceTrack('task_submit', {
            task_id: task.id,
            slug: task.slug,
            level: task.level,
            competence: practiceShortCompetence(task),
            kind: task.kind,
            self_score: selfScore,
            max_score: maxScore
        });
    }

    practiceLoadProgress();
}

function practiceLockChoice() {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    view.querySelectorAll('input[name="practice-choice"]').forEach((input) => { input.disabled = true; });
    const check = view.querySelector('[data-practice-check]');
    if (check) check.hidden = true;
}

function practiceLockOpenAnswer() {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    const textarea = view.querySelector('[data-practice-answer]');
    if (textarea) textarea.readOnly = true;
    view.querySelectorAll('input[type="radio"]').forEach((input) => { input.disabled = true; });
    const save = view.querySelector('[data-practice-save]');
    if (save) save.hidden = true;
    const show = view.querySelector('[data-practice-show-criteria]');
    if (show) show.hidden = true;
}

function practiceMarkChoice(task, choice) {
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    view.querySelectorAll('[data-practice-option]').forEach((label) => {
        const index = Number(label.getAttribute('data-practice-option'));
        label.classList.remove('is-correct', 'is-wrong', 'is-selected');
        if (index === task.correct) label.classList.add('is-correct');
        if (index === choice) {
            label.classList.add('is-selected');
            if (index !== task.correct) label.classList.add('is-wrong');
        }
    });
}

// ---------------------------------------------------------------------------
// Действия пользователя
// ---------------------------------------------------------------------------

function practiceSelectChoice() {
    const task = practiceFindTask(practiceState.taskId);
    if (!task) return;
    const picked = document.querySelector('#practice-task-view input[name="practice-choice"]:checked');
    if (!picked) {
        practiceToast('Выберите один вариант ответа', 'info');
        return;
    }
    const choice = Number(picked.value);
    practiceMarkChoice(task, choice);
    practiceHideStatus();

    if (!practiceSavedKey()) {
        const isCorrect = choice === task.correct;
        practiceLockChoice();
        practiceRenderChoiceResult(task, isCorrect, { local: true });
        practiceShowGuestInvite('Результат не сохранён. Создайте ID, чтобы сохранить попытку.');
        return;
    }

    practiceSubmitAttempt(task, { choice: choice }, null);
}

function practiceShowCriteria() {
    const task = practiceFindTask(practiceState.taskId);
    if (!task) return;
    const view = document.getElementById('practice-task-view');
    if (!view) return;
    const rubric = view.querySelector('[data-practice-criteria]');
    if (!rubric) return;
    rubric.hidden = false;

    const textarea = view.querySelector('[data-practice-answer]');
    const answerLength = textarea ? (textarea.value || '').trim().length : 0;
    if (answerLength < PRACTICE_MIN_ANSWER) {
        practiceShowStatus('Сначала попробуйте ответить своими словами — критерии открыты, но так вы проверите себя честнее.');
    }
    practiceUpdateSelfTotal(task);
    practiceScrollTo(rubric, 80);
}

function practiceSaveOpenAttempt() {
    const task = practiceFindTask(practiceState.taskId);
    if (!task) return;
    const view = document.getElementById('practice-task-view');
    if (!view) return;

    const textarea = view.querySelector('[data-practice-answer]');
    const text = textarea ? String(textarea.value || '').trim() : '';
    if (text.length < PRACTICE_MIN_ANSWER) {
        practiceShowStatus('Ответ слишком короткий: нужно не меньше ' + PRACTICE_MIN_ANSWER + ' символов.');
        if (textarea) { textarea.focus(); }
        return;
    }

    const totals = practiceUpdateSelfTotal(task);
    if (!totals.complete) {
        practiceShowStatus('Отметьте каждый критерий: 0, 1 или 2.');
        return;
    }

    if (!practiceSavedKey()) {
        practiceRenderOpenResult(task, { self_score: totals.total, max_score: (task.criteria || []).length * 2 }, { saved: false });
        practiceShowGuestInvite('Попытка не сохранена. Создайте ID, чтобы результат попал в исследование.');
        return;
    }

    practiceSubmitAttempt(task, { text: text }, totals.total);
}

function practiceGoToNext() {
    const task = practiceFindTask(practiceState.taskId);
    if (!task) return;
    const next = practiceNextTask(task);
    if (!next) {
        practiceToast('Это последнее задание в выбранном фильтре', 'info');
        return;
    }
    practiceOpenTask(next.id);
}

function practiceBackToList() {
    const returnId = practiceState.taskId;
    practiceState.view = 'list';
    practiceState.taskId = null;
    practiceSyncBodyState();

    const view = document.getElementById('practice-task-view');
    if (view) {
        view.hidden = true;
        view.innerHTML = '';
    }
    practiceHideStatus();
    practiceRefresh();

    if (returnId) {
        const cardButton = document.querySelector('[data-practice-task="' + returnId + '"] [data-practice-open-task]');
        if (cardButton) {
            try { cardButton.focus({ preventScroll: true }); } catch (e) { cardButton.focus(); }
        }
    }
}

// ---------------------------------------------------------------------------
// События (делегирование: initPractice вызывается повторно)
// ---------------------------------------------------------------------------

function practiceOnClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const disciplineBtn = target.closest('[data-practice-discipline]');
    if (disciplineBtn) {
        practiceState.discipline = disciplineBtn.getAttribute('data-practice-discipline') || 'all';
        practiceBackToList();
        practiceScrollTo(document.getElementById('practice-list'), 40);
        return;
    }

    const levelBtn = target.closest('[data-practice-level]');
    if (levelBtn) {
        practiceState.level = levelBtn.getAttribute('data-practice-level') || 'all';
        practiceBackToList();
        practiceScrollTo(document.getElementById('practice-list'), 40);
        return;
    }

    const openBtn = target.closest('[data-practice-open-task]');
    if (openBtn) {
        practiceOpenTask(Number(openBtn.getAttribute('data-practice-open-task')));
        return;
    }

    const backBtn = target.closest('[data-practice-back]');
    if (backBtn) {
        practiceBackToList();
        return;
    }

    const nextBtn = target.closest('[data-practice-next]');
    if (nextBtn) {
        practiceGoToNext();
        return;
    }

    const checkBtn = target.closest('[data-practice-check]');
    if (checkBtn) {
        practiceSelectChoice();
        return;
    }

    const criteriaBtn = target.closest('[data-practice-show-criteria]');
    if (criteriaBtn) {
        practiceShowCriteria();
        return;
    }

    const saveBtn = target.closest('[data-practice-save]');
    if (saveBtn) {
        practiceSaveOpenAttempt();
        return;
    }

    const retryBtn = target.closest('[data-practice-retry]');
    if (retryBtn) {
        if (!practiceRetryPayload) return;
        practiceSubmitAttempt(practiceRetryPayload.task, practiceRetryPayload.answer, practiceRetryPayload.selfScore);
        return;
    }

    const createBtn = target.closest('[data-practice-create-id]');
    if (createBtn) {
        if (typeof openAuthModal === 'function') {
            openAuthModal();
        } else {
            practiceToast('Форма создания ID недоступна — обновите страницу', 'error');
        }
        return;
    }

    // Клик по самой карточке списка тоже открывает задание
    const card = target.closest('[data-practice-task]');
    if (card && !target.closest('a') && !target.closest('button')) {
        practiceOpenTask(Number(card.getAttribute('data-practice-task')));
    }
}

function practiceOnInput(event) {
    const target = event.target;
    if (!target || !target.matches || !target.matches('[data-practice-answer]')) return;

    const view = document.getElementById('practice-task-view');
    if (view) practiceUpdateAnswerHint(view);

    const taskId = practiceState.taskId;
    if (!taskId) return;
    const text = target.value;
    clearTimeout(practiceDraftTimer);
    practiceDraftTimer = setTimeout(() => {
        if (text && text.trim()) {
            practiceStorageSet(PRACTICE_DRAFT_PREFIX + taskId, text);
        } else {
            practiceStorageRemove(PRACTICE_DRAFT_PREFIX + taskId);
        }
    }, 300);
}

function practiceOnChange(event) {
    const target = event.target;
    if (!target || !target.name || target.name.indexOf('practice-self-') !== 0) return;
    const task = practiceFindTask(practiceState.taskId);
    if (!task) return;
    practiceUpdateSelfTotal(task);
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

/** На телефоне открытая задача прячет сайдбар: иначе до задания нужно
 *  прокручивать весь список фильтров. «К списку» возвращает фильтры. */
function practiceSyncBodyState() {
    const open = practiceState.view === 'task' && Boolean(practiceState.taskId);
    document.body.classList.toggle('practice-task-open', open);
}

function initPractice() {
    const app = document.getElementById('practice-app');
    if (!app) return;

    if (!practiceInitialized) {
        practiceInitialized = true;
        app.addEventListener('click', practiceOnClick);
        app.addEventListener('input', practiceOnInput);
        app.addEventListener('change', practiceOnChange);
    }

    const tasks = practiceTasks();
    practiceRenderSidebar(tasks);
    practiceSyncBodyState();

    if (practiceState.view === 'task' && practiceState.taskId && practiceFindTask(practiceState.taskId)) {
        practiceRenderList(tasks);
        practiceHideList();
        practiceHideEmpty();
    } else {
        practiceState.view = 'list';
        practiceState.taskId = null;
        practiceRenderList(tasks);
        practiceShowList();
    }

    practiceLoadProgress();
}
