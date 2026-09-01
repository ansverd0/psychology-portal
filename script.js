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