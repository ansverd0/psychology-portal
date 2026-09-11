function initTickets() {
    const examDisciplines = appDatabase.tickets;
    if (!examDisciplines || examDisciplines.length === 0) return;

    const desktopContainer = document.getElementById('tickets-list-desktop');
    const tilesContainer = document.getElementById('mobile-tickets-tiles');
    const mobileQuestionsList = document.getElementById('mobile-questions-list');

    if (desktopContainer) desktopContainer.innerHTML = '';

    // 1. ДЛЯ ПК (АККОРДЕОН ДИСЦИПЛИН)
    if (desktopContainer) {
        examDisciplines.forEach((discipline) => {
            const branchBtn = document.createElement('button');
            branchBtn.classList.add('ticket-nav-btn', 'branch-title-btn');
            branchBtn.innerHTML = `📁 ${discipline.title}`;
            
            const submenuContainer = document.createElement('div');
            submenuContainer.classList.add('submenu-container');
            submenuContainer.style.display = 'none';

            discipline.questions.forEach(q => {
                const qBtn = document.createElement('button');
                qBtn.classList.add('submenu-item-btn');
                qBtn.innerText = `№${q.number}: ${q.title}`;
                
                qBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('#tickets-list-desktop .submenu-item-btn').forEach(btn => btn.classList.remove('active'));
                    qBtn.classList.add('active');
                    showTicketContent(q);
                });
                submenuContainer.appendChild(qBtn);
            });

            branchBtn.addEventListener('click', () => {
                const isOpened = submenuContainer.style.display === 'block';
                document.querySelectorAll('#tickets-list-desktop .submenu-container').forEach(sub => sub.style.display = 'none');
                document.querySelectorAll('#tickets-list-desktop .branch-title-btn').forEach(btn => btn.classList.remove('branch-active'));

                if (!isOpened) {
                    submenuContainer.style.display = 'block';
                    branchBtn.classList.add('branch-active');
                } else {
                    submenuContainer.style.display = 'none';
                }
            });

            desktopContainer.appendChild(branchBtn);
            desktopContainer.appendChild(submenuContainer);
        });
    }

    // 2. ДЛЯ МОБИЛЬНЫХ (ПЛИТКИ ДИСЦИПЛИН)
    if (tilesContainer && mobileQuestionsList) {
        tilesContainer.innerHTML = '';

        examDisciplines.forEach((discipline) => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            
            let icon = "📝";
            if (discipline.id === "general-exam") icon = "🧠";
            if (discipline.id === "social-exam") icon = "👥";
            if (discipline.id === "developmental-exam") icon = "🌱";

            tile.innerHTML = `${icon}<br>${discipline.title.replace(" (Экзамен)", "")}`;

            tile.addEventListener('click', () => {
                document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
                tile.classList.add('active');

                mobileQuestionsList.innerHTML = `<h4 style="margin: 5px 0 10px 5px; color: #718096; font-size: 13px;">Вопросы к экзамену:</h4>`;
                
                discipline.questions.forEach(q => {
                    const qBtn = document.createElement('button');
                    qBtn.classList.add('ticket-nav-btn');
                    qBtn.style.cssText = "margin-bottom: 5px; padding: 10px 12px; font-size: 14px;";
                    qBtn.innerText = `№${q.number}. ${q.title}`;

                    qBtn.addEventListener('click', () => {
                        showTicketContent(q);
                        document.querySelector('.ticket-viewer').scrollIntoView({ behavior: 'smooth' });
                    });

                    mobileQuestionsList.appendChild(qBtn);
                });

                mobileQuestionsList.style.display = 'block';
            });

            tilesContainer.appendChild(tile);
        });
    }

    // 3. ЖИВОЙ ПОИСК БИЛЕТОВ (МОБИЛЬНАЯ ВЕРСИЯ)
    const searchInput = document.getElementById('mobile-tickets-search');
    const resultsContainer = document.getElementById('mobile-tickets-search-results');

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

            examDisciplines.forEach(discipline => {
                discipline.questions.forEach(q => {
                    if (q.title.toLowerCase().includes(searchText)) {
                        matchesFound = true;

                        const button = document.createElement('button');
                        button.classList.add('search-suggest-item');
                        button.innerHTML = `
                            <span class="search-suggest-category">${discipline.title}</span>
                            <strong>№${q.number}. ${q.title}</strong>
                        `;

                        button.addEventListener('click', () => {
                            showTicketContent(q);
                            searchInput.value = q.title; 
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

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && mobileQuestionsList) {
            mobileQuestionsList.style.display = 'none';
            mobileQuestionsList.innerHTML = '';
            document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
        }
    });
}

function showTicketContent(ticket) {
    const ticketContentContainer = document.querySelector('.ticket-viewer');
    if (!ticketContentContainer || !ticket) return;
    
    const litItems = ticket.literature ? ticket.literature.map(book => `<li>${book}</li>`).join('') : '';
    
    let timeHTML = '';
    if (ticket.time) {
        timeHTML = `<div style="color: #4a5568; font-size: 13px; font-weight: 600; margin-top: 8px;">⏱ Рекомендуемое время ответа: ~${ticket.time}</div>`;
    }

    let planHTML = '';
    if (ticket.plan) {
        planHTML = `
            <div style="background: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; color: #7b341e; margin-top: 15px;">
                <strong>📋 Рекомендуемый план ответа:</strong> ${ticket.plan}
            </div>
        `;
    }
    
    ticketContentContainer.innerHTML = `
        <div style="border-bottom: 2px solid #edf2f7; padding-bottom: 12px; margin-bottom: 20px;">
            <h2 style="margin: 0; font-size: 24px; color: #1a365d; line-height: 1.3;">№${ticket.number}. ${ticket.title}</h2>
            ${timeHTML}
        </div>
        ${planHTML}
        <div class="content-text">${ticket.content}</div>
        <div class="literature-box" style="margin-top: 25px;">
            <h3>📚 Рекомендованная литература к вопросу:</h3>
            <ul>${litItems}</ul>
        </div>
    `;
}
