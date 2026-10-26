// Глобальный стейт данных хаба
let appDatabase = {
    flashcards: [],
    tickets: [],
    tests: [],
    sections: [],
    library: [],
    news: []
};
let appGlossary = {};
let cacheRendered = false;

// Плавная прокрутка не должна раздражать тех, кто отключил анимацию в системе
function getScrollBehavior() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

const SUPABASE_URL = "https://lrjszannmammzzqotaro.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bwLDUQMS1RVwHF2wHE62hg_sODGX5vi";

// Таймаут сетевых запросов к Supabase: при медленном/заблокированном канале
// приложение должно быстро уйти в офлайн-кэш, а не «висеть» минутами.
const SUPABASE_TIMEOUT_MS = 12000;

function fetchWithTimeout(input, init) {
    if (init && init.signal) return window.fetch(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
    return window.fetch(input, Object.assign({}, init, { signal: controller.signal }))
        .finally(() => clearTimeout(timer));
}

// Инициализация клиента Supabase (библиотека лежит локально в js/vendor)
let supabaseClient = null;
try {
    if (typeof supabase !== 'undefined') {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { fetch: fetchWithTimeout }
        });
    } else {
        console.warn('⚠️ supabase-js не загружен. Сайт запустится в оффлайн-режиме из localStorage.');
    }
} catch (e) {
    console.warn('⚠️ Ошибка создания Supabase-клиента:', e.message, '— сайт запустится в оффлайн-режиме из localStorage.');
}

// Индикаторы загрузки для интерфейсных элементов
function setElementLoading(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function showLoadingStates() {
    setElementLoading('term-text', "⏳ Загрузка лаборатории...");
    setElementLoading('definition-text', "Пожалуйста, подождите, собираем карточки из облака...");
    setElementLoading('quiz-question', "⏳ Загрузка тестов... Пожалуйста, подождите.");
    
    const sectionsViewer = document.querySelector('.section-viewer');
    if (sectionsViewer) {
        sectionsViewer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #a0aec0;">
                <div style="font-size: 40px; margin-bottom: 15px;">📋</div>
                <h3 style="margin: 0 0 10px 0; color: #4a5568;">Раздел не выбран</h3>
                <p style="margin: 0; font-size: 14px;">Выберите интересующую вас психологическую дисциплину на панели, чтобы открыть список доступных лекций.</p>
            </div>
        `;
    }
}

// Отображение оффлайн-плашки в верхней части интерфейса
function showOfflineNotification() {
    let notify = document.getElementById('offline-hub-notification');
    if (!notify) {
        notify = document.createElement('div');
        notify.id = 'offline-hub-notification';
        notify.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; background: #feeee6; color: #d64d11; text-align: center; padding: 10px; font-size: 14px; font-weight: 600; z-index: 9999; border-bottom: 2px solid #fad9cc; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";
        notify.innerHTML = "📡 Работаем в автономном режиме. Доступны ранее сохраненные лекции, билеты и глоссарий.";
        document.body.prepend(notify);
    }
}

let currentPage = 'index';

function detectPage() {
    if (document.body && document.body.dataset.page) return document.body.dataset.page;
    if (document.getElementById('myCard')) return 'cards';
    if (document.getElementById('quiz-wrapper')) return 'tests';
    if (document.getElementById('sections-page-marker')) return 'sections';
    if (document.querySelector('.ticket-viewer')) return 'tickets';
    if (document.getElementById('library-page-marker')) return 'library';
    if (document.getElementById('news-page-marker')) return 'news';
    return 'index';
}

function readPageCache(page) {
    try {
        const raw = localStorage.getItem('hub_page_cache_' + page);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.db) {
                return {
                    db: parsed.db,
                    glossary: parsed.glossary || {},
                    version: localStorage.getItem('hub_page_version_' + page),
                    legacy: false
                };
            }
        }
    } catch (e) {
        console.warn('⚠️ Кэш страницы повреждён:', e.message);
    }

    // Совместимость со старым общим снимком (до P-02)
    try {
        const legacyRaw = localStorage.getItem('hub_database_snapshot');
        if (!legacyRaw) return null;
        const glossRaw = localStorage.getItem('hub_cached_glossary');
        return {
            db: JSON.parse(legacyRaw),
            glossary: glossRaw ? JSON.parse(glossRaw) : {},
            version: localStorage.getItem('hub_app_version'),
            legacy: true
        };
    } catch (e) {
        console.warn('⚠️ Старый кэш повреждён:', e.message);
        return null;
    }
}

function savePageCache(page, db, glossary, version) {
    try {
        localStorage.setItem('hub_page_cache_' + page, JSON.stringify({ db, glossary: glossary || {} }));
        localStorage.setItem('hub_page_version_' + page, version);
        // Старый общий снимок больше не нужен и занимает место
        localStorage.removeItem('hub_database_snapshot');
        localStorage.removeItem('hub_cached_glossary');
        localStorage.removeItem('hub_app_version');
        return true;
    } catch (e) {
        console.warn('⚠️ Не удалось сохранить кэш страницы:', e.message);
        return false;
    }
}

function applyPageData(db, glossary) {
    if (db && typeof db === 'object') {
        Object.keys(db).forEach(key => { appDatabase[key] = db[key]; });
    }
    appGlossary = glossary || {};
}

// Активация локального оффлайн-фолбека из localStorage
function activateLocalDatabaseFallback() {
    if (!cacheRendered) {
        const cached = readPageCache(currentPage);
        if (cached) {
            applyPageData(cached.db, cached.glossary);
            cacheRendered = true;
            executePageModuleInitialization();
        }
    }

    showOfflineNotification();

    if (!cacheRendered) {
        executePageModuleInitialization();
    }
}

async function fetchCloudVersion() {
    const { data, error } = await supabaseClient
        .from('version_control')
        .select('version')
        .limit(1);
    if (error) throw error;
    return data?.[0]?.version || '0.0.0';
}

async function fetchTable(table, columns, attempts = 2) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const { data, error } = await supabaseClient.from(table).select(columns);
            if (error) throw error;
            return data || [];
        } catch (e) {
            lastError = e;
            console.warn(`⚠️ ${table}: попытка ${attempt + 1} из ${attempts} не удалась:`, e.message);
            if (attempt < attempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 400));
            }
        }
    }

    throw lastError;
}

function mapFlashcards(data) {
    return data.map(c => ({ term: c.term, definition: c.definition, discipline: c.discipline_id }));
}

function mapTests(data) {
    return data.map(t => ({ question: t.question, options: t.options, correct: t.correct_index, link: t.link_url, discipline: t.discipline_id }));
}

function mapGlossary(data) {
    const glossary = {};
    data.forEach(g => { glossary[g.term.trim()] = g.definition; });
    return glossary;
}

function mapArticles(data) {
    const groups = {};
    data.forEach(a => {
        let cleanId = a.discipline_id;
        if (cleanId.includes('general')) cleanId = 'general-psych';
        if (cleanId.includes('social')) cleanId = 'social-psych';
        if (cleanId.includes('developmental') || cleanId.includes('age')) cleanId = 'developmental-psych';

        const titleName = cleanId === 'general-psych' ? 'Общая психология' : (cleanId === 'social-psych' ? 'Социальная психология' : 'Возрастная психология');
        if (!groups[cleanId]) groups[cleanId] = { id: cleanId, title: titleName, articles: [] };
        groups[cleanId].articles.push({ title: a.title, content: a.content });
    });

    Object.keys(groups).forEach(key => {
        groups[key].articles.sort((a, b) => {
            const numA = parseInt(a.title.match(/^\d+/)?.[0] || 0, 10);
            const numB = parseInt(b.title.match(/^\d+/)?.[0] || 0, 10);
            return numA - numB;
        });
    });

    const order = ['general-psych', 'social-psych', 'developmental-psych'];
    return order.filter(id => groups[id]).map(id => groups[id]);
}

function mapTickets(tickets, links, library) {
    const groups = {};
    const safeLinks = links || [];
    const safeLibrary = library || [];

    tickets.forEach(t => {
        let cleanId = t.discipline_id;
        if (cleanId === 'general-psych' || cleanId === 'general-exam') cleanId = 'general-exam';
        if (cleanId === 'social-psych' || cleanId === 'social-exam') cleanId = 'social-exam';
        if (cleanId === 'developmental-psych' || cleanId === 'developmental-exam') cleanId = 'developmental-exam';

        const titleName = cleanId === 'general-exam' ? 'Общая психология' : (cleanId === 'social-exam' ? 'Социальная психология' : 'Возрастная психология');

        let literature = [];
        if (safeLibrary.length > 0) {
            const boundBookIds = safeLinks.filter(l => l.ticket_id == t.id).map(l => l.book_id);
            literature = safeLibrary
                .filter(b => boundBookIds.includes(b.id))
                .map(b => `${b.author} — ${b.title}`);
        }

        if (!groups[cleanId]) groups[cleanId] = { id: cleanId, title: titleName, questions: [] };
        groups[cleanId].questions.push({
            number: t.number,
            title: t.title,
            time: t.recommend_time,
            plan: t.plan,
            content: t.content,
            literature
        });
    });

    Object.keys(groups).forEach(key => {
        groups[key].questions.sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
    });

    const order = ['general-exam', 'social-exam', 'developmental-exam'];
    return order.filter(id => groups[id]).map(id => groups[id]);
}

function mapNews(data) {
    return [...data]
        .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10))
        .map(item => ({ date: item.date, title: item.title, changes: item.changes }));
}

const PAGE_LOADERS = {
    cards: async () => {
        const flashcards = mapFlashcards(await fetchTable('flashcards', 'term, definition, discipline_id'));
        return { db: { flashcards }, glossary: {} };
    },

    tests: async () => {
        const tests = mapTests(await fetchTable('tests', 'question, options, correct_index, link_url, discipline_id'));
        return { db: { tests }, glossary: {} };
    },

    library: async () => {
        const library = await fetchTable('library', 'id, title, author, annotation');
        return { db: { library }, glossary: {} };
    },

    news: async () => {
        const news = mapNews(await fetchTable('news', 'id, date, title, changes'));
        return { db: { news }, glossary: {} };
    },

    sections: async () => {
        const [articles, glossary] = await Promise.all([
            fetchTable('articles', 'title, content, discipline_id'),
            fetchTable('glossary', 'term, definition').catch(e => {
                console.warn('⚠️ Глоссарий недоступен, статьи покажем без подсказок:', e.message);
                return [];
            })
        ]);
        return { db: { sections: mapArticles(articles) }, glossary: mapGlossary(glossary) };
    },

    tickets: async () => {
        const [tickets, links, library] = await Promise.all([
            fetchTable('tickets', 'id, number, title, recommend_time, plan, content, discipline_id'),
            fetchTable('ticket_library', 'ticket_id, book_id').catch(e => {
                console.warn('⚠️ Связи билетов с литературой недоступны:', e.message);
                return [];
            }),
            fetchTable('library', 'id, title, author, annotation').catch(e => {
                console.warn('⚠️ Литература недоступна, билеты покажем без списка книг:', e.message);
                return [];
            })
        ]);
        return { db: { tickets: mapTickets(tickets, links, library), library }, glossary: {} };
    }
};

async function initApplicationHub() {
    currentPage = detectPage();
    const loader = PAGE_LOADERS[currentPage];

    // Страницам без данных (index) сеть не нужна вообще
    if (!loader) {
        executePageModuleInitialization();
        return;
    }

    const cached = readPageCache(currentPage);
    if (cached) {
        applyPageData(cached.db, cached.glossary);
        cacheRendered = true;
        executePageModuleInitialization();
        console.log('⚡ Страница отрисована из локального кэша');
    }

    if (!supabaseClient) {
        console.warn('⚠️ Supabase клиент недоступен. Запуск из локального кэша...');
        activateLocalDatabaseFallback();
        return;
    }

    if (!navigator.onLine) {
        console.warn('🔌 Сеть отсутствует. Запуск автономного фолбека...');
        activateLocalDatabaseFallback();
        return;
    }

    try {
        if (cacheRendered) {
            const cloudVersion = await fetchCloudVersion();
            console.log(`📦 Версия в облаке: ${cloudVersion} | На устройстве: ${cached.version}`);

            if (cached.version === cloudVersion) {
                if (cached.legacy) savePageCache(currentPage, cached.db, cached.glossary, cloudVersion);
                try { sessionStorage.removeItem('hub_reload_' + cloudVersion); } catch (e) { /* ignore */ }
                return;
            }

            console.log('🔄 Фоновое обновление контента...');
            const payload = await loader();
            const saved = savePageCache(currentPage, payload.db, payload.glossary, cloudVersion);
            applyPageData(payload.db, payload.glossary);

            if (!saved) return;

            const reloadKey = 'hub_reload_' + cloudVersion;
            if (sessionStorage.getItem(reloadKey) === '1') {
                console.warn('⚠️ Кэш обновлён, но перезагрузка уже была — оставляем экран.');
                return;
            }
            sessionStorage.setItem(reloadKey, '1');
            window.location.reload();
            return;
        }

        // Первый вход: кэша нет, показываем загрузку и тянем только данные этой страницы
        console.log('🔄 Первый запуск страницы. Загружаем только её таблицы...');
        showLoadingStates();

        const [cloudVersion, payload] = await Promise.all([
            fetchCloudVersion(),
            loader()
        ]);

        applyPageData(payload.db, payload.glossary);
        savePageCache(currentPage, payload.db, payload.glossary, cloudVersion);
        executePageModuleInitialization();
    } catch (e) {
        console.warn('⚠️ Сетевой сбой или блокировка REST API Supabase. Активируем локальный фолбек:', e.message);
        activateLocalDatabaseFallback();
    }
}


// Запуск инициализации интерфейса в зависимости от текущей страницы DOM
function executePageModuleInitialization() {
    // Мягкий безопасный вызов авторизации Этапа 1 (если функция загрузилась в глобальную видимость)
    if (typeof proceedResearchAuth === 'function') {
        proceedResearchAuth();
    }
    const cardElement = document.getElementById('myCard'); 
    if (cardElement && typeof initFlashcards === 'function') initFlashcards(); 
    if (document.querySelector('.tri-column-layout') && !document.getElementById('sections-page-marker') && typeof initTickets === 'function') initTickets();
    if (document.getElementById('quiz-wrapper') && typeof initQuiz === 'function') initQuiz(); 
    if (document.getElementById('sections-page-marker') && typeof initSections === 'function') initSections(); 
    if (document.getElementById('library-page-marker') && typeof initLibrary === 'function') initLibrary(); 
    if (document.getElementById('news-page-marker') && typeof initNews === 'function') initNews(); 
}

// Привязка главного оркестратора к событию загрузки DOM
document.addEventListener('DOMContentLoaded', initApplicationHub); 

// Глобальная фоновая регистрация PWA Service Worker для оффлайн-удержания статики
if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let updateShown = false;

    function showUpdateBanner() {
        if (updateShown || document.getElementById('update-banner')) return;
        updateShown = true;

        const banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.className = 'update-banner';
        banner.innerHTML =
            '<span>Доступна новая версия портала.</span>' +
            '<div class="update-banner__actions">' +
                '<button type="button" id="update-reload">Обновить</button>' +
                '<button type="button" id="update-dismiss" class="secondary">Позже</button>' +
            '</div>';
        document.body.appendChild(banner);

        document.getElementById('update-reload').addEventListener('click', () => window.location.reload());
        document.getElementById('update-dismiss').addEventListener('click', () => banner.remove());
    }

    // Не перезагружаем страницу принудительно: пользователь может потерять ввод.
    // Показываем баннер, решение остаётся за ним.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        showUpdateBanner();
    });

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
            .then(reg => console.log('🚀 Service Worker зарегистрирован:', reg.scope))
            .catch(err => console.error('⚠️ Ошибка регистрации Service Worker:', err));
    });
}
// Автоматический трекинг прокрутки для универсальной кнопки "Наверх"
window.addEventListener('scroll', () => {
    const topBtn = document.getElementById('scroll-top-btn');
    if (topBtn) {
        // Кнопка плавно появляется, если пользователь пролистал больше 400 пикселей вниз
        if (window.scrollY > 400) {
            topBtn.classList.add('visible');
        } else {
            topBtn.classList.remove('visible');
        }
    }
});

// Автоматическая установка og:url в реальном домене
function updateOpenGraphUrl() {
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl && ogUrl.content === 'https://vercel.app') {
        ogUrl.content = window.location.href;
    }
}
document.addEventListener('DOMContentLoaded', updateOpenGraphUrl);

// Плавный скролл к самому началу страницы при клике
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'scroll-top-btn') {
        window.scrollTo({ top: 0, behavior: getScrollBehavior() });
    }
});

