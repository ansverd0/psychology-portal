// Раздел, открытый в навигации сейчас. Нужен, чтобы закладка знала,
// в какой папке лежит статья.
let sectionsActiveFolderId = null;

// --- Цифровой след статьи: видимое время и глубина прокрутки сегментом ---
// Сегмент открывается при показе статьи и закрывается при переходе к другой
// статье или на pagehide; время скрытой вкладки вычитается. См.
// docs/TECHSPEC-FOOTPRINT.md §5. Журнал не должен ломать чтение: все ошибки гасим.

const ARTICLE_SEGMENT_MIN_MS = 1000;
let articleTraceReady = false;

const articleTrace = {
    id: null,
    discipline: '',
    title: '',
    openedAt: 0,
    hiddenAt: 0,
    awayMs: 0,
    maxScroll: 0,
    container: null
};

/** Доля высоты статьи, побывавшая во вьюпорте (0…100) */
function articleTracePct(container) {
    const el = container && container.querySelector('.content-text');
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const height = Math.max(rect.height, 1);
    const seen = Math.min(height, Math.max(0, (window.innerHeight || 0) - rect.top));
    return Math.min(100, Math.max(0, Math.round(seen / height * 100)));
}

function articleTraceTick() {
    if (!articleTrace.id) return;
    const pct = articleTracePct(articleTrace.container);
    if (pct > articleTrace.maxScroll) articleTrace.maxScroll = pct;
}

/** Стабильный ключ статьи: uuid из базы, иначе discipline|title (ключ уникальности в БД) */
function articleTraceId(article, group) {
    if (article && article.id) return String(article.id);
    const discipline = (group && group.id) || '';
    const title = String((article && article.title) || '');
    return discipline ? discipline + '|' + title : title;
}

function articleTraceClose() {
    if (!articleTrace.id) return;
    const now = Date.now();
    let away = articleTrace.awayMs;
    if (articleTrace.hiddenAt) away += now - articleTrace.hiddenAt;
    const dwell = Math.max(0, now - articleTrace.openedAt - away);
    articleTraceTick();
    if (window.PsyTracker && typeof window.PsyTracker.event === 'function' && dwell >= ARTICLE_SEGMENT_MIN_MS) {
        try {
            window.PsyTracker.event('article_leave', {
                article_id: articleTrace.id,
                discipline: articleTrace.discipline,
                dwell_ms: Math.round(dwell),
                scroll_pct: articleTrace.maxScroll
            });
        } catch (e) { /* журнал не критичен */ }
    }
    articleTrace.id = null;
    articleTrace.container = null;
    articleTrace.hiddenAt = 0;
    articleTrace.awayMs = 0;
    articleTrace.maxScroll = 0;
}

function articleTraceStart(article, group) {
    articleTraceClose();
    const container = document.querySelector('.section-viewer');
    articleTrace.id = articleTraceId(article, group);
    articleTrace.discipline = (group && group.id) || '';
    articleTrace.title = String((article && article.title) || '').slice(0, 80);
    articleTrace.openedAt = Date.now();
    articleTrace.hiddenAt = document.hidden ? Date.now() : 0;
    articleTrace.awayMs = 0;
    articleTrace.container = container;
    articleTrace.maxScroll = articleTracePct(container);
    if (window.PsyTracker && typeof window.PsyTracker.event === 'function') {
        try {
            window.PsyTracker.event('article_open', {
                article_id: articleTrace.id,
                discipline: articleTrace.discipline,
                title: articleTrace.title
            });
        } catch (e) { /* журнал не критичен */ }
    }
}

function initArticleTrace() {
    if (articleTraceReady) return;
    articleTraceReady = true;
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            if (articleTrace.id && !articleTrace.hiddenAt) articleTrace.hiddenAt = Date.now();
        } else if (articleTrace.hiddenAt) {
            articleTrace.awayMs += Date.now() - articleTrace.hiddenAt;
            articleTrace.hiddenAt = 0;
        }
    });
    window.addEventListener('pagehide', function () {
        if (!articleTrace.id) return;
        articleTraceClose();
        // keepalive: сегмент должен уйти до выгрузки страницы
        if (window.PsyTracker && typeof window.PsyTracker.flush === 'function') {
            window.PsyTracker.flush(true);
        }
    });
    window.addEventListener('scroll', articleTraceTick, { passive: true });
}

function initSections() {
    const sections = appDatabase.sections;
    if (!sections || sections.length === 0) return;

    initArticleTrace();

    const foldersCol = document.getElementById('sections-folders-col');
    const articlesCol = document.getElementById('sections-articles-col');
    const mobileArticlesList = document.getElementById('mobile-articles-list');
    const tilesContainer = document.getElementById('mobile-sections-tiles');

    // 1. ДЛЯ ПК (ДВЕ КОЛОНКИ НАВИГАЦИИ: РАЗДЕЛЫ + СТАТЬИ)
    if (foldersCol && articlesCol) {
        foldersCol.innerHTML = '';

        sections.forEach((section) => {
            const branchBtn = document.createElement('button');
            branchBtn.classList.add('folder-nav-btn');
            branchBtn.innerHTML = `📁 ${section.title}`;
            branchBtn.id = `branch-btn-${section.id}`;
            branchBtn.dataset.sectionId = section.id;

            branchBtn.addEventListener('click', () => {
                openSectionInNav(section);
            });

            foldersCol.appendChild(branchBtn);
        });

        // Открываем первый раздел по умолчанию (клик отрисует статьи)
        if (sections.length > 0) {
            const firstFolderBtn = foldersCol.querySelector('.folder-nav-btn');
            if (firstFolderBtn) firstFolderBtn.click();
        }
    }


    // Навигационные плитки для мобильной версии хаба
    if (tilesContainer && mobileArticlesList) {
        tilesContainer.innerHTML = '';
        sections.forEach((section) => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            tile.setAttribute('aria-pressed', 'false');
            tile.id = `mobile-tile-${section.id}`; 
            
            const meta = typeof psyDiscipline === 'function' ? psyDiscipline(section.id) : { icon: '📁' };
            const icon = meta.icon;

            tile.innerHTML = `${icon}<br>${section.title}`;

            tile.addEventListener('click', () => {
                document.querySelectorAll('.mobile-tile-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
                tile.classList.add('active');
                tile.setAttribute('aria-pressed', 'true');
                sectionsActiveFolderId = section.id;


                mobileArticlesList.innerHTML = `<h4 style="margin: 5px 0 10px 5px; color: #718096; font-size: 13px;">Статьи раздела:</h4>`;
                
                section.articles.forEach(article => {
                    const articleBtn = document.createElement('button');
                    articleBtn.classList.add('ticket-nav-btn');
                    articleBtn.style.cssText = "margin-bottom: 5px; padding: 10px 12px; font-size: 14px;";
                    articleBtn.innerText = article.title;

                    articleBtn.addEventListener('click', () => {
                        showSectionContent(article);
                        // Автопрокрутка к началу статьи с зазором сверху (раунд 4)
                        scrollBlockIntoView(document.querySelector('.section-viewer'), 16);
                    });
                    mobileArticlesList.appendChild(articleBtn);
                });
                mobileArticlesList.style.display = 'block';
            });
            tilesContainer.appendChild(tile);
        });
    }

    // Живая обработка входящего Deeplink (URL параметра ?discipline=)
    const urlParams = new URLSearchParams(window.location.search);
    const targetDiscipline = urlParams.get('discipline');

    if (targetDiscipline) {
        // Данные и плитки могут появиться позже первого кадра — пробуем несколько раз,
        // а не один раз через фиксированную задержку
        openDeepLinkedDiscipline(targetDiscipline);
    }

    // 4. ЖИВОЙ ПОИСК ПО НАЗВАНИЯМ СТАТЕЙ (U2-07)
    attachLiveSearch({
        inputId: 'mobile-search-input',
        resultsId: 'mobile-search-results',
        source: () => (appDatabase.sections || []).flatMap((section) => section.articles.map((article) => ({
            title: article.title,
            label: article.title,
            category: section.title,
            payload: { section, article }
        }))),
        onPick: (item) => {
            openSectionInNav(item.payload.section, item.payload.article);
            scrollBlockIntoView(document.querySelector('.section-viewer'), 16);
        }
    });

    // Рендер панели закладок при инициализации
    renderSectionsBookmarksPanel();
}

// ВЫСОКОПРОИЗВОДИТЕЛЬНЫЙ ДВИЖОК ВИКИ-ПОДСКАЗОК (Линейная O(N) замена)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/** Если DOMPurify не загрузился с CDN — не роняем страницу, а показываем текст */
function sanitizeWikiHtml(html, config) {
    if (typeof DOMPurify === 'undefined') return escapeHtml(html || '');
    return DOMPurify.sanitize(html, config);
}

/** Рисует список статей во второй колонке навигации.
 *  activeTitle — статья, которую нужно подсветить и подматривать в неё */
function renderArticlesColumn(articles, container, activeTitle) {
    container.innerHTML = '';
    let activeBtn = null;

    articles.forEach(article => {
        const articleBtn = document.createElement('button');
        articleBtn.classList.add('question-nav-btn');
        articleBtn.innerText = article.title;

        articleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.question-nav-btn').forEach(btn => { btn.classList.remove('active'); btn.removeAttribute('aria-current'); });
            articleBtn.classList.add('active');
            articleBtn.setAttribute('aria-current', 'true');
            showSectionContent(article);
        });

        container.appendChild(articleBtn);

        if (activeTitle && article.title === activeTitle) {
            articleBtn.classList.add('active');
            articleBtn.setAttribute('aria-current', 'true');
            activeBtn = articleBtn;
        }
    });

    if (activeBtn) scrollIntoContainer(container, activeBtn);
}

/** Единая точка открытия статьи: подсвечивает раздел, рисует статьи, показывает текст.
 *  Используется кликом по разделу, загрузкой страницы и кликом по закладке */
function openSectionInNav(section, article) {
    const foldersCol = document.getElementById('sections-folders-col');
    const articlesCol = document.getElementById('sections-articles-col');
    if (!foldersCol || !articlesCol || !section) return;

    const target = article || section.articles[0] || null;
    sectionsActiveFolderId = section.id;

    foldersCol.querySelectorAll('.folder-nav-btn').forEach(btn => {
        const isActive = btn.dataset.sectionId === section.id;
        btn.classList.toggle('active', isActive);
        if (isActive) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
    });

    if (!target) {
        articlesCol.innerHTML = '<div class="questions-placeholder">Статей нет</div>';
        return;
    }

    renderArticlesColumn(section.articles, articlesCol, target.title);
    showSectionContent(target);
}


function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Подсветка терминов по текстовым узлам (не по HTML-строке).
 *  \b в JavaScript не работает с кириллицей, поэтому границы заданы через \p{L}. */
function applyWikiTerms(root, glossary) {
    if (!root || !glossary) return;

    const terms = Object.keys(glossary)
        .map(term => String(term || '').trim())
        .filter(term => term.length >= 3);
    if (!terms.length) return;

    terms.sort((a, b) => b.length - a.length);

    const definitionByTerm = new Map();
    terms.forEach(term => definitionByTerm.set(term.toLowerCase(), glossary[term]));

    const regex = new RegExp(
        `(^|[^\\p{L}\\p{N}_])(${terms.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
        'giu'
    );

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest('a, code, pre, script, style, h1, h2, h3, h4, h5, h6, .wiki-term')) {
                return NodeFilter.FILTER_REJECT;
            }
            return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
        const text = node.nodeValue;
        let match;
        let lastIndex = 0;
        let fragment = null;

        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            const prefix = match[1];
            const term = match[2];
            const termStart = match.index + prefix.length;
            const definition = definitionByTerm.get(term.toLowerCase());
            if (!definition) continue;

            if (!fragment) fragment = document.createDocumentFragment();
            if (termStart > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, termStart)));
            }

            const span = document.createElement('span');
            span.className = 'wiki-term';
            span.setAttribute('data-tooltip', definition);
            span.textContent = term;
            fragment.appendChild(span);

            lastIndex = termStart + term.length;
        }

        if (fragment) {
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }
            node.parentNode.replaceChild(fragment, node);
        }
    });
}

/** Открывает раздел по deeplink (?discipline=...).
 *  Папки и плитки рендерятся асинхронно, поэтому пробуем несколько раз,
 *  а не один раз через фиксированную задержку — см. UI-01 */
function openDeepLinkedDiscipline(id, attempt = 0) {
    const isMobile = window.innerWidth <= 768;
    const target = document.getElementById(isMobile ? `mobile-tile-${id}` : `branch-btn-${id}`);

    if (target) {
        target.click();
        return;
    }

    if (attempt < 25) {
        setTimeout(() => openDeepLinkedDiscipline(id, attempt + 1), 100);
    }
}

function showSectionContent(section) {
    const contentContainer = document.querySelector('.section-viewer');
    if (!contentContainer || !section) return;

    if (sectionGroup) sectionsCurrentSection = sectionGroup;
    sectionsCurrentArticle = section;
    const currentGroup = sectionGroup || sectionsCurrentSection;

    // Сегмент предыдущей статьи закрываем до замены содержимого: иначе
    // прокрутку и высоту уже не измерить
    const traceId = articleTraceId(section, currentGroup);
    const sameArticle = traceId === articleTrace.id;
    if (!sameArticle) articleTraceClose();

    // 1. Сначала санитизируем сырой контент статьи (убираем опасные теги/скрипты)
    const safeRawContent = sanitizeWikiHtml(section.content || '', {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'code', 'pre'],
        ALLOWED_ATTR: ['href', 'rel', 'target', 'src', 'alt']
    });

    // 2. Добавляем звёздочку закладки
    const bookmarkActive = isBookmarked(section.title, 'article') ? 'active' : '';
    const bookmarkIcon = isBookmarked(section.title, 'article') ? '★' : '☆';

    const headerWithBookmark = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin: 0 0 20px 0; padding-bottom: 15px; border-bottom: 2px solid #edf2f7;">
            <h2 style="margin: 0; font-size: 24px; color: #1a365d; line-height: 1.3; flex: 1;">${escapeHtml(section.title)}</h2>
            <button class="bookmark-star-btn ${bookmarkActive}" id="section-bookmark-star" data-bookmark-id="${escapeHtml(section.title)}" data-bookmark-type="article" aria-pressed="${bookmarkActive ? 'true' : 'false'}" title="${bookmarkActive ? 'Убрать из закладок' : 'В закладки'}" style="margin-left: 15px; flex-shrink: 0;">${bookmarkIcon}</button>
        </div>
    `;

    // 3. Вставляем санитизированный HTML и уже в DOM подсвечиваем термины
    const aiBanner = section.ai
        ? '<div style="background: #fff5f5; border-left: 4px solid #c53030; padding: 10px 14px; border-radius: 6px; margin-bottom: 18px; font-size: 13px; color: #742a2a;"><strong>🤖 Контент сгенерирован при помощи ИИ.</strong> Проверяйте факты и сообщайте о неточностях — материал будет исправлен.</div>'
        : '';
    contentContainer.innerHTML = `${headerWithBookmark}${aiBanner}<div class="content-text">${safeRawContent}</div>`;

    const contentText = contentContainer.querySelector('.content-text');
    applyWikiTerms(contentText, appGlossary);

    // Новый сегмент начинает отсчёт после отрисовки: height и scroll уже реальные
    if (sameArticle) articleTraceTick();
    else articleTraceStart(section, currentGroup);

    // 4. Обработчик закладки: панель и звезда синхронизируются событием
    const starBtn = document.getElementById('section-bookmark-star');
    if (starBtn) {
        starBtn.addEventListener('click', () => {
            toggleBookmark(section.title, section.title, 'article', { folder: sectionsActiveFolderId });
        });
    }
}

/** Открывает статью из закладки: ищет её в сохранённом разделе, затем везде */
function openBookmarkedArticle(title, bookmark) {
    const sections = appDatabase.sections;
    if (!sections) return;

    // Сначала ищем в том же разделе, где закладку создали
    let section = bookmark && bookmark.folder
        ? sections.find(s => s.id === bookmark.folder)
        : null;

    if (!section || !section.articles.some(a => a.title === title)) {
        section = sections.find(s => s.articles.some(a => a.title === title));
    }
    if (!section) return;

    const article = section.articles.find(a => a.title === title);
    openSectionInNav(section, article);

    scrollBlockIntoView(document.querySelector('.section-viewer'), 16);
}

/** Рендер панели закладок для sections.html */
function renderSectionsBookmarksPanel() {
    // Модалка на телефоне открывает статью тем же обработчиком
    setBookmarkOpenHandler('article', openBookmarkedArticle);
    // Перерисовка по bookmarks:changed, а не только по клику на звезду (U2-03)
    registerBookmarksPanelRenderer('article', renderSectionsBookmarksPanel);

    const panel = document.getElementById('bookmarks-panel');
    if (panel) {
        renderBookmarksPanel(panel, 'article', openBookmarkedArticle);
    }

    refreshBookmarksFab();
}
