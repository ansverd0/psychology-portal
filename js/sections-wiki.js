// Раздел, открытый в навигации сейчас. Нужен, чтобы закладка знала,
// в какой папке лежит статья.
let sectionsActiveFolderId = null;

function initSections() {
    const sections = appDatabase.sections;
    if (!sections || sections.length === 0) return;

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

    if (window.PsyTracker) {
        // Журнал поведения не должен мешать открытию статьи
        try {
            PsyTracker.event('article_open', {
                title: String(section.title || '').slice(0, 80),
                discipline: section.discipline_id || ''
            });
        } catch (e) {
            console.warn('⚠️ Трекер: article_open не записан:', e);
        }
    }

    // 1. Сначала санитизируем сырой контент статьи (убираем опасные теги/скрипты)
    const safeRawContent = sanitizeWikiHtml(section.content || '', {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'code', 'pre'],
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
    contentContainer.innerHTML = `${headerWithBookmark}<div class="content-text">${safeRawContent}</div>`;

    const contentText = contentContainer.querySelector('.content-text');
    applyWikiTerms(contentText, appGlossary);

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
