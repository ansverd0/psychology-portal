// Глобальные переменные для хранения данных
let appDatabase = {}; 
let currentCardIndex = 0;     
let currentTestIndex = 0; 
let score = 0;            

// Элементы модуля карточек
const cardElement = document.getElementById('myCard');
const termText = document.getElementById('term-text');
const definitionText = document.getElementById('definition-text');
const counterText = document.getElementById('counter-text');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

// Элементы модуля билетов
const ticketsListContainer = document.querySelector('.tickets-sidebar');
const ticketContentContainer = document.getElementById('ticket-content');

// Единая функция загрузки всей базы данных
async function loadDatabase() {
    try {
        const response = await fetch('database.json');
        appDatabase = await response.json();

        // Безопасный запуск модулей: каждый работает только на своей странице
        if (cardElement) {
            initFlashcards();
        }
        if (document.querySelector('.tickets-layout') && !document.getElementById('sections-page-marker')) {
            initTickets();
        }

        if (document.getElementById('quiz-wrapper')) {
            initQuiz();
        }
        if (document.getElementById('sections-page-marker')) {
            initSections();
        }
         if (document.getElementById('library-page-marker')) {
            initLibrary();
        }
        if (document.getElementById('news-page-marker')) {
            initNews();
        }
    } catch (error) {
        console.error("Ошибка загрузки базы данных:", error);
    }
}

// ==========================================
// ЛОГИКА МОДУЛЯ «ТРЕНАЖЕР ТЕРМИНОВ»
// ==========================================
// Глобальный массив, в котором хранятся карточки текущего выбранного режима
let currentActiveCards = [];

function initFlashcards() {
    const allCards = appDatabase.flashcards;
    if (!allCards || allCards.length === 0) return;

    const tilesContainer = document.getElementById('cards-discipline-tiles');
    
    // Алгоритм Фишера — Йетса для случайного перемешивания
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // Внутренняя функция запуска конкретного режима тренировки
    function startCardMode(filteredCards) {
        currentActiveCards = shuffleArray([...filteredCards]); // Копируем и тасуем
        currentCardIndex = 0;
        updateCard();
    }

    // --- ГЕНЕРАЦИЯ ПЛИТОК НАВИГАЦИИ ДЛЯ КАРТОЧЕК ---
    if (tilesContainer) {
        tilesContainer.innerHTML = '';

        // 1. Первая обязательная плитка: Общий микс по всему курсу
        const allTile = document.createElement('button');
        allTile.classList.add('mobile-tile-btn', 'active');
        allTile.innerHTML = `🎲<br>Все темы`;
        allTile.addEventListener('click', () => {
            document.querySelectorAll('#cards-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
            allTile.classList.add('active');
            startCardMode(allCards);
        });
        tilesContainer.appendChild(allTile);

        // 2. Динамические плитки: собираем только те разделы, которые реально прописаны в карточках
        const uniqueDisciplines = [...new Set(allCards.map(c => c.discipline).filter(Boolean))];
        
        // Карта названий и иконок для кнопок (должны совпадать с ID в вашей базе данных)
        const disciplineMeta = {
            "general-psych": { title: "Общая", icon: "🧠" },
            "age-psych": { title: "Возрастная", icon: "👶" },
            "ped-psych": { title: "Педагог.", icon: "🏫" },
            "psy-diag": { title: "Диагност.", icon: "📊" }
        };

        uniqueDisciplines.forEach(dispId => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            
            const meta = disciplineMeta[dispId] || { title: "Раздел", icon: "📁" };
            tile.innerHTML = `${meta.icon}<br>${meta.title}`;

            tile.addEventListener('click', () => {
                document.querySelectorAll('#cards-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
                tile.classList.add('active');
                
                // Оставляем карточки только выбранного раздела
                const filtered = allCards.filter(c => c.discipline === dispId);
                startCardMode(filtered);
            });
            tilesContainer.appendChild(tile);
        });
    }

    // По умолчанию включаем режим общего случайного микса
    startCardMode(allCards);

    // Сбрасываем старые обработчики кликов, чтобы избежать багов с ускоренным перелистыванием
    const newCardElement = cardElement.cloneNode(true);
    cardElement.parentNode.replaceChild(newCardElement, cardElement);
    const activeCard = document.getElementById('myCard');

    activeCard.addEventListener('click', () => {
        activeCard.classList.toggle('flipped');
    });

    nextBtn.onclick = () => {
        if (currentActiveCards.length === 0) return;
        if (currentCardIndex < currentActiveCards.length - 1) {
            currentCardIndex++;
        } else {
            currentCardIndex = 0;
        }
        updateCard();
    };

    prevBtn.onclick = () => {
        if (currentActiveCards.length === 0) return;
        if (currentCardIndex > 0) {
            currentCardIndex--;
        } else {
            currentCardIndex = currentActiveCards.length - 1;
        }
        updateCard();
    };
}

function updateCard() {
    if (!currentActiveCards || currentActiveCards.length === 0) {
        if (termText) termText.innerText = "В этой теме пока нет карточек";
        if (definitionText) definitionText.innerText = "Скоро они здесь появятся!";
        if (counterText) counterText.innerText = "0 / 0";
        return;
    }

    const activeCard = document.getElementById('myCard');
    if (activeCard) activeCard.classList.remove('flipped');
    
    const currentItem = currentActiveCards[currentCardIndex];
    
    const liveTermText = document.getElementById('term-text');
    const liveDefinitionText = document.getElementById('definition-text');
    
    if (liveTermText) liveTermText.innerText = currentItem.term;
    if (liveDefinitionText) liveDefinitionText.innerText = currentItem.definition;
    if (counterText) counterText.innerText = `${currentCardIndex + 1} / ${currentActiveCards.length}`;
}


// ==========================================
// ЛОГИКА МОДУЛЯ «ЭКЗАМЕНАЦИОННЫЕ БИЛЕТЫ»
// ==========================================
function initTickets() {
    const examDisciplines = appDatabase.tickets;
    if (!examDisciplines || examDisciplines.length === 0) return;

    const desktopContainer = document.getElementById('tickets-list-desktop');
    const tilesContainer = document.getElementById('mobile-tickets-tiles');
    const mobileQuestionsList = document.getElementById('mobile-questions-list');

    if (desktopContainer) desktopContainer.innerHTML = '';

    // --- 1. ДЛЯ ПК (АККОРДЕОН ДИСЦИПЛИН) ---
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

    // --- 2. ДЛЯ МОБИЛЬНЫХ (ПЛИТКИ ДИСЦИПЛИН) ---
    if (tilesContainer && mobileQuestionsList) {
        tilesContainer.innerHTML = '';

        examDisciplines.forEach((discipline) => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            
            let icon = "📝";
            if (discipline.id === "age-exam") icon = "👶";
            if (discipline.id === "diag-exam") icon = "📊";
            if (discipline.id === "social-exam") icon = "👥";

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

    // --- 3. ЖИВОЙ ПОИСК ДЛЯ МОБИЛЬНОЙ ВЕРСИИ ---
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

    // Баг-фикс ресайза окна
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
    
        // 1. Время ответа выведется аккуратной строчкой под заголовком
    let timeHTML = '';
    if (ticket.time) {
        timeHTML = `<div style="color: #4a5568; font-size: 13px; font-weight: 600; margin-top: 8px;">⏱ Рекомендуемое время ответа: ~${ticket.time}</div>`;
    }

    // 2. Формируем плашку плана ответа
    let planHTML = '';
    if (ticket.plan) {
        planHTML = `
            <div style="background: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; color: #7b341e; margin-top: 15px;">
                <strong>📋 Рекомендуемый план ответа:</strong> ${ticket.plan}
            </div>
        `;
    }
    
    // Заливаем в окно просмотра (заголовок теперь не будет ломаться)
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


// ==========================================
// ЛОГИКА МОДУЛЯ «ИНТЕРАКТИВНЫЕ ТЕСТЫ»
// ==========================================
// Глобальные переменные для управления текущим режимом теста
let currentActiveQuestions = [];

function initQuiz() {
    const allQuestions = appDatabase.tests;
    if (!allQuestions || allQuestions.length === 0) return;

    const quizTilesContainer = document.getElementById('quiz-discipline-tiles');

    // Алгоритм Фишера — Йетса для случайного перемешивания вопросов
    function shuffleQuestions(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // Внутренняя функция запуска конкретного режима теста
    function startQuizMode(filteredQuestions) {
        currentActiveQuestions = shuffleQuestions([...filteredQuestions]); // Копируем и перемешиваем
        currentTestIndex = 0;
        score = 0;
        
        // Возвращаем видимость тесту и прячем экран результатов (если он был открыт)
        document.getElementById('quiz-wrapper').style.display = 'block';
        document.getElementById('result-wrapper').style.display = 'none';
        
        // Удаляем старую шкалу прогресса и кнопку работы над ошибками, чтобы пересчитать заново
        const oldProgress = document.querySelector('.result-progress-container');
        if (oldProgress) oldProgress.remove();
        const oldBtn = document.querySelector('.review-theme-btn');
        if (oldBtn) oldBtn.remove();

        showQuestion();
    }

    // --- ГЕНЕРАЦИЯ ПЛИТОК НАВИГАЦИИ ДЛЯ ТЕСТОВ ---
    if (quizTilesContainer) {
        quizTilesContainer.innerHTML = '';

        // 1. Первая обязательная плитка: Общий микс по всем вопросам
        const allTile = document.createElement('button');
        allTile.classList.add('mobile-tile-btn', 'active');
        allTile.innerHTML = `🎲<br>Все темы`;
        allTile.addEventListener('click', () => {
            document.querySelectorAll('#quiz-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
            allTile.classList.add('active');
            startQuizMode(allQuestions);
        });
        quizTilesContainer.appendChild(allTile);

        // 2. Динамические плитки: собираем только те разделы, для которых есть вопросы
        const uniqueQuizDisciplines = [...new Set(allQuestions.map(q => q.discipline).filter(Boolean))];
        
        const disciplineMeta = {
            "general-psych": { title: "Общая", icon: "🧠" },
            "age-psych": { title: "Возрастная", icon: "👶" },
            "ped-psych": { title: "Педагог.", icon: "🏫" },
            "psy-diag": { title: "Диагност.", icon: "📊" }
        };

        uniqueQuizDisciplines.forEach(dispId => {
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            
            const meta = disciplineMeta[dispId] || { title: "Раздел", icon: "📁" };
            tile.innerHTML = `${meta.icon}<br>${meta.title}`;

            tile.addEventListener('click', () => {
                document.querySelectorAll('#quiz-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
                tile.classList.add('active');
                
                const filtered = allQuestions.filter(q => q.discipline === dispId);
                startQuizMode(filtered);
            });
            quizTilesContainer.appendChild(tile);
        });
    }

    // По умолчанию запускаем общий микс при загрузке страницы
    startQuizMode(allQuestions);

    // Привязываем клик к кнопке "Следующий вопрос" (один раз)
    const quizNextBtn = document.getElementById('quiz-next-btn');
    // Очищаем старые привязки через замену элемента на самого себя, чтобы избежать багов перезапуска
    const newNextBtn = quizNextBtn.cloneNode(true);
    quizNextBtn.parentNode.replaceChild(newNextBtn, quizNextBtn);

    newNextBtn.addEventListener('click', () => {
        currentTestIndex++;
        if (currentTestIndex < currentActiveQuestions.length) {
            showQuestion();
        } else {
            showResults();
        }
    });
}

function showQuestion() {
    if (!currentActiveQuestions || currentActiveQuestions.length === 0) {
        document.getElementById('quiz-question').innerText = "В этой теме пока нет тестовых вопросов.";
        document.getElementById('quiz-options').innerHTML = "";
        document.getElementById('quiz-progress').innerText = "0 / 0";
        document.getElementById('quiz-next-btn').style.display = 'none';
        return;
    }

    // Удаляем кнопку повторения темы от прошлого вопроса
    const oldBtn = document.querySelector('.review-theme-btn');
    if (oldBtn) oldBtn.remove();

    const currentQuestion = currentActiveQuestions[currentTestIndex];
    const quizQuestionElement = document.getElementById('quiz-question');
    const quizOptionsContainer = document.getElementById('quiz-options');
    const quizProgressElement = document.getElementById('quiz-progress');
    const quizNextBtn = document.getElementById('quiz-next-btn');

    quizQuestionElement.innerText = currentQuestion.question;
    quizProgressElement.innerText = `Вопрос ${currentTestIndex + 1} из ${currentActiveQuestions.length}`;
    quizOptionsContainer.innerHTML = '';
    quizNextBtn.style.display = 'none';

    currentQuestion.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.classList.add('option-btn');
        button.innerText = option;
        button.addEventListener('click', () => handleAnswer(button, index, currentQuestion.correct));
        quizOptionsContainer.appendChild(button);
    });
}

function handleAnswer(selectedButton, selectedIndex, correctIndex) {
    const quizOptionsContainer = document.getElementById('quiz-options');
    const allButtons = quizOptionsContainer.querySelectorAll('.option-btn');
    const quizNextBtn = document.getElementById('quiz-next-btn');
    const currentQuestion = currentActiveQuestions[currentTestIndex];

    if (selectedButton.classList.contains('disabled')) return;

    const oldBtn = document.querySelector('.review-theme-btn');
    if (oldBtn) oldBtn.remove();

    if (selectedIndex === correctIndex) {
        selectedButton.classList.add('correct');
        score++;
    } else {
        selectedButton.classList.add('wrong');
        allButtons[correctIndex].classList.add('correct');

        if (currentQuestion.link) {
            const reviewLink = document.createElement('a');
            reviewLink.href = currentQuestion.link;
            reviewLink.classList.add('review-theme-btn');
            reviewLink.innerHTML = `📖 Повторить тему конспекта`;
            quizOptionsContainer.appendChild(reviewLink);
        }
    }

    allButtons.forEach(btn => btn.classList.add('disabled'));
    quizNextBtn.style.display = 'block';
}

function showResults() {
    document.getElementById('quiz-wrapper').style.display = 'none';
    document.getElementById('result-wrapper').style.display = 'block';
    
    const oldBtn = document.querySelector('.review-theme-btn');
    if (oldBtn) oldBtn.remove();

    document.getElementById('score-text').innerText = `${score} из ${currentActiveQuestions.length}`;

    const percentage = currentActiveQuestions.length > 0 ? (score / currentActiveQuestions.length) * 100 : 0;
    
    const scoreTextElement = document.getElementById('score-text');
    let progressContainer = document.querySelector('.result-progress-container');
    
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.classList.add('result-progress-container');
        progressContainer.innerHTML = `<div class="result-progress-bar"><span class="progress-bar-text"></span></div>`;
        scoreTextElement.after(progressContainer);
    }
    
    const progressBar = progressContainer.querySelector('.result-progress-bar');
    const progressBarText = progressContainer.querySelector('.progress-bar-text');
    
    if (percentage >= 75) {
        progressBar.style.backgroundColor = '#38a169'; 
    } else if (percentage >= 50) {
        progressBar.style.backgroundColor = '#ecc94b'; 
    } else {
        progressBar.style.backgroundColor = '#e53e3e'; 
    }
    
    setTimeout(() => {
        progressBar.style.width = `${percentage}%`;
        progressBarText.innerText = `${Math.round(percentage)}%`;
    }, 100);

    const resultFeedback = document.getElementById('result-feedback');
    if (resultFeedback) {
        if (percentage === 100) {
            resultFeedback.innerText = "Великолепный результат! Вы идеально владеете материалом. Экзамены и зачёты вам точно по плечу! 🎯";
        } else if (percentage >= 50) {
            resultFeedback.innerText = "Хороший результат, но есть куда расти. Рекомендуем еще раз заглянуть в раздел «Экзаменационные билеты» и повторить теорию. 👍";
        } else {
            resultFeedback.innerText = "Материал усвоен слабо. Не переживайте, для этого мы и создали этот хаб. Прочитайте конспекты билетов и попробуйте пройти тест снова! 💪";
        }
    }
}



// ==========================================
// ЛОГИКА МОДУЛЯ «РАЗДЕЛЫ ПСИХОЛОГИИ»
// ==========================================
function initSections() {
    const sections = appDatabase.sections;
    if (!sections || sections.length === 0) return;

    const desktopContainer = document.getElementById('sections-list-desktop');
    const mobileSelect = document.getElementById('sections-list-mobile');

    if (desktopContainer) desktopContainer.innerHTML = '';
    if (mobileSelect) {
        mobileSelect.innerHTML = '<option value="" disabled selected>📋 Выберите раздел и тему...</option>';
    }

    sections.forEach((section) => {
        // --- ДЛЯ ПК (АККОРДЕОННОЕ ДВУХУРОВНЕВОЕ МЕНЮ) ---
        if (desktopContainer) {
            // Кнопка главной отрасли
            const branchBtn = document.createElement('button');
            branchBtn.classList.add('ticket-nav-btn', 'branch-title-btn');
            branchBtn.innerHTML = `📁 ${section.title}`;
            
            // Контейнер для вложенных статей (по умолчанию скрыт)
            const submenuContainer = document.createElement('div');
            submenuContainer.classList.add('submenu-container');
            submenuContainer.style.display = 'none';

            // Наполняем подменю статьями этой отрасли
            section.articles.forEach(article => {
                const articleBtn = document.createElement('button');
                articleBtn.classList.add('submenu-item-btn');
                articleBtn.innerText = article.title;
                
                articleBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Защита от закрытия меню при клике на статью
                    document.querySelectorAll('.submenu-item-btn').forEach(btn => btn.classList.remove('active'));
                    articleBtn.classList.add('active');
                    showSectionContent(article);
                });
                submenuContainer.appendChild(articleBtn);
            });

            // Логика раскрытия/закрытия отрасли
            branchBtn.addEventListener('click', () => {
                const isOpened = submenuContainer.style.styleText === 'display: block;' || submenuContainer.style.display === 'block';
                
                // Закрываем все остальные открытые отрасли, чтобы был порядок
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
    // Логика живых подсказок (автокомплита) для мобильной версии
    const searchInput = document.getElementById('mobile-search-input');
    const resultsContainer = document.getElementById('mobile-search-results');

    if (searchInput && resultsContainer) {
        searchInput.addEventListener('input', (e) => {
            const searchText = e.target.value.toLowerCase().trim();
            resultsContainer.innerHTML = ''; // Очищаем старые подсказки

            if (searchText === '') {
                resultsContainer.style.display = 'none';
                searchInput.classList.remove('open-dropdown');
                return;
            }

            let matchesFound = false;

            // Пробегаемся по всем отраслям и статьям в базе данных
            sections.forEach(section => {
                section.articles.forEach(article => {
                    if (article.title.toLowerCase().includes(searchText)) {
                        matchesFound = true;

                        // Создаем интерактивную кнопку для подсказки
                        const button = document.createElement('button');
                        button.classList.add('search-suggest-item');
                        button.innerHTML = `
                            <span class="search-suggest-category">${section.title}</span>
                            <strong>${article.title}</strong>
                        `;

                        // При клике на подсказку — показываем статью и закрываем список
                        button.addEventListener('click', () => {
                            showSectionContent(article);
                            searchInput.value = article.title; // Подставляем имя в инпут
                            resultsContainer.style.display = 'none';
                            searchInput.classList.remove('open-dropdown');
                        });

                        resultsContainer.appendChild(button);
                    }
                });
            });

            // Показываем или скрываем блок в зависимости от результатов
            if (matchesFound) {
                resultsContainer.style.display = 'block';
                searchInput.classList.add('open-dropdown');
            } else {
                resultsContainer.innerHTML = '<div style="padding: 15px; color: #718096; text-align:center; font-size:14px;">Ничего не найдено 😕</div>';
                resultsContainer.style.display = 'block';
                searchInput.classList.add('open-dropdown');
            }
        });

        // Закрытие списка при клике мимо него
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
                resultsContainer.style.display = 'none';
                searchInput.classList.remove('open-dropdown');
            }
        });
    }
    // Логика плиток-разделов для мобильной версии (Вариант 2)
    const tilesContainer = document.getElementById('mobile-sections-tiles');
    const mobileArticlesList = document.getElementById('mobile-articles-list');

    if (tilesContainer && mobileArticlesList) {
        tilesContainer.innerHTML = ''; // Очищаем контейнер

        sections.forEach((section) => {
            // Создаем плитку для каждой отрасли (Общая, Возрастная и т.д.)
            const tile = document.createElement('button');
            tile.classList.add('mobile-tile-btn');
            
            // Подбираем иконку в зависимости от ID раздела
            let icon = "📁";
            if (section.id === "general-psych") icon = "🧠";
            if (section.id === "age-psych") icon = "👶";
            if (section.id === "ped-psych") icon = "🏫";
            if (section.id === "psy-diag") icon = "📊";

            tile.innerHTML = `${icon}<br>${section.title}`;

            // При клике на плитку — показываем список её статей
            tile.addEventListener('click', () => {
                // Снимаем активный класс со всех плиток и вешаем на текущую
                document.querySelectorAll('.mobile-tile-btn').forEach(b => b.classList.remove('active'));
                tile.classList.add('active');

                // Очищаем и заполняем список статей
                mobileArticlesList.innerHTML = `<h4 style="margin: 5px 0 10px 5px; color: #718096; font-size: 13px;">Статьи раздела:</h4>`;
                
                section.articles.forEach(article => {
                    const articleBtn = document.createElement('button');
                    articleBtn.classList.add('ticket-nav-btn');
                    articleBtn.style.cssText = "margin-bottom: 5px; padding: 10px 12px; font-size: 14px;";
                    articleBtn.innerText = article.title;

                    // Клик по статье открывает её контент в окне просмотра
                    articleBtn.addEventListener('click', () => {
                        showSectionContent(article);
                        // Плавно скроллим экран вниз к тексту статьи, чтобы студент сразу видел контент
                        document.querySelector('.ticket-viewer').scrollIntoView({ behavior: 'smooth' });
                    });

                    mobileArticlesList.appendChild(articleBtn);
                });

                mobileArticlesList.style.display = 'block';
            });

            tilesContainer.appendChild(tile);
        });
    }
        // Прячем мобильный список статей при переходе на ПК-экран (решает баг с зависанием надписи)
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && mobileArticlesList) {
            mobileArticlesList.style.display = 'none';
            mobileArticlesList.innerHTML = '';
            document.querySelectorAll('.mobile-tile-btn').forEach(b => b.classList.remove('active'));
        }
    });
        // МЕТОДИЧЕСКИЙ UX: Автоматическое открытие нужного раздела при переходе из тестов
    const urlParams = new URLSearchParams(window.location.search);
    const targetDiscipline = urlParams.get('discipline');

    if (targetDiscipline) {
        // Проверяем, ПК это или мобильная версия
        if (window.innerWidth > 768) {
            // На ПК находим нужную кнопку дисциплины в аккордеоне и эмулируем клик по ней
            const branchButtons = document.querySelectorAll('#sections-list-desktop .branch-title-btn');
            branchButtons.forEach(btn => {
                // Если в тексте или ID кнопки есть совпадение — раскрываем её
                if (btn.nextElementSibling && btn.outerHTML.includes(targetDiscipline)) {
                    btn.click();
                }
            });
        } else {
            // На мобилках находим нужную плитку и эмулируем нажатие пальцем
            const mobileTiles = document.querySelectorAll('#mobile-sections-tiles .mobile-tile-btn');
            mobileTiles.forEach(tile => {
                if (tile.outerHTML.includes(targetDiscipline)) {
                    tile.click();
                }
            });
        }
    }
}


// Словарь методических терминов для автоподсказок (Вики-эффект)
const psychologyGlossary = {
    "ВПФ": "Высшие психические функции — сложные, прижизненно формирующиеся психические процессы (логическая память, целенаправленное внимание, мышление, речь).",
    "ЗБР": "Зона ближайшего развития — область еще не созревших, но находящихся в процессе созревания психических процессов (выполняется с помощью взрослого).",
    "интериоризация": "Переход внешних практических действий во внутренний, психический план (формирование внутреннего мира человека).",
    "ведущая деятельность": "Деятельность, в связи с которой происходят главные изменения в психике ребенка и внутри которой развиваются новые процессы.",
    "психологического диагноза": "Комплексное структурированное описание психологических свойств человека, сгруппированных по степени значимости и родственности происхождения.",
    "Симптоматический": "Уровень диагноза, при котором устанавливаются лишь отдельные особенности обследуемого, без указания на их причины.",
    "Этиологический": "Уровень диагноза, направленный на точное определение причин обнаруженного психологического явления или отклонения.",
    "Типологический": "Высший уровень диагноза, определяющий место и значение полученных данных в целостной динамической картине личности.",
    "Формализованные методы": "Методы (тесты, опросники, аппаратура), требующие строгой стандартизации процедуры, бланков, инструкций, а также обладающие доказанной надежностью и валидностью.",
    "Малоформализованные методы": "Методы (наблюдение, беседа, анализ продуктов деятельности), направленные на фиксацию гибких, изменчивых и трудно поддающихся объективизации явлений.",
    "естественный эксперимент": "Метод А.Ф. Лазурского: человек находится в привычных для него условиях деятельности, но ситуация контролируется исследователем, причем испытуемый не знает об обследовании.",
    "бихевиоризма": "Бихевиоризм — направление в психологии, определяющее поведение как совокупность объективных реакций организма на стимулы внешней среды (схема С-Р).",
    "Стандартизация": "Единообразие процедуры проведения и оценки выполнения методики (выработка единых требований к процедуре и критериев оценки).",
    "Надежность": "Психометрический критерий, отражающий относительное постоянство, устойчивость и согласованность результатов методики при ее повторном применении.",
    "Валидность": "Комплексная характеристика пригодности методики для измерения именно того психического свойства, для оценки которого она создавалась.",
    "тест валиден,": "Психометрическая норма: методика считается валидной, если она действительно измеряет то качество, которое задекларировано автором.",
    "кристаллизованный интеллект": "Компонент интеллекта, отражающий накопленный жизненный опыт, культуру, образование и системные знания. Растет на протяжении всей жизни.",
    "текучий интеллект": "Компонент интеллекта, отражающий врожденную скорость переработки информации и обучаемость. Зависит от особенностей нервной системы и падает с возрастом.",
    "дивергентное мышление": "Метод мышления (по Дж. Гилфорду), направленный на поиск множества различных, одинаково правильных решений одной и той же проблемы.",
    "акцентуированные": "Акцентуация характера — крайний вариант нормы, при котором отдельные черты характера чрезмерно усилены, что создает уязвимость к определенным стрессам.",
    "дезадаптированную": "Психологическая дезадаптация — состояние, при котором личность не может приспособиться к условиям среды (школы, семьи), что ведет к нарушениям поведения.",
    "эгоцентрический": "Тип эмпатии (по Т.П. Гавриловой), при котором переживания за другого человека строятся сквозь призму личного удобства или собственной выгоды.",
    "гуманистический": "Высший тип эмпатии (по Т.П. Гавриловой), выражающийся в безусловном сопереживании другому существу и принятии решений в его пользу.",
    "социометрия": "Метод изучения структуры эмоциональных отношений в малой группе через процедуру гипотетических положительных и отрицательных выборов.",
    "аутосоциометрию": "Процедура оценки социально-рефлексивных навыков: изучение представлений человека о том, как к нему относятся члены его группы.",
    "референтометрию": "Диагностическая процедура, направленная на выявление круга референтных лиц, обладающих наивысшей ценностной значимостью для членов группы.",
    "интернальный": "Внутренний локус контроля: склонность личности брать ответственность за все события своей жизни на себя, объясняя их своими усилиями.",
    "экстернальный": "Внешний локус контроля: склонность личности объяснять все свои успехи и неудачи внешними факторами (судьбой, везением, действиями других).",
    "психики": "Психика — системное свойство высокоорганизованной материи, заключающееся в активном отражении субъектом объективного мира и регуляции на этой основе своего поведения.",
    "сознания": "Сознание — высшая, свойственная только человеку форма обобщенного отражения объективных устойчивых свойств и закономерностей окружающего мира.",
    "деятельности": "Деятельность — динамическая, саморазвивающаяся система взаимодействий субъекта с миром, в процессе которых происходят и воплощаются в объекте психические процессы.",
        "интроспекции": "Интроспекция — метод психологического исследования, заключающийся в самонаблюдении человека за собственными психическими процессами и переживаниями.",
    "детерминизма": "Принцип детерминизма — научный принцип, утверждающий, что все психические явления причинно обусловлены воздействием факторов внешней среды и субстратом мозга.",
    "системности": "Принцип системности — методологический подход, требующий рассматривать психику как сложную систему, обладающую целостностью и внутренней структурой.",
    "детерминирован": "Обусловлен причинно-следственными связями, внешними воздействиями или внутренними факторами.",
"филогенезе": "Филогенез — историческое, эволюционное развитие живых организмов и их психических структур от простейших форм до человека.",
"онтогенезе": "Онтогенез — процесс индивидуального развития человеческого организма и его психики с момента зарождения до окончания жизненного пути.",
"Психофизиологическая проблема": "Фундаментальный вопрос психологии о соотношении ментальных (психических) процессов и материальных процессов в головном мозге.",
"Психосоциальная проблема": "Проблема соотношения и взаимодействия биологических (природных) и социальных (культурных) факторов в развитии психики и личности.",
"Психопрактическая проблема": "Методологический вопрос о взаимосвязи внутреннего психического мира человека и его внешней практической деятельности.",
"Психогностическая проблема": "Проблема отношения психического образа к отражаемой им объективной реальности (вопрос о точности и границах познания мира).",
"дифференциальная психология": "Отрасль психологической науки, изучающая индивидуально-психологические различия между людьми и группами людей.",
"психогенетика": "Междисциплинарная область знаний, исследующая роль наследственности (генетических факторов) и среды в формировании психических свойств и поведения.",
"инженерная психология": "Отрасль психологии, исследующая процессы и закономерности информационного взаимодействия между человеком и сложной техникой (системами управления).",
"сравнительная психология": "Отрасль психологии, изучающая сходства и различия в психической деятельности и поведении между животными и человеком, а также эволюцию психики.",
"специальная психология": "Отрасль психологии, изучающая закономерности развития и особенности психики людей с различными нарушениями или отклонениями (дефектами) в развитии.",
"организационная психология": "Прикладная отрасль психологии, изучающая поведение людей в организациях, психологические аспекты менеджмента, мотивации персонала и лидерства.",
"лонгитюдный метод": "Метод длительного и систематического изучения одних и тех же испытуемых на протяжении длительного времени (от нескольких месяцев до десятков лет).",
"праксиметрические методы": "Методы исследования психических особенностей человека через объективный анализ процессов и продуктов его деятельности (тетрадей, рисунков, поделок, хронометрии движений).",
"биографические методы": "Способы сбора, организации и анализа данных о жизненном пути человека, его биографии, дневниковых записях и воспоминаниях для понимания его личности.",
"факторный анализ": "Многомерный метод математической статистики, применяемый для выявления скрытых общих закономерностей (факторов), объединяющих группу взаимосвязанных признаков.",
"контент-анализ": "Научный метод качественного и количественного анализа содержания текстов, документов или аудиовизуальных материалов с целью выявления скрытых смыслов или тенденций.",
"интерпретационные методы": "Группа методов (по Б.Г. Ананьеву), направленная на теоретическое осмысление, объяснение и истолкование полученных в исследовании числовых и качественных данных.",
"включенное наблюдение": "Вид наблюдения, при котором исследователь непосредственно внедряется в изучаемую группу и становится её полноправным участником.",
"структурированное наблюдение": "Метод сбора данных, при котором исследователь заранее определяет, какие именно поведенческие акты будут фиксироваться, используя жесткие бланки и схемы.",
"лабораторное наблюдение": "Изучение психических явлений в искусственно созданных, контролируемых условиях (например, через скрытую камеру или одностороннее стекло Гезелла).",
"эффект реактивности": "Изменение естественного поведения испытуемого, вызванное тем фактом, что он знает об осуществлении наблюдения или эксперимента за ним.",
"история индивида": "Метод сбора и анализа данных о прошлом человека (реконструкция его биографии) с целью объяснения его текущих психологических проблем или особенностей поведения.",
"независимая переменная": "Фактор, условия или стимулы, которые целенаправленно изменяются, дозируются или контролируются экспериментатором в научном исследовании.",
"зависимая переменная": "Психологические процессы, поведенческие акты или реакции испытуемого, которые изменяются под воздействием независимой переменной.",
"формирующий эксперимент": "Метод исследования (в отечественной психологии), направленный на активное развитие или конструирование психических качеств в процессе обучения.",
"метод срезов": "Исследовательский подход (метод поперечных срезов), при котором одновременно сравниваются группы людей разного возраста по одним и тем же параметрам.",
"патопсихология": "Практическая отрасль клинической психологии, изучающая закономерности распада психической деятельности и личности при психических заболеваниях.",
"репрезентативная выборка": "Группа испытуемых, по своим основным характеристикам (возрасту, полу, социальному положению) точно отражающая свойства всей генеральной совокупности.",
"психометрика": "Область психологии, посвященная теории и методам психологических измерений, включая разработку, валидизацию и стандартизацию тестов.",
"тесты достижений": "Краткие стандартизированные задания, предназначенные для оценки степени усвоения конкретных учебных программ, знаний или навыков.",
"тесты способностей": "Методики, направленные на оценку потенциальных возможностей человека в успешном освоении определенных видов деятельности (музыкальной, технической).",
"социальная желательность": "Тенденция испытуемых при заполнении личностных опросников давать ответы, одобряемые обществом, скрывая свои реальные особенности.",
"социометрия": "Метод изучения структуры эмоциональных и межличностных отношений в малой группе через процедуру фиксации гипотетических выборов.",
"клиническая беседа": "Метод Ж. Пиаже, при котором тактика и вопросы исследователя гибко меняются в зависимости от текущих ответов и рассуждений ребенка.",
"конфиденциальность": "Этический принцип, гарантирующий строгое сохранение в тайне личной информации и результатов психологического обследования.",
"информированное согласие": "Добровольное согласие испытуемого на участие в исследовании, полученное после ознакомления с его целями, процедурой и условиями.",
"дебрифинг": "Итоговая этическая процедура/беседа после окончания эксперимента, в ходе которой испытуемому объясняют истинные цели исследования и снимают стресс.",
"анализатор": "Сложный нервный механизм (по И.П. Павлову), состоящий из рецептора, проводящих нервных путей и центрального коркового отдела, осуществляющий прием и анализ раздражителей.",
"модальность": "Качественная характеристика ощущений, определяющая их принадлежность к определенной сенсорной системе (зрение, слух, осязание, вкус, обоняние).",
"интероцептивные ощущения": "Ощущения, отражающие внутреннее состояние организма и работу его органов (голод, жажда, внутренняя боль).",
"проприоцептивные ощущения": "Ощущения, сигнализирующие о положении частей тела в пространстве, движении и мышечном напряжении (кинестезия и баланс).",
"экстероцептивные ощущения": "Группа ощущений, отражающих свойства предметов и явлений внешнего мира (зрение, слух, вкус, обоняние, осязание).",
"протопатическая чувствительность": "Филогенетически более древняя, примитивная форма чувствительности, характеризующаяся смутными, труднолокализуемыми и эмоционально окрашенными ощущениями.",
"эпикритическая чувствительность": "Филогенетически более молодая и совершенная форма чувствительности, обеспечивающая четкое, раздельное и точно локализованное восприятие качеств стимула.",
"психофизика": "Область психологии, изучающая количественные соотношения между физическими характеристиками стимулов и интенсивностью вызываемых ими ощущений.",
"абсолютный порог": "Минимальная (нижний порог) или максимальная (верхний порог) интенсивность физического стимула, вызывающая едва заметное ощущение или боль.",
"дифференциальный порог": "Минимальное различие в интенсивности между двумя раздражителями, которое способна зафиксировать сенсорная система для их различения.",
"психометрия": "Дисциплина, занимающаяся разработкой теории и методов количественного измерения различных психических процессов, свойств и порогов.",
"Теория обнаружения сигнала": "Современный подход в психофизике, утверждающий, что восприятие стимула происходит на фоне непрерывного шума и включает когнитивный компонент принятия решения.",
"сенсибилизация": "Процесс временного или стойкого повышения чувствительности анализаторов, вызванный взаимодействием органов чувств или специальными тренировками.",
"синестезия": "Межмодальное взаимодействие ощущений, при котором стимуляция одной сенсорной системы автоматически вызывает соощущение в другой (например, цветной слух).",
"аносмия": "Полная потеря обонятельной чувствительности, неспособность воспринимать и различать любые запахи окружающего мира.",
"фантосмия": "Специфическое нарушение обоняния, выражающееся в восприятии воображаемых, мнимых запахов (обонятельный галлюциноз) при отсутствии реального раздражителя.",
"агевзия": "Клиническое нарушение вкусового анализатора, выражающееся в полной потере способности испытывать вкусовые ощущения.",
"константность": "Свойство восприятия, выражающееся в относительной стабильности перцептивных признаков предмета (размера, формы, цвета) при изменении условий наблюдения.",
"конфигурация": "Взаимное расположение элементов или частей предмета, образующее его внешние очертания и пространственную форму.",
"фигуры и фона": "Фундаментальный феномен гештальт-психологии, определяющий разделение зрительного поля на центральный объект (фигуру) и аморфную среду (фон).",
"Закон близости": "Перцептивный закон гештальт-психологии, согласно которому объекты, расположенные рядом друг с другом, воспринимаются как единая группа.",
"Закон замкнутости": "Тенденция зрительной системы мысленно объединять и достраивать прерывистые или разорванные контуры объектов до целостной фигуры.",
"перцептивное действие": "Структурная единица процесса восприятия (по А.В. Запорожцу), представляющая собой активное ментальное или двигательное моделирование свойств объекта.",
"экологический подход": "Теория Дж. Гибсона, постулирующая прямое, непосредственное восприятие информации из окружающей среды без сложных когнитивных вычислений мозга.",
"оптический поток": "Динамическая структура световых лучей, непрерывно изменяющаяся на сетчатке глаза при движении наблюдателя в пространстве и несущая полную информацию о среде.",
"схема": "Когнитивная структура или мысленный шаблон (по У. Найссеру), предвосхищающий появление стимулов и направляющий процесс активного восприятия.",
"перцептивный цикл": "Непрерывный процесс взаимодействия когнитивной схемы, поисковой активности и извлекаемой из внешней среды информации в концепции У. Найссера.",
"мнемическая работа": "Совокупность активных психических действий, направленных на запечатление, структурирование, сохранение и извлечение информации в памяти.",
"реминисценция": "Мнемический феномен, выражающийся в более полном и качественном воспроизведении заученного материала через некоторое время (2-3 дня), чем сразу после изучения.",
"метапамять": "Внутренняя когнитивная структура, представляющая собой знание и представления человека о функционировании, возможностях и особенностях собственной памяти.",
"консолидация следов": "Психофизиологический процесс перехода кратковременных нейронных следов памяти в стабильную и устойчивую долговременную форму.",
"актуализация": "Процесс перевода психических следов, знаний или умений из скрытого, латентного состояния в активную деятельность или сознание человека.",
"словесно-логическая память": "Специфический вид памяти человека, содержанием которого являются мысли, понятия, суждения и логические взаимосвязи, выраженные в языковой форме.",
"непроизвольная память": "Запечатление и сохранение информации в психике, происходящее без сознательного намерения, волевых усилий и постановки специальной мнемической задачи.",
"опосредованная память": "Высшая форма памяти человека, характеризующаяся использованием вспомогательных знаковых средств и логических приемов для эффективного закрепления информации.",
"оперативная память": "Мнемический процесс, обеспечивающий удержание информации и промежуточных результатов деятельности, необходимых для выполнения конкретного текущего действия.",
"мнемотехника": "Система специальных внутренних или внешних приемов, облегчающих запоминание и увеличивающих объем памяти путем образования искусственных ассоциаций.",
"объем внимания": "Психометрический параметр, определяющий количество объектов, которое человек способен зафиксировать в поле ясного сознания одновременно за минимальный промежуток времени (0,1 сек).",
"послепроизвольное внимание": "Вид внимания, характеризующийся высокой сосредоточенностью на объекте в связи с глубоким интересом к деятельности, при котором исчезают сознательные волевые усилия.",
"умственного контроля": "Внутреннее, психическое действие (по П.Я. Гальперину), направленное на мониторинг, сопоставление и проверку хода выполнения текущего действия с намеченным эталоном.",
"ориентировочная часть": "Этап структуры деятельности (по П.Я. Гальперину), включающий исследование ситуации, построение мысленного плана и выбор адекватных способов выполнения действия.",
"селекция": "Процесс активного отбора биологически или личностно значимой информации сенсорной системой при одновременном торможении фоновых помех.",
"аттенюатор": "Внутренний когнитивный механизм (по А. Трейсман), ослабляющий, но не выключающий полностью нерелевантные информационные потоки.",
"семантический анализ": "Процесс глубокого смыслового декодирования и осознания значения поступающей языковой или знаковой информации.",
"когнитивный ресурс": "Общий ограниченный объем умственной энергии и усилий (по Д. Канеману), распределяемый между одновременно выполняемыми задачами.",
"пропускная способность": "Максимальное количество информации, которое нервная система и сознание способны качественно обработать в единицу времени.",
"ранняя селекция": "Теоретическая модель, согласно которой отбор важной информации происходит на начальных этапах переработки на основе физических признаков стимула.",
"абстрагирование": "Мыслительная операция, заключающаяся в выделении существенных свойств предмета и отвлечении от его несущественных, наглядных признаков.",
"умозаключение": "Форма мышления, посредством которой из одного или нескольких суждений выводится новое суждение, содержащее качественно новое знание.",
"гипотеза Сепира-Уорфа": "Концепция лингвистической относительности, утверждающая, что структура языка определяет особенности мышления и восприятия мира его носителями.",
"внутренняя речь": "Скрытая, беззвучная форма речи (речь для себя), выступающая главным инструментом мышления и этапом перехода от мысли к развернутому внешнему высказыванию.",
"предикативность": "Свойство внутренней речи, выражающееся в её сокращенности, отсутствии подлежащих и преобладании глагольных форм (сказуемых/предикатов).",
"антиципация": "Способность психики человека предвосхищать, прогнозировать наступление будущих событий или результатов действий до их реального совершения.",
"агглютинация": "Прием воображения, заключающийся в мысленном соединении («склеивании») частей или свойств различных объектов в единый целостный образ.",
"типизация": "Творческий прием воображения, состоящий в выделении существенных, повторяющихся признаков группы объектов и их воплощении в одном образе.",
"воссоздающее воображение": "Вид активного воображения, направленный на построение ментальных образов объектов на основе их внешнего текстового или знакового описания.",
"творческое воображение": "Процесс самостоятельного создания принципиально новых, оригинальных образов и идей, реализуемых в практических результатах деятельности.",
"фрустрация": "Эмоционально-тяжелое состояние, возникающее при столкновении с непреодолимыми препятствиями на пути к достижению цели или удовлетворению потребности.",
"контейнирование": "Психологическая способность выдерживать и перерабатывать интенсивные эмоциональные переживания (свои или чужие) без дезадаптивного отреагирования.",
"ментализация": "Способность понимать и интерпретировать психические состояния и скрытые мотивы (свои и окружающих) в процессе социального взаимодействия.",
"Зеркальные нейроны": "Особые клетки головного мозга, которые активируются как при выполнении определенного действия лично, так и при наблюдении за этим действием у другого.",
"Защитные механизмы психики": "Неосознаваемые психические процессы автоматической регуляции, направленные на защиту сознания (Эго) от тревоги, стресса и внутренних конфликтов.",
"самоактуализация": "Высшая духовная потребность человека (по А. Маслоу) в максимально полном раскрытии своего личностного потенциала, талантов и возможностей.",
"изоморфизма": "Отношение взаимного структурного соответствия между элементами двух систем (в теории А.Н. Леонтьева — между структурой деятельности и строением мотивационной сферы).",
"сдвиг мотива на цель": "Психологический механизм формирования новых мотивов (по А.Н. Леонтьеву), при котором действие превращается в самостоятельную деятельность.",
"каузальная атрибуция": "Процесс приписывания человеку причин его поведения и личностных качеств в условиях дефицита объективной информации о нем.",
"либидо": "Специфическая психическая энергия (в психоанализе З. Фрейда), связанная с инстинктом жизни, созидания и половым влечением.",

};


function showSectionContent(section) {
    // Находим окно просмотра статьи по его новому уникальному классу
const contentContainer = document.querySelector('.section-viewer');
    if (!contentContainer || !section) return;
    
    let processedContent = section.content;

    // Автоматически ищем ключевые слова из словаря в тексте и оборачиваем их в специальный тег
    Object.keys(psychologyGlossary).forEach(term => {
        // Создаем регулярное выражение, чтобы искать слово с учетом регистра
        const regex = new RegExp(`\\b${term}\\b|(?<=\\s|^)${term}(?=\\s|[.,!?;:-]|$)`, 'gi');
        
        processedContent = processedContent.replace(regex, (match) => {
            return `<span class="wiki-term" data-tooltip="${psychologyGlossary[term]}">${match}</span>`;
        });
    });
    
    // Выводим заголовок статьи и её обработанное содержимое с подсказками
    contentContainer.innerHTML = `
        <h2>${section.title}</h2>
        <div class="content-text">${processedContent}</div>
    `;
}



// ==========================================
// ЛОГИКА МОДУЛЯ «ЛИТЕРАТУРА»
// ==========================================
function initLibrary() {
    const books = appDatabase.library;
    const container = document.getElementById('books-container');
    if (!books || !container) return;

    container.innerHTML = '';

    // Сортируем книги по алфавиту на основе фамилии автора
    const sortedBooks = [...books].sort((a, b) => a.author.localeCompare(b.author, 'ru'));

    sortedBooks.forEach(book => {
        const bookCard = document.createElement('div');
        bookCard.classList.add('menu-item'); 
        
        bookCard.innerHTML = `
            <div class="icon">📚</div>
            <h2>${book.author} — ${book.title}</h2>
            <p>${book.annotation}</p>
        `;
        container.appendChild(bookCard);
    });
}

// ==========================================
// ЛОГИКА МОДУЛЯ «ЧЕНДЖЛОГ / НОВОСТИ»
// ==========================================
function initNews() {
    const newsData = appDatabase.news;
    const container = document.getElementById('news-timeline');
    if (!newsData || !container) return;

    container.innerHTML = '';

    newsData.forEach(item => {
        const newsCard = document.createElement('div');
        newsCard.style.cssText = "background: white; border: 2px solid #e2e8f0; border-radius: 16px; padding: 25px; margin-bottom: 25px; text-align: left;";
        
        // Превращаем массив строк изменений в красивый маркированный список
        const changesList = item.changes.map(change => `<li style="margin-bottom: 8px; line-height: 1.5; color: #4a5568;">${change}</li>`).join('');
        
        newsCard.innerHTML = `
            <div style="display: inline-block; background: #ebf8ff; color: #2b6cb0; font-size: 13px; font-weight: bold; padding: 4px 10px; border-radius: 12px; margin-bottom: 12px;">📅 ${item.date}</div>
            <h2 style="margin: 0 0 15px 0; color: #1a365d; font-size: 20px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 10px;">${item.title}</h2>
            <ul style="margin: 0; padding-left: 20px;">${changesList}</ul>
        `;
        container.appendChild(newsCard);
    });
}
loadDatabase();