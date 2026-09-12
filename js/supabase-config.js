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

const SUPABASE_URL = "https://lrjszannmammzzqotaro.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bwLDUQMS1RVwHF2wHE62hg_sODGX5vi";

// Принудительный обход QUIC/UDP (HTTP/3) через стандартный браузерный fetch
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (...args) => window.fetch(...args) }
});

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

// Активация локального оффлайн-фолбека из localStorage
function activateLocalDatabaseFallback() {
    const cachedDb = localStorage.getItem('hub_database_snapshot');
    const cachedGloss = localStorage.getItem('hub_cached_glossary');

    if (cachedDb) appDatabase = JSON.parse(cachedDb);
    if (cachedGloss) appGlossary = JSON.parse(cachedGloss);

    showOfflineNotification();
    executePageModuleInitialization();
}

// Высокопроизводительный оркестратор с валидацией версии (Вариант Б)
async function initApplicationHub() {
    console.log("📡 Запуск системы контроля версий хаба...");

    const cachedDb = localStorage.getItem('hub_database_snapshot');
    const cachedGloss = localStorage.getItem('hub_cached_glossary');
    const localVersion = localStorage.getItem('hub_app_version');

    // Перехват полного отсутствия интернет-соединения
    if (!navigator.onLine) {
        console.warn("🔌 Сеть отсутствует. Запуск автономного фолбека...");
        activateLocalDatabaseFallback();
        return;
    }

    try {
        // МГНОВЕННЫЙ ЗАПРОС: Скачиваем только текущую версию из Supabase
        const { data: verData, error: verError } = await supabaseClient
            .from('version_control')
            .select('version')
            .limit(1);

        if (verError) throw verError;

        const cloudVersion = verData?.[0]?.version || "0.0.0";
        console.log(`📦 Версия в облаке: ${cloudVersion} | Версия на устройстве: ${localVersion}`);

        // СЦЕНАРИЙ 1: Версии совпали и кэш существует — мгновенный запуск без скачивания таблиц
        if (cachedDb && localVersion === cloudVersion) {
            console.log("🚀 Изменений в БД нет. Мгновенный импорт из локального snapshot...");
            appDatabase = JSON.parse(cachedDb);
            if (cachedGloss) appGlossary = JSON.parse(cachedGloss);
            
            executePageModuleInitialization();
            return; // Сетевой поток успешно завершен, экономим трафик и время
        }

        // СЦЕНАРИЙ 2: Первый вход или версия изменилась — запускаем синхронное скачивание таблиц
        console.log("🔄 Обнаружено обновление контента или пустой кэш. Выкачиваем таблицы...");
        showLoadingStates();

        let networkSuccess = true;
        let freshDatabase = { flashcards: [], tickets: [], tests: [], sections: [], library: [], news: [] };
        let freshGlossary = {};

        // 1. Флэш-карточки
        try {
            const { data } = await supabaseClient.from('flashcards').select('term, definition, discipline_id');
            if (data) freshDatabase.flashcards = data.map(c => ({ term: c.term, definition: c.definition, discipline: c.discipline_id }));
        } catch (e) { networkSuccess = false; }

        // 2. Интерактивные тесты
        try {
            const { data } = await supabaseClient.from('tests').select('question, options, correct_index, link_url, discipline_id');
            if (data) freshDatabase.tests = data.map(t => ({ question: t.question, options: t.options, correct: t.correct_index, link: t.link_url, discipline: t.discipline_id }));
        } catch (e) { networkSuccess = false; }

        // 3. Библиотека
        try {
            const { data } = await supabaseClient.from('library').select('id, title, author, annotation');
            if (data) freshDatabase.library = data;
        } catch (e) { networkSuccess = false; }

        // 4. Глоссарий
        try {
            const { data } = await supabaseClient.from('glossary').select('term, definition');
            if (data) {
                data.forEach(g => { freshGlossary[g.term.trim()] = g.definition; });
            }
        } catch (e) { networkSuccess = false; }

        // 5. Экзаменационные билеты
        try {
            const { data: tk } = await supabaseClient.from('tickets').select('id, number, title, recommend_time, plan, content, discipline_id');
            if (tk) {
                const groups = {};
                const { data: links } = await supabaseClient.from('ticket_library').select('ticket_id, book_id');

                tk.forEach(t => {
                    let cleanId = t.discipline_id;
                    if (cleanId === "general-psych" || cleanId === "general-exam") cleanId = "general-exam";
                    if (cleanId === "social-psych" || cleanId === "social-exam") cleanId = "social-exam";
                    if (cleanId === "developmental-psych" || cleanId === "developmental-exam") cleanId = "developmental-exam";
                    
                    let titleName = cleanId === "general-exam" ? "Общая психология" : (cleanId === "social-exam" ? "Социальная психология" : "Возрастная психология");

                    let ticketLiterature = [];
                    if (links && freshDatabase.library.length > 0) {
                        const boundBookIds = links.filter(l => l.ticket_id == t.id).map(l => l.book_id);
                        ticketLiterature = freshDatabase.library
                            .filter(b => boundBookIds.includes(b.id))
                            .map(b => `${b.author} — ${b.title}`);
                    }

                    if (!groups[cleanId]) groups[cleanId] = { id: cleanId, title: titleName, questions: [] };
                    groups[cleanId].questions.push({
                        number: t.number, title: t.title, time: t.recommend_time, plan: t.plan, content: t.content, literature: ticketLiterature
                    });
                });

                Object.keys(groups).forEach(key => {
                    groups[key].questions.sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
                });
                const folderOrder = ["general-exam", "social-exam", "developmental-exam"];
                freshDatabase.tickets = folderOrder.filter(id => groups[id]).map(id => groups[id]);
            }
        } catch (e) { networkSuccess = false; }

        // 6. Статьи лонгридов
        try {
            const { data: art } = await supabaseClient.from('articles').select('title, content, discipline_id');
            if (art) {
                const secGroups = {};
                art.forEach(a => {
                    let cleanId = a.discipline_id;
                    if (cleanId.includes("general")) cleanId = "general-psych";
                    if (cleanId.includes("social")) cleanId = "social-psych";
                    if (cleanId.includes("developmental") || cleanId.includes("age")) cleanId = "developmental-psych";
                    
                    let titleName = cleanId === "general-psych" ? "Общая психология" : (cleanId === "social-psych" ? "Социальная психология" : "Возрастная психология");

                    if (!secGroups[cleanId]) secGroups[cleanId] = { id: cleanId, title: titleName, articles: [] };
                    secGroups[cleanId].articles.push({ title: a.title, content: a.content });
                });

                Object.keys(secGroups).forEach(key => {
                    secGroups[key].articles.sort((a, b) => {
                        const numA = parseInt(a.title.match(/^\d+/)?.[0] || 0, 10);
                        const numB = parseInt(b.title.match(/^\d+/)?.[0] || 0, 10);
                        return numA - numB;
                    });
                });
                const sectionFolderOrder = ["general-psych", "social-psych", "developmental-psych"];
                freshDatabase.sections = sectionFolderOrder.filter(id => secGroups[id]).map(id => secGroups[id]);
            }
        } catch (e) { networkSuccess = false; }

        // 7. Ченджлог новостей
        try {
            const { data } = await supabaseClient.from('news').select('id, date, title, changes');
            if (data) {
                freshDatabase.news = [...data]
                    .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10))
                    .map(item => ({ date: item.date, title: item.title, changes: item.changes }));
            }
        } catch (e) { networkSuccess = false; }

        // Запись новых данных и фиксация хэша версии
        if (networkSuccess) {
            console.log("✅ Все обновленные таблицы успешно скачаны из облака!");
            appDatabase = freshDatabase;
            appGlossary = freshGlossary;

            localStorage.setItem('hub_database_snapshot', JSON.stringify(appDatabase));
            localStorage.setItem('hub_cached_glossary', JSON.stringify(appGlossary));
            localStorage.setItem('hub_app_version', cloudVersion); // Фиксируем версию на устройстве

            executePageModuleInitialization();
        } else {
            throw new Error("Часть таблиц заблокирована сетевым экраном");
        }

    } catch (globalError) {
        console.warn("⚠️ Сетевой сбой или блокировка REST API Supabase. Активируем локальный фолбек:", globalError.message);
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
    if (document.querySelector('.tickets-layout') && !document.getElementById('sections-page-marker') && typeof initTickets === 'function') initTickets(); 
    if (document.getElementById('quiz-wrapper') && typeof initQuiz === 'function') initQuiz(); 
    if (document.getElementById('sections-page-marker') && typeof initSections === 'function') initSections(); 
    if (document.getElementById('library-page-marker') && typeof initLibrary === 'function') initLibrary(); 
    if (document.getElementById('news-page-marker') && typeof initNews === 'function') initNews(); 
}

// Привязка главного оркестратора к событию загрузки DOM
document.addEventListener('DOMContentLoaded', initApplicationHub); 

// Глобальная фоновая регистрация PWA Service Worker для оффлайн-удержания статики
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('🚀 Глобальный Service Worker успешно зарегистрирован!'))
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

// Плавный скролл к самому началу страницы при клике
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'scroll-top-btn') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});

