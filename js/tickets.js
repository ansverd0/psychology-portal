// Папка, открытая в навигации сейчас. Нужна, чтобы закладка помнила
// свою дисциплину: номера вопросов в разных дисциплинах повторяются.
let ticketsActiveFolderId = null;

function initTickets() {
    const examDisciplines = appDatabase.tickets;
    if (!examDisciplines || examDisciplines.length === 0) return;

    const foldersCol = document.getElementById('tickets-folders-col');
    const questionsCol = document.getElementById('tickets-questions-col');
    const tilesContainer = document.getElementById('mobile-tickets-tiles');
    const mobileQuestionsList = document.getElementById('mobile-questions-list');

    // 1. ДЛЯ ПК (ДВЕ КОЛОНКИ НАВИГАЦИИ: ПАПКИ + ВОПРОСЫ)
    if (foldersCol && questionsCol) {
        foldersCol.innerHTML = '';

        examDisciplines.forEach((discipline) => {
            const folderBtn = document.createElement('button');
            folderBtn.classList.add('folder-nav-btn');
            folderBtn.dataset.disciplineId = discipline.id;
            folderBtn.innerHTML = `${discipline.emoji || '📁'} ${discipline.title}`;

            folderBtn.addEventListener('click', () => {
                openTicketInNav(discipline);
            });

            foldersCol.appendChild(folderBtn);
        });

        // Открываем первую дисциплину по умолчанию
        openTicketInNav(examDisciplines[0]);
    }

    // 2. ДЛЯ МОБИЛЬНЫХ (ПЛИТКИ ДИСЦИПЛИН)
    if (tilesContainer && mobileQuestionsList) {
        tilesContainer.innerHTML = '';

        examDisciplines.forEach((discipline) => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            tile.setAttribute('aria-pressed', 'false');
            
            let icon = discipline.emoji || "📝";

            tile.innerHTML = `${icon}<br>${discipline.title}`;

            tile.addEventListener('click', () => {
                document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
                tile.classList.add('active');
                tile.setAttribute('aria-pressed', 'true');
                ticketsActiveFolderId = discipline.id;


                mobileQuestionsList.innerHTML = `<h4 style="margin: 5px 0 10px 5px; color: #718096; font-size: 13px;">Вопросы к экзамену:</h4>`;
                
                discipline.questions.forEach(q => {
                    const qBtn = document.createElement('button');
                    qBtn.classList.add('ticket-nav-btn');
                    qBtn.style.cssText = "margin-bottom: 5px; padding: 10px 12px; font-size: 14px;";
                    qBtn.innerText = `№${q.number}. ${q.title}`;

                    qBtn.addEventListener('click', () => {
                        showTicketContent(q);
                        // Зазор сверху, чтобы верхняя граница конспекта не упиралась
                        // в «потолок» окна (раунд 4)
                        scrollBlockIntoView(document.querySelector('.ticket-viewer'), 16);
                    });

                    mobileQuestionsList.appendChild(qBtn);
                });

                mobileQuestionsList.style.display = 'block';
            });

            tilesContainer.appendChild(tile);
        });
    }

    // 3. ЖИВОЙ ПОИСК ПО НАЗВАНИЯМ (U2-07)
    attachLiveSearch({
        inputId: 'mobile-tickets-search',
        resultsId: 'mobile-tickets-search-results',
        source: () => (appDatabase.tickets || []).flatMap((discipline) => discipline.questions.map((q) => ({
            title: q.title,
            label: `№${q.number}. ${q.title}`,
            category: discipline.title,
            payload: { discipline, question: q }
        }))),
        onPick: (item) => {
            openTicketInNav(item.payload.discipline, item.payload.question);
            scrollBlockIntoView(document.querySelector('.ticket-viewer'), 16);
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && mobileQuestionsList) {
            mobileQuestionsList.style.display = 'none';
            mobileQuestionsList.innerHTML = '';
            document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
        }
    });

    // Рендер панели закладок при инициализации
    renderTicketsBookmarksPanel();
}

/** Рисует список вопросов во второй колонке навигации.
 *  activeNumber — вопрос, который нужно подсветить и подматривать в него */
function renderQuestionsColumn(questions, container, activeNumber) {
    container.innerHTML = '';
    let activeBtn = null;

    questions.forEach(q => {
        const qBtn = document.createElement('button');
        qBtn.classList.add('question-nav-btn');
        qBtn.innerText = `№${q.number}: ${q.title}`;

        qBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.question-nav-btn').forEach(btn => { btn.classList.remove('active'); btn.removeAttribute('aria-current'); });
            qBtn.classList.add('active');
            qBtn.setAttribute('aria-current', 'true');
            showTicketContent(q);
        });

        container.appendChild(qBtn);

        if (activeNumber !== null && activeNumber !== undefined && q.number == activeNumber) {
            qBtn.classList.add('active');
            qBtn.setAttribute('aria-current', 'true');
            activeBtn = qBtn;
        }
    });

    if (activeBtn) scrollIntoContainer(container, activeBtn);
}

/** Единая точка открытия билета: подсвечивает папку, рисует вопросы, показывает ответ.
 *  Используется кликом по папке, загрузкой страницы и кликом по закладке */
function openTicketInNav(discipline, ticket) {
    const foldersCol = document.getElementById('tickets-folders-col');
    const questionsCol = document.getElementById('tickets-questions-col');
    if (!foldersCol || !questionsCol || !discipline) return;

    const target = ticket || discipline.questions[0] || null;
    ticketsActiveFolderId = discipline.id;

    if (window.PsyTracker) {
        // Журнал поведения не должен мешать навигации, даже если сам трекер сбоит
        try {
            PsyTracker.event('ticket_open', {
                number: String((target && target.number) || ''),
                discipline: discipline.id || ''
            });
        } catch (e) {
            console.warn('⚠️ Трекер: ticket_open не записан:', e);
        }
    }

    foldersCol.querySelectorAll('.folder-nav-btn').forEach(btn => {
        const isActive = btn.dataset.disciplineId === discipline.id;
        btn.classList.toggle('active', isActive);
        if (isActive) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
    });

    if (!target) {
        questionsCol.innerHTML = '<div class="questions-placeholder">Вопросов нет</div>';
        return;
    }

    renderQuestionsColumn(discipline.questions, questionsCol, target.number);
    showTicketContent(target);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/** Если DOMPurify не загрузился с CDN — не роняем страницу, а показываем текст */
function sanitizeDbHtml(html, config) {
    if (typeof DOMPurify === 'undefined') return escapeHtml(html || '');
    return DOMPurify.sanitize(html, config);
}

function showTicketContent(ticket) {
    const ticketContentContainer = document.querySelector('.ticket-viewer');
    if (!ticketContentContainer || !ticket) return;
    
    const litItems = ticket.literature ? ticket.literature.map(book => `<li>${escapeHtml(book)}</li>`).join('') : '';
    
    let timeHTML = '';
    if (ticket.time) {
        timeHTML = `<div style="color: #4a5568; font-size: 13px; font-weight: 600; margin-top: 8px;">⏱ Рекомендуемое время ответа: ~${ticket.time}</div>`;
    }

    let planHTML = '';
    if (ticket.plan) {
        planHTML = `
            <div style="background: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; color: #7b341e; margin-top: 15px;">
                <strong>📋 Рекомендуемый план ответа:</strong> ${escapeHtml(ticket.plan)}
            </div>
        `;
    }

    const bookmarkActive = isBookmarked(ticket.number, 'ticket') ? 'active' : '';
    const bookmarkIcon = isBookmarked(ticket.number, 'ticket') ? '★' : '☆';

    let aiHTML = '';
    if (ticket.ai) {
        aiHTML = `
            <div style="background: #fff5f5; border-left: 4px solid #c53030; padding: 10px 14px; border-radius: 6px; margin-bottom: 18px; font-size: 13px; color: #742a2a;">
                <strong>🤖 Контент сгенерирован при помощи ИИ.</strong> Проверяйте факты и сообщайте о неточностях — материал будет исправлен.
            </div>
        `;
    }

    // Санитизируем только контент (не заголовок и не кнопку закладки)
    const safeContent = sanitizeDbHtml(ticket.content, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'code', 'pre'],
        ALLOWED_ATTR: ['href', 'rel', 'target', 'src', 'alt']
    });

    ticketContentContainer.innerHTML = `
        <div style="border-bottom: 2px solid #edf2f7; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex: 1;">
                <h2 style="margin: 0; font-size: 24px; color: #1a365d; line-height: 1.3;">№${escapeHtml(ticket.number)}. ${escapeHtml(ticket.title)}</h2>
                ${timeHTML}
            </div>
            <button class="bookmark-star-btn ${bookmarkActive}" id="ticket-bookmark-star" data-bookmark-id="${escapeHtml(ticket.number)}" data-bookmark-type="ticket" aria-pressed="${bookmarkActive ? 'true' : 'false'}" title="${bookmarkActive ? 'Убрать из закладок' : 'В закладки'}">${bookmarkIcon}</button>
        </div>
        ${planHTML}
        ${aiHTML}
        <div class="content-text">${safeContent}</div>
        <div class="literature-box" style="margin-top: 25px;">
            <h3>📚 Рекомендованная литература к вопросу:</h3>
            <ul>${litItems}</ul>
        </div>
    `;
    
    // Обработчик закладки в просмотрщике: панель, модалка и звезда
    // перерисовываются по событию bookmarks:changed (U2-03)
    const starBtn = document.getElementById('ticket-bookmark-star');
    if (starBtn) {
        starBtn.addEventListener('click', () => {
            toggleBookmark(ticket.number, ticket.title, 'ticket', {
                number: ticket.number,
                folder: ticketsActiveFolderId
            });
        });
    }
}

/** Открывает билет из закладки: ищет его в сохранённой дисциплине, затем везде */
function openBookmarkedTicket(id, bookmark) {
    const examDisciplines = appDatabase.tickets;
    if (!examDisciplines) return;

    // Сначала ищем в той же дисциплине, где закладку создали
    // (номера вопросов между дисциплинами повторяются)
    let discipline = bookmark && bookmark.folder
        ? examDisciplines.find(d => d.id === bookmark.folder)
        : null;

    if (!discipline || !discipline.questions.some(q => q.number == id)) {
        discipline = examDisciplines.find(d => d.questions.some(q => q.number == id));
    }
    if (!discipline) return;

    const ticket = discipline.questions.find(q => q.number == id);
    openTicketInNav(discipline, ticket);

    scrollBlockIntoView(document.querySelector('.ticket-viewer'), 16);
}

/** Рендер панели закладок для tickets.html */
function renderTicketsBookmarksPanel() {
    // Модалка на телефоне открывает билет тем же обработчиком
    setBookmarkOpenHandler('ticket', openBookmarkedTicket);
    // Панель перерисовывается по bookmarks:changed, а не только по клику на звезду
    registerBookmarksPanelRenderer('ticket', renderTicketsBookmarksPanel);

    const panel = document.getElementById('bookmarks-panel');
    if (panel) {
        renderBookmarksPanel(panel, 'ticket', openBookmarkedTicket);
    }

    refreshBookmarksFab();
}
