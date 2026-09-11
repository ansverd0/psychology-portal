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

// Единый отказоустойчивый оркестратор сборки базы данных
async function initApplicationHub() {
    showLoadingStates(); //
    console.log("📡 Запуск изолированного сбора таблиц Supabase..."); //

    // Жесткий перехват отсутствия интернет-соединения на клиенте
    if (!navigator.onLine) {
        console.warn("🔌 Браузер находится в оффлайне. Активируем фолбек...");
        activateLocalDatabaseFallback();
        return;
    }

    let networkSuccess = true;

    // 1. ФЛЭШ-КАРТОЧКИ
    try {
        const { data } = await supabaseClient.from('flashcards').select('term, definition, discipline_id'); //
        if (data) appDatabase.flashcards = data.map(c => ({ term: c.term, definition: c.definition, discipline: c.discipline_id })); //
    } catch (e) { networkSuccess = false; console.error("⚠️ Ошибка сбора flashcards:", e.message); } //

    // 2. ИНТЕРАКТИВНЫЕ ТЕСТЫ
    try {
        const { data } = await supabaseClient.from('tests').select('question, options, correct_index, link_url, discipline_id'); //
        if (data) appDatabase.tests = data.map(t => ({ question: t.question, options: t.options, correct: t.correct_index, link: t.link_url, discipline: t.discipline_id })); //
    } catch (e) { networkSuccess = false; console.error("⚠️ Ошибка сбора tests:", e.message); } //

    // 3. БИБЛИОТЕКА И ГЛОССАРИЙ
    try {
        const { data } = await supabaseClient.from('library').select('id, title, author, annotation'); //
        if (data) appDatabase.library = data; //
    } catch (e) { networkSuccess = false; console.error("⚠️ Ошибка сбора library:", e.message); } //

    try {
        const { data } = await supabaseClient.from('glossary').select('term, definition'); //
        if (data) {
            data.forEach(g => { appGlossary[g.term.trim()] = g.definition; }); //
            localStorage.setItem('hub_cached_glossary', JSON.stringify(appGlossary));
        }
    } catch (e) { console.error("⚠️ Ошибка сбора glossary:", e.message); } //

    // 4. ЭКЗАМЕНАЦИОННЫЕ БИЛЕТЫ
    try {
        const { data: tk } = await supabaseClient.from('tickets').select('id, number, title, recommend_time, plan, content, discipline_id'); //
        if (tk) {
            const groups = {}; //
            const { data: links } = await supabaseClient.from('ticket_library').select('ticket_id, book_id'); //

            tk.forEach(t => { //
                let cleanId = t.discipline_id; //
                let titleName = "Раздел экзамена"; //
                
                if (cleanId === "general-psych" || cleanId === "general-exam") { cleanId = "general-exam"; titleName = "Общая психология"; } //
                if (cleanId === "social-psych" || cleanId === "social-exam") { cleanId = "social-exam"; titleName = "Социальная психология"; } //
                if (cleanId === "developmental-psych" || cleanId === "developmental-exam") { cleanId = "developmental-exam"; titleName = "Возрастная психология"; } //
                
                let ticketLiterature = []; //
                if (links && appDatabase.library.length > 0) { //
                    const boundBookIds = links.filter(l => l.ticket_id == t.id).map(l => l.book_id); //
                    ticketLiterature = appDatabase.library //
                        .filter(b => boundBookIds.includes(b.id)) //
                        .map(b => `${b.author} — ${b.title}`); //
                }

                if (!groups[cleanId]) groups[cleanId] = { id: cleanId, title: titleName, questions: [] }; //
                
                groups[cleanId].questions.push({ //
                    number: t.number, title: t.title, time: t.recommend_time, plan: t.plan, content: t.content, literature: ticketLiterature //
                });
            });

            Object.keys(groups).forEach(key => { //
                groups[key].questions.sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10)); //
            });

            const folderOrder = ["general-exam", "social-exam", "developmental-exam"]; //
            appDatabase.tickets = folderOrder.filter(id => groups[id]).map(id => groups[id]); //
        }
    } catch (e) { networkSuccess = false; console.error("⚠️ Ошибка сбора tickets:", e.message); } //

    // 5. СТАТЬИ ЛОНГРИДОВ
    try {
        const { data: art } = await supabaseClient.from('articles').select('title, content, discipline_id'); //
        if (art) {
            const secGroups = {}; //
            art.forEach(a => { //
                let cleanId = a.discipline_id; //
                let titleName = "Раздел"; //
                
                if (cleanId.includes("general")) { cleanId = "general-psych"; titleName = "Общая психология"; } //
                if (cleanId.includes("social")) { cleanId = "social-psych"; titleName = "Социальная психология"; } //
                if (cleanId.includes("developmental") || cleanId.includes("age")) { cleanId = "developmental-psych"; titleName = "Возрастная психология"; } //
                
                if (!secGroups[cleanId]) secGroups[cleanId] = { id: cleanId, title: titleName, articles: [] }; //
                secGroups[cleanId].articles.push({ title: a.title, content: a.content }); //
            });

            Object.keys(secGroups).forEach(key => { //
                secGroups[key].articles.sort((a, b) => { //
                    const numA = parseInt(a.title.match(/^\d+/)?.[0] || 0, 10); //
                    const numB = parseInt(b.title.match(/^\d+/)?.[0] || 0, 10); //
                    return numA - numB; //
                });
            });

            const sectionFolderOrder = ["general-psych", "social-psych", "developmental-psych"]; //
            appDatabase.sections = sectionFolderOrder.filter(id => secGroups[id]).map(id => secGroups[id]); //
        }
    } catch (e) { networkSuccess = false; console.error("⚠️ Ошибка сбора articles:", e.message); } //

    // 6. ЧЕНДЖЛОГ НОВОСТЕЙ
    try {
        const { data } = await supabaseClient.from('news').select('id, date, title, changes'); //
        if (data) {
            appDatabase.news = [...data] //
                .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10)) //
                .map(item => ({ date: item.date, title: item.title, changes: item.changes })); //
        }
    } catch (e) { networkSuccess = false; console.error("⚠️ Ошибка сбора news:", e.message); } //

        // Валидация сетевой сессии и сохранение рабочего snapshot-слепка
    if (networkSuccess) {
        console.log("✅ База данных Supabase успешно скомпилирована под движок сайта!"); 
        localStorage.setItem('hub_database_snapshot', JSON.stringify(appDatabase));
        executePageModuleInitialization(); 
    } else {
        console.warn("⚠️ Часть сетевых таблиц заблокирована. Переключаемся на фолбек...");
        activateLocalDatabaseFallback();
    }
}

// Запуск инициализации интерфейса в зависимости от текущей страницы DOM
function executePageModuleInitialization() {
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
