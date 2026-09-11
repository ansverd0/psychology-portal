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
                        document.querySelector('.ticket-viewer').scrollIntoView({ behavior: 'smooth' });
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
}

// ВЫСОКОПРОИЗВОДИТЕЛЬНЫЙ ДВИЖОК ВИКИ-ПОДСКАЗОК (Линейная O(N) замена)
function showSectionContent(section) {
    const contentContainer = document.querySelector('.section-viewer');
    if (!contentContainer || !section) return;
    
    let text = section.content;
    const terms = Object.keys(appGlossary);

    if (terms.length > 0) {
        // Сортировка терминов по длине (от длинных к коротким) для предотвращения разрушения вложенных слов
        const sortedTerms = terms.sort((a, b) => b.length - a.length);
        
        // Экранируем спецсимволы в терминах
        const escapedTerms = sortedTerms.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
        
        // Конструируем единое регулярное выражение для всех 300+ терминов одновременно
        const pattern = `\\b(${escapedTerms.join('|')})\\b`;
        const regex = new RegExp(pattern, 'gi');

        // Выполняем точечную замену за один проход по строке контента
        text = text.replace(regex, (match) => {
            const matchedKey = match.trim();
            // Находим точное соответствие в объекте кэша без учета регистра
            const definition = appGlossary[matchedKey] || 
                               appGlossary[sortedTerms.find(t => t.toLowerCase() === matchedKey.toLowerCase())];
            
            if (definition) {
                const safeDef = definition.replace(/"/g, '&quot;');
                return `<span class="wiki-term" data-tooltip="${safeDef}">${match}</span>`;
            }
            return match;
        });
    }
    
    contentContainer.innerHTML = `<h2>${section.title}</h2><div class="content-text">${text}</div>`;
}
