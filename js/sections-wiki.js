function initSections() {
    const sections = appDatabase.sections;
    if (!sections || sections.length === 0) return;

    const desktopContainer = document.getElementById('sections-list-desktop');
    const mobileArticlesList = document.getElementById('mobile-articles-list');
    const tilesContainer = document.getElementById('mobile-sections-tiles');

    if (desktopContainer) desktopContainer.innerHTML = '';

    sections.forEach((section) => {
        if (desktopContainer) {
            const branchBtn = document.createElement('button');
            branchBtn.classList.add('ticket-nav-btn', 'branch-title-btn');
            branchBtn.innerHTML = `📁 ${section.title}`;
            branchBtn.id = `branch-btn-${section.id}`; 
            
            const submenuContainer = document.createElement('div');
            submenuContainer.classList.add('submenu-container');
            submenuContainer.style.display = 'none';

            section.articles.forEach(article => {
                const articleBtn = document.createElement('button');
                articleBtn.classList.add('submenu-item-btn');
                articleBtn.innerText = article.title;
                
                articleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.submenu-item-btn').forEach(btn => btn.classList.remove('active'));
                    articleBtn.classList.add('active');
                    showSectionContent(article);
                });
                submenuContainer.appendChild(articleBtn);
            });

            branchBtn.addEventListener('click', () => {
                const isOpened = submenuContainer.style.display === 'block';
                document.querySelectorAll('.submenu-container').forEach(sub => sub.style.display = 'none');
                document.querySelectorAll('.branch-title-btn').forEach(btn => btn.classList.remove('branch-active'));

                if (!isOpened) {
                    submenuContainer.style.display = 'block';
                    branchBtn.classList.add('branch-active');
                } else {
                    submenuContainer.style.display = 'none';
                }
            });

            desktopContainer.appendChild(branchBtn);
            desktopContainer.appendChild(submenuContainer);
        }
    });

    // Навигационные плитки для мобильной версии хаба
    if (tilesContainer && mobileArticlesList) {
        tilesContainer.innerHTML = '';
        sections.forEach((section) => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            tile.id = `mobile-tile-${section.id}`; 
            
            let icon = "📁";
            if (section.id === "general-psych") icon = "🧠";
            if (section.id === "social-psych") icon = "👥";
            if (section.id === "developmental-psych") icon = "🌱";

            tile.innerHTML = `${icon}<br>${section.title}`;

            tile.addEventListener('click', () => {
                document.querySelectorAll('.mobile-tile-btn').forEach(b => b.classList.remove('active'));
                tile.classList.add('active');

                mobileArticlesList.innerHTML = `<h4 style="margin: 5px 0 10px 5px; color: #718096; font-size: 13px;">Статьи раздела:</h4>`;
                
                section.articles.forEach(article => {
                    const articleBtn = document.createElement('button');
                    articleBtn.classList.add('ticket-nav-btn');
                    articleBtn.style.cssText = "margin-bottom: 5px; padding: 10px 12px; font-size: 14px;";
                    articleBtn.innerText = article.title;

                    articleBtn.addEventListener('click', () => {
                        showSectionContent(article);
                        // Автопрокрутка к началу статьи
                        const viewer = document.querySelector('.section-viewer');
                        if (viewer) viewer.scrollIntoView({ behavior: 'smooth' });
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
        setTimeout(() => {
            const pcBtn = document.getElementById(`branch-btn-${targetDiscipline}`);
            if (pcBtn && window.innerWidth > 768) pcBtn.click();
            
            const mobileTile = document.getElementById(`mobile-tile-${targetDiscipline}`);
            if (mobileTile && window.innerWidth <= 768) mobileTile.click();
        }, 150); 
    }

    // 4. ЖИВОЙ ПОИСК СТАТЕЙ (для sections.html)
    const searchInput = document.getElementById('mobile-search-input');
    const resultsContainer = document.getElementById('mobile-search-results');

    if (searchInput && resultsContainer) {
        searchInput.addEventListener('input', (e) => {
            const searchText = e.target.value.toLowerCase().trim();
            resultsContainer.innerHTML = '';

            if (searchText === '') {
                resultsContainer.style.display = 'none';
                searchInput.classList.remove('open-dropdown');
                return;
            }

            let matchesFound = false;

            sections.forEach(section => {
                section.articles.forEach(article => {
                    if (article.title.toLowerCase().includes(searchText)) {
                        matchesFound = true;

                        const button = document.createElement('button');
                        button.classList.add('search-suggest-item');
                        button.innerHTML = `
                            <span class="search-suggest-category">${section.title}</span>
                            <strong>${article.title}</strong>
                        `;

                        button.addEventListener('click', () => {
                            showSectionContent(article);
                            searchInput.value = article.title;
                            resultsContainer.style.display = 'none';
                            searchInput.classList.remove('open-dropdown');
                        });

                        resultsContainer.appendChild(button);
                    }
                });
            });

            if (matchesFound) {
                resultsContainer.style.display = 'block';
                searchInput.classList.add('open-dropdown');
            } else {
                resultsContainer.innerHTML = '<div style="padding: 15px; color: #718096; text-align:center; font-size:14px;">Ничего не найдено 😕</div>';
                resultsContainer.style.display = 'block';
                searchInput.classList.add('open-dropdown');
            }
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
                resultsContainer.style.display = 'none';
                searchInput.classList.remove('open-dropdown');
            }
        });
    }

    // Рендер панели закладок при инициализации
    renderSectionsBookmarksPanel();
}

// ВЫСОКОПРОИЗВОДИТЕЛЬНЫЙ ДВИЖОК ВИКИ-ПОДСКАЗОК (Линейная O(N) замена)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

function showSectionContent(section) {
    const contentContainer = document.querySelector('.section-viewer');
    if (!contentContainer || !section) return;
    
    // 1. Сначала санитизируем сырой контент статьи (убираем опасные теги/скрипты)
    let safeRawContent = DOMPurify.sanitize(section.content || '', {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'code', 'pre'],
        ALLOWED_ATTR: ['href', 'rel', 'target', 'src', 'alt']
    });
    
    const terms = Object.keys(appGlossary);

    if (terms.length > 0) {
        // Сортировка терминов по длине (от длинных к коротким) для предотвращения разрушения вложенных слов
        const sortedTerms = terms.sort((a, b) => b.length - a.length);
        
        // Экранируем спецсимволы в терминах
        const escapedTerms = sortedTerms.map(t => t.replace(/[-\/\^$*+?.()|[\]{}]/g, '\$&'));
        
        // Конструируем единое регулярное выражение для всех терминов одновременно
        const pattern = `\b(${escapedTerms.join('|')})\b`;
        const regex = new RegExp(pattern, 'gi');

        // Выполняем точечную замену за один проход по строке контента
        safeRawContent = safeRawContent.replace(regex, (match) => {
            const matchedKey = match.trim();
            // Находим точное соответствие в объекте кэша без учета регистра
            const definition = appGlossary[matchedKey] || 
                               appGlossary[sortedTerms.find(t => t.toLowerCase() === matchedKey.toLowerCase())];
            
            if (definition) {
                const safeDef = DOMPurify.sanitize(definition, { ALLOWED_TAGS: [], ALLOWED_ATTR: ['data-tooltip'] });
                return `<span class="wiki-term" data-tooltip="${safeDef}">${match}</span>`;
            }
            return match;
        });
    }
    
    // 2. Добавляем звёздочку закладки
    const bookmarkActive = isBookmarked(section.title, 'article') ? 'active' : '';
    const bookmarkIcon = isBookmarked(section.title, 'article') ? '★' : '☆';
    
    const headerWithBookmark = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin: 0 0 20px 0; padding-bottom: 15px; border-bottom: 2px solid #edf2f7;">
            <h2 style="margin: 0; font-size: 24px; color: #1a365d; line-height: 1.3; flex: 1;">${escapeHtml(section.title)}</h2>
            <button class="bookmark-star-btn ${bookmarkActive}" id="section-bookmark-star" title="В закладки" style="margin-left: 15px; flex-shrink: 0;">${bookmarkIcon}</button>
        </div>
    `;
    
    // 3. Вставляем готовый HTML (wiki-теги уже встроены, повторная санитизация не нужна)
    contentContainer.innerHTML = `${headerWithBookmark}<div class="content-text">${safeRawContent}</div>`;
    
    // 4. Обработчик закладки в просмотрщике
    const starBtn = document.getElementById('section-bookmark-star');
    if (starBtn) {
        starBtn.addEventListener('click', () => {
            const added = toggleBookmark(section.title, section.title, 'article');
            updateBookmarkStar(starBtn, section.title, 'article');
            renderSectionsBookmarksPanel();
        });
    }
}

/** Рендер панели закладок для sections.html */
function renderSectionsBookmarksPanel() {
    const panel = document.getElementById('bookmarks-panel');
    if (!panel) return;
    
    renderBookmarksPanel(panel, 'article', (title) => {
        // При клике на закладку — ищем и открываем статью
        const sections = appDatabase.sections;
        if (!sections) return;
        for (const sec of sections) {
            const article = sec.articles.find(a => a.title === title);
            if (article) {
                showSectionContent(article);
                const viewer = document.querySelector('.section-viewer');
                if (viewer) viewer.scrollIntoView({ behavior: 'smooth' });
                return;
            }
        }
    });
}
