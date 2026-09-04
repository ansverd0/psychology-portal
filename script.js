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

        // Безопасный запуск модулей
        if (cardElement) initFlashcards();
        if (document.querySelector('.tickets-layout') && !document.getElementById('sections-page-marker')) initTickets();
        if (document.getElementById('quiz-wrapper')) initQuiz();
        
                if (document.getElementById('sections-page-marker')) {
            initSections();
            
            // СВЕРХТОЧНЫЙ UX-АВТОКЛИК
            const urlParams = new URLSearchParams(window.location.search);
            const targetDiscipline = urlParams.get('discipline');

            if (targetDiscipline) {
                if (window.innerWidth > 768) {
                    // ПК-версия: ищем кнопку по точному атрибуту, который мы добавили на Шаге 1
                    const targetBtn = document.querySelector(`#sections-list-desktop .branch-title-btn[data-discipline-id="${targetDiscipline}"]`);
                    if (targetBtn) {
                        setTimeout(() => targetBtn.click(), 100); // Небольшой таймаут для стабильности рендера
                    }
                } else {
                    // Мобильная версия: ищем плитку, содержащую ID
                    const mobileTiles = document.querySelectorAll('#mobile-sections-tiles .mobile-tile-btn');
                    mobileTiles.forEach(tile => {
                        if (tile.outerHTML.includes(targetDiscipline)) {
                            setTimeout(() => tile.click(), 100);
                        }
                    });
                }
            }
        }

        
        if (document.getElementById('library-page-marker')) initLibrary();
        if (document.getElementById('news-page-marker')) initNews();
        
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
            "social-psych": { title: "Социальная", icon: "👥" },
            "developmental-psych": { title: "Возрастная", icon: "🌱" }
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
        let shuffled = shuffleQuestions([...filteredQuestions]); // Перемешиваем все вопросы темы
        
        // Читаем выбранный лимит из HTML
        const limitSelect = document.getElementById('quiz-limit-select');
        const chosenLimit = limitSelect ? limitSelect.value : "10"; // 10 по умолчанию
        
        if (chosenLimit === "all") {
            currentActiveQuestions = shuffled; // Оставляем все
        } else {
            const limitNumber = parseInt(chosenLimit, 10);
            currentActiveQuestions = shuffled.slice(0, limitNumber); // Обрезаем по выбору пользователя
        }
        
        currentTestIndex = 0;
        score = 0;
        
        // Возвращаем видимость тесту и прячем экран результатов (если он был открыт)
        document.getElementById('quiz-wrapper').style.display = 'block';
        document.getElementById('result-wrapper').style.display = 'none';
        
        // ... (очистка старых прогресс-баров)
        const oldProgress = document.querySelector('.result-progress-container');
        if (oldProgress) oldProgress.remove();
        const oldBtn = document.querySelector('.review-theme-btn');
        if (oldBtn) oldBtn.remove();

        showQuestion();
    }

    // --- АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ ПРИ СМЕНЕ КОЛИЧЕСТВА ВОПРОСОВ ---
    const limitSelect = document.getElementById('quiz-limit-select');
    if (limitSelect) {
        limitSelect.onchange = () => {
            // Находим плитку темы, которая активна прямо сейчас
            const activeTile = document.querySelector('#quiz-discipline-tiles .mobile-tile-btn.active');
            if (activeTile) {
                activeTile.click(); // Симулируем клик по ней, плавно перезапуская тест с новым лимитом!
            }
        };
    }

    // --- ГЕНЕРАЦИЯ ПЛИТОК НАВИГАЦИИ ДЛЯ ТЕСТОВ ---
    if (quizTilesContainer) {
        quizTilesContainer.innerHTML = '';

        // 1. Первая обязательная плитка: Общий микс по всему курсу
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
            "social-psych": { title: "Социальная", icon: "👥" },
            "developmental-psych": { title: "Возрастная", icon: "🌱" }
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
    const newNextBtn = quizNextBtn.cloneNode(true);
    quizNextBtn.parentNode.replaceChild(newNextBtn, quizNextBtn);

    newNextBtn.addEventListener('click', () => {
        currentTestIndex++;
        if (currentTestIndex < currentActiveQuestions.length) {
            showQuestion();
            document.getElementById('quiz-wrapper').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            showResults();
            document.getElementById('result-wrapper').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}


function showQuestion() {
    if (!currentActiveQuestions || currentActiveQuestions.length === 0) {
        // ... (ваш код обработки пустой темы без изменений)
        return;
    }

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

    // --- ЛОГИКА ПЕРЕМЕШИВАНИЯ ВАРИАНТОВ ---
    // Создаем массив объектов, где запоминаем исходный текст и был ли он правильным
    let mappedOptions = currentQuestion.options.map((opt, idx) => {
        return { text: opt, isCorrect: idx === currentQuestion.correct };
    });

    // Перемешиваем варианты алгоритмом Фишера-Йетса
    for (let i = mappedOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mappedOptions[i], mappedOptions[j]] = [mappedOptions[j], mappedOptions[i]];
    }

    // Рендерим кнопки на основе перемешанного массива
    mappedOptions.forEach((option, index) => {
        const button = document.createElement('button');
        button.classList.add('option-btn');
        button.innerText = option.text;
        
        // Передаем в обработчик: кликнутый индекс, а в качестве 'правильного' передаем текущий индекс, 
        // если этот вариант изначально был верным. Так функция handleAnswer сработает идеально!
        button.addEventListener('click', () => {
            // Ищем, какой индекс в новом массиве является правильным
            const correctIdxInNewArray = mappedOptions.findIndex(o => o.isCorrect);
            handleAnswer(button, index, correctIdxInNewArray);
        });
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
            
            // ЖЕЛЕЗОБЕТОННЫЙ ФИКС №1: Намертво привязываем ID дисциплины к кнопке ПК
            branchBtn.id = `branch-btn-${section.id}`; 
            
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
                const isOpened = submenuContainer.style.display === 'block';
                
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
            
            // ЖЕЛЕЗОБЕТОННЫЙ ФИКС №2: Намертво привязываем ID дисциплины к мобильной плитке
            tile.id = `mobile-tile-${section.id}`; 
            
            // Подбираем иконку в зависимости от ID раздела
            let icon = "📁";
            if (section.id === "general-psych") icon = "🧠";
            if (section.id === "social-psych") icon = "👥";
            if (section.id === "developmental-psych") icon = "🌱";

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

    // ЖЕЛЕЗОБЕТОННЫЙ ФИКС №3: Скрипт проверяет URL здесь — когда все кнопки и ID гарантированно созданы на странице!
    const urlParams = new URLSearchParams(window.location.search);
    const targetDiscipline = urlParams.get('discipline');

    if (targetDiscipline) {
        setTimeout(() => {
            // Проверяем ПК версию по ID кнопки
            const pcBtn = document.getElementById(`branch-btn-${targetDiscipline}`);
            if (pcBtn && window.innerWidth > 768) {
                pcBtn.click();
            }
            // Проверяем мобильную версию по ID плитки
            const mobileTile = document.getElementById(`mobile-tile-${targetDiscipline}`);
            if (mobileTile && window.innerWidth <= 768) {
                mobileTile.click();
            }
        }, 150); // Безопасная микропауза, чтобы браузер успел отрендерить элементы
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
"Социальная психология": "Отрасль психологии, изучающая закономерности поведения и деятельности людей, обусловленные их включением в социальные группы, а также психологические характеристики этих групп.",
"Психология народов": "Одна из первых социально-психологических теорий (В. Вундт), утверждавшая, что главной движущей силой истории является сверхиндивидуальная 'душа народа', выраженная в языке, мифах и обычаях.",
"Психология масс": "Историческая концепция (Г. Лебон), исследовавшая поведение людей в больших скоплениях (толпе) и постулировавшая утрату интеллекта и критичности индивида в массе за счет подражания.",
"Групповая динамика": "Совокупность динамических внутригрупповых процессов и механизмов (лидерство, принятие решений, сплоченность), определяющих жизнедеятельность и развитие малой группы.",
"включенное наблюдение": "Метод социально-психологического исследования, при котором экспериментатор непосредственно внедряется в изучаемую группу, становясь её полноправным участником.",
"фокус-группа": "Метод качественного социально-психологического исследования, основанный на проведении групповой дискуссии под руководством модератора для выявления мнений и установок участников.",
"выборка исследования": "Часть генеральной совокупности (определенная группа людей), которая непосредственно привлекается к участию в исследовании и представляет свойства всей общности.",
"индекс сплоченности": "Математически рассчитываемый показатель в социометрии, отражающий степень взаимности эмоциональных выборов и интеграции членов малой группы.",
"социальное научение": "Процесс формирования новых форм поведения личности (по А. Бандуре) путем наблюдения за действиями других людей и моделирования их поступков.",
"интеракционизм": "Теоретическое направление в социальной психологии, утверждающее, что личность и социальное поведение формируются в процессах символического взаимодействия (интеракции) между людьми.",
"Теория отношений": "Психологическая концепция В.Н. Мясищева, рассматривающая личность как систему её субъективно-избирательных отношений к обществу, людям и самой себе.",
"Социальное поведение": "Внешне выраженная форма активности человека, отражающая его отношение к обществу, социальным группам, нормам и другим людям.",
"Просоциальное поведение": "Действия человека, направленные на благо других людей, бескорыстную помощь, сотрудничество и поддержку окружающих без явной выгоды для себя.",
"Конформное поведение": "Изменение индивидом своего поведения или мнений под влиянием реального или воображаемого давления группы с целью достижения согласия с ней.",
" личностные диспозиции": "Устойчивые внутренние склонности, установки и свойства личности (ценности, мотивы), определяющие её готовность к определенному социальному поведению.",
"социальный статус": "Объективное положение индивида в социальной системе (обществе или группе), определяющее его права, обязанности и степень влияния.",
"предписанный статус": "Социальный статус, получаемый человеком автоматически от рождения независимо от его волей, усилий и заслуг (пол, национальность, возраст).",
"достигаемый статус": "Социальный статус, который человек приобретает в обществе благодаря собственным усилиям, выбору, образованию и труду.",
"институциональные отношения": "Формальные, официальные взаимосвязи между людьми, жестко регламентированные правилами, законами и должностной иерархией организации.",
"социальная роль": "Ожидаемый от человека паттерн поведения, обусловленный его социальным статусом и нормами конкретной группы или общества.",
"межролевой конфликт": "Ролевой конфликт, возникающий при несовместимости требований различных социальных ролей, одновременно выполняемых одним человеком.",
"внутриролевой конфликт": "Ситуация, при которой разные участники взаимодействия предъявляют противоположные и несовместимые ожидания к выполнению одной и той же роли индивида.",
"личностно-ролевой конфликт": "Внутренний конфликт личности, вызванный полным противоречием между требованиями социальной роли и её собственными ценностями и убеждениями.",
"ценностные ориентации": "Важнейшие компоненты структуры личности, отражающие её внутреннюю направленность на конкретные социальные ценности, идеалы и жизненные цели.",
"моральное развитие": "Процесс последовательного усвоения человеком (в онтогенезе) этических норм, правил и ценностей общества, регулирующих его социальные поступки.",
"коллективизм": "Культурный синдром (по Г. Хофстеде), характеризующийся приоритетом целей и интересов социальной группы над индивидуальными целями личности.",
"индивидуализм": "Культурный синдром (по Г. Хофстеде), при котором личные цели, автономия, права и независимость человека ценятся выше интересов группы.",
"аттитюд": "Социальная установка; устойчивая психологическая готовность личности к определенному поведению и оценке конкретного социального объекта.",
"аффективный компонент": "Эмоциональная составляющая социальной установки, выражающаяся в чувствах, симпатиях или антипатиях к социальному объекту.",
"конативный компонент": "Поведенческий элемент аттитюда, представляющий собой непосредственную готовность человека к практическому действию по отношению к объекту.",
"диспозиционная система": "Иерархическая структура высшей регуляции поведения личности (по В.А. Ядову), включающая элементарные установки, аттитюды и ценностные ориентации.",
"парадокс Лапьера": "Социально-психологический феномен (Р. Лапьер), фиксирующий несовпадение между вербально задекларированной установкой человека и его реальным поведением в конкретной ситуации.",
"вербальные суждения": "Выраженные в словесной (языковой) форме мнения, оценки, мысли или убеждения человека по отношению к какому-либо явлению или объекту.",
"диссонанс": "Психологическое состояние внутреннего дискомфорта, вызванное столкновением и противоречием между несовместимыми мыслями, убеждениями или действиями.",
"когнитивный диссонанс": "Состояние психологического дискомфорта (по Л. Фестингеру), вызванное столкновением в сознании человека противоречащих друг другу знаний, убеждений или действий.",
"убеждающая коммуникация": "Целенаправленный процесс передачи информации, сообщений или аргументов с целью качественного изменения социальных установок, мнений и поведения аудитории.",
"коммуникатор": "Субъект (личность или группа), являющийся источником и инициатором передачи сообщения в процессе информационного или речевого взаимодействия.",
"ригидность установок": "Степень жесткости, слабой изменчивости и сопротивляемости социальной установки к внешним убеждающим или корректирующим воздействиям.",
"референтная группа": "Реальная или воображаемая социальная группа, ценности, нормы и стандарты которой выступают для личности идеалом и главным ориентиром собственного поведения.",
"группообразование": "Процесс превращения случайного скопления людей в психологически целостную, структурированную малую группу, объединенную общими целями и нормами.",
"групповая идентичность": "Психологический феномен осознания индивидом своей принадлежности к конкретной социальной группе, выражающийся в чувстве 'Мы'.",
"аффилиация": "Фундаментальная социальная потребность человека в поиске контактов, общении, эмоциональном сближении, принятии и доверительном взаимодействии с другими людьми.",
"коллектив": "Высший уровень развития малой группы, характеризующийся социально полезными целями деятельности и межличностными отношениями, полностью опосредованными общими ценностями.",
"Стратометрическая концепция": "Теория А.В. Петровского, рассматривающая структуру малой группы как систему концентрических слоев (страт), различающихся степенью опосредованности отношений совместной деятельностью.",
"ценностно-ориентационное единство": "Показатель сплоченности группы (ЦОУ), выражающийся в совпадении оценок, мнений, идеалов и жизненных ценностей членов команды по отношению к значимым объектам.",
"корпорация": "Уровень развития группы, отличающийся высокой внутренней сплоченностью на основе группового эгоизма, при котором цели общности противопоставляются интересам общества.",
"лидерство": "Процесс неформального психологического влияния индивида на членов малой группы, основанный на личных симпатиях, авторитете и признании его главенствующей роли.",
"руководство": "Официальный, институционально закрепленный процесс управления группой со стороны назначенного руководителя, обладающего формальной властью и санкциями.",
"авторитарный стиль": "Стиль управления (по К. Левину), характеризующийся единоличным принятием решений лидером, жестким контролем и директивной формой общения.",
"демократический стиль": "Стиль руководства (по К. Левину), основанный на коллегиальном принятии решений, уважении к личности, делегировании полномочий и стимулировании инициативы.",
"групповая идентификация": "Психологический процесс уподобления индивида своей группе, восприятие её ценностей, норм и целей как собственных.",
"сдвиг к риску": "Социально-психологический феномен, выражающийся в тенденции группы принимать более рискованные решения по сравнению с первоначальными индивидуальными мнениями участников.",
"огруппление мышления": "Дезадаптивный стиль группового мышления (Groupthink), при котором стремление к единомыслию подавляет критический анализ альтернативных вариантов и ведет к ошибкам.",
"групповая поляризация": "Феномен, при котором в процессе групповой дискуссии первоначальные мнения участников не сближаются, а сдвигаются к более крайним, радикальным полюсам.",
"психическое заражение": "Процесс бессознательной и автоматической передачи эмоционального состояния от одного человека к другому, лавинообразно нарастающий в толпе.",
"суггестия": "Внушение; процесс целенаправленного воздействия на психику человека, воспринимаемый им без критического осмысления и логического анализа.",
"паника": "Массовое эмоциональное состояние острого страха, характеризующееся потерей волевого самоконтроля и хаотичным поведением людей в условиях угрозы.",
"циркулярная реакция": "Социально-психологический механизм взаимного заражения и нарастания эмоционального напряжения в толпе, стирающий индивидуальные различия.",
"психология развития": "Отрасль психологической науки, изучающая динамику психики человека, онтогенез психических процессов и психических качеств человека на протяжении всей жизни.",
"возрастная психология": "Отрасль психологии, изучающая психологические особенности людей разных возрастных категорий, законы перехода от одного возраста к другому и специфику возрастных норм.",
"объект науки": "Объективная реальность, на исследование которой направлен научный интерес (в данном курсе — возрастные изменения психики, поведения и личности человека).",
"предмет науки": "Специфический ракурс исследования, законы, закономерности, тенденции изменения психики, поведения, жизнедеятельности и личности человека в течение жизни.",
"периодизация психического развития": "Разделение жизненного пути человека на качественно специфические этапы и периоды в соответствии с объективными законами онтогенеза.",
"возрастной нормы": "Диапазон типичных для конкретного психологического возраста показателей психического развития, отражающих оптимальное функционирование психики.",
"возрастная диагностика": "Система психологических методов и процедур, направленных на определение реального уровня психического и личностного развития человека.",
"клиническая диагностика": "Комплекс исследовательских методов для выявления патологий, деструкций, аномалий или задержек в функционировании психических процессов.",
"разделы возрастной психологии": "Автономные структурные блоки дисциплины, изучающие конкретные этапы онтогенеза (детство, подростничество, юность, зрелость, старость).",
"акмеология": "Раздел возрастной психологии, изучающий закономерности, условия и механизмы достижения человеком вершины своего профессионального и личностного развития (зрелости).",
"геронтология": "Междисциплинарная наука, изучающая биологические, социальные, медицинские и психологические аспекты старения живых организмов, включая человека.",
"принципы психологии развития": "Фундаментальные методологические правила и исходные положения, определяющие логику исследования, объяснения и интерпретации психических феноменов во времени.",
"причинно-следственных отношений": "Объективная связь между явлениями, при которой одно явление (причина) при наличии определенных условий закономерно порождает и вызывает к жизни другое явление (следствие).",
"межфункциональных связей": "Закономерные динамические отношения и взаимодействия между различными психическими функциями (например, памятью, речью и мышлением), меняющиеся в процессе онтогенеза.",
"проблемы психологии развития": "Ключевые методологические противоречия, трудности и дискуссионные вопросы дисциплины (соотношение факторов развития, природа кризисов, неравномерность изученности возрастов).",
"метод поперечных срезов": "Исследовательский подход, заключающийся в одновременном изучении и сравнении определенных психических свойств у разных групп людей, находящихся на разных возрастных ступенях.",
"лонгитюдного исследования": "Организационный метод длительного, систематического и непрерывного изучения одних и тех же испытуемых на протяжении многих лет с фиксацией динамики их психических изменений.",
"резервов и лимитов возраста": "Внутренние потенциальные возможности и психофизиологические ограничения, объективно присущие человеку на конкретном этапе его возрастного развития.",
"метод наблюдения": "Метод целенаправленного, систематического и преднамеренного восприятия и фиксации внешних проявлений психики человека в естественных условиях среды.",
"условия научного наблюдения": "Комплекс требований к обсервационному методу, включающий наличие цели, плана, фиксацию фактов, невмешательство в деятельность и сохранение естественной среды.",
"сплошное наблюдение": "Вид наблюдения, который охватывает одновременно многие стороны поведения и проявлений психики ребенка в течение длительного периода времени.",
"выборочное наблюдение": "Вид наблюдения, при котором исследователь фиксирует строго определенную сторону поведения ребенка в конкретные промежутки времени.",
"естественный эксперимент": "Метод исследования, предложенный А.Ф. Лазурским, при котором испытуемые находятся в привычных для себя условиях, но условия их деятельности контролируются ученым.",
"констатирующий эксперимент": "Вид экспериментального исследования, направленный на объективное выявление и фиксацию наличного уровня развития конкретного психического качества или процесса.",
"обучающее исследование": "Зарубежная стратегия исследования, построенная на сравнении групп испытуемых, различающихся по объему опыта, полученного ими непосредственно в процессе обучения.",
"формирующий эксперимент": "Отечественный метод исследования (экспериментально-генетический метод Л.С. Выготского), заключающийся в искусственном воссоздании и моделировании процесса развития функции.",
"интервьюирование": "Метод сбора первичных данных в психологии посредством прямого устного вербального взаимодействия исследователя с испытуемым по заранее намеченному плану.",
"анкетирование": "Метод массового сбора психологической информации на основе письменного самоотчета испытуемых по специально разработанной программе (анкете).",
"анализ продуктов деятельности": "Эмпирический метод исследования (праксиметрический метод), заключающийся в изучении материализованных результатов активности человека (рисунков, поделок, дневников).",
"социометрический опрос": "Диагностический метод Дж. Морено, направленный на выявление структуры неформальных эмоциональных отношений, симпатий и антипатий внутри малой группы.",
"близнецовый метод": "Сравнительный метод психогенетики, основанный на сопоставлении сходства по различным психическим признакам внутри близнецовых пар (монозиготных и дизиготных).",
"сравнение нормы и патологии": "Метод возрастной психологии, сопоставляющий траектории психического развития здоровых людей и лиц с врожденными или приобретенными дефектами (нарушениями) анализаторов и ЦНС.",
"кросс-культурный метод": "Сравнительный метод, направленный на изучение и сопоставление особенностей психики и поведения людей, принадлежащих к качественно разным культурам и этносам.",
"продольное лонгитюдное исследование": "Схема организации научного поиска, предполагающая многократное, непрерывное и систематическое обследование одних и тех же лиц в течение длительного времени.",
"категории психологии развития": "Основные понятийные конструкты (рост, созревание, дифференциация, научение, импринтинг, социализация), используемые для интегральной характеристики процессов онтогенеза.",
"роста": "Отдельный аспект хода развития, заключающийся в чисто количественном изменении, накоплении и приращении объема внешних или внутренних признаков объекта во времени.",
"созревания": "Процесс развития, спонтанно протекающий под влиянием врожденных, эндогенно запрограммированных и генетически детерминированных факторов вне зависимости от прошлого опыта.",
"дифференциация": "Процесс прогрессирующего дробления, расширения, качественной специализации и усложнения структуры психических функций и способов поведения из исходного нерасчлененного целого.",
"научение": "Процесс и результат приобретения индивидуального опыта, приводящий к относительно устойчивым изменениям поведения, обретению знаний, умений, навыков, установок и мотивов под влиянием среды.",
"запечатление (импринтинг)": "Форма мгновенного, автоматического и необратимого кодирования в памяти признаков внешних объектов или поведенческих моделей в строго определенный (критический) период возраста.",
"критический период": "Генетически детерминированный, ограниченный во времени возрастной отрезок (сенситивный период), в течение которого организм обладает максимальной чувствительностью к определенным стимулам среды.",
"социализация (культурный социогенез)": "Двунаправленный процесс врастания индивида в социальную среду, в ходе которого он активно усваивает ценности, нормы, социальные роли и культуру общества.",
"свойства развития": "Базовые академические атрибуты онтогенеза в отечественной психологии, включающие в себя необратимость, направленность и закономерность изменений.",
"необратимость": "Свойство развития, выражающееся в невозможности полного возврата психической системы к её прежним, прошлым состояниям в их первоначальном виде.",
"направленность": "Свойство развития, характеризующееся способностью системы осуществлять единую, последовательную и закономерную линию изменений от низших форм к высшим.",
"закономерность": "Свойство развития, проявляющееся в обязательной воспроизводимости однотипных психических изменений и новообразований у качественно разных людей в онтогенезе.",
"филогенез": "Историческое, эволюционное развитие живых организмов, их биологических видов и психических структур от простейших форм до человека разумного.",
"антропогенез": "Историко-эволюционный процесс возникновения, формирования и социокультурного развития человечества, человеческого типа сознания и личности.",
"онтогенез": "Процесс индивидуального развития человеческого организма и его психики с момента зарождения (зачатия) до окончания жизненного пути (смерти).",
"микрогенез": "Краткосрочный временной процесс (актуальный генез) возникновения, развертывания и протекания отдельных психических актов, действий, мыслей или перцептивных образов.",
"концепция рекапитуляции": "Биогенетическая теория Ст. Холла, утверждающая, что ребенок в своем индивидуальном психическом развитии (онтогенезе) кратко повторяет все стадии исторического развития человечества (филогенеза).",
"нормативный подход": "Направление в зарубежной психологии (А. Гезелл, Л. Термен), нацеленное на эмпирическое описание, хронологическую фиксацию и шкалирование среднестатистических норм детского развития.",
"зеркало Гезелла": "Специальное полупрозрачное стекло (стекло с односторонней проницаемостью), позволяющее ученым скрыто наблюдать за естественным поведением детей, исключая эффект реактивности.",
"закон замедления развития с возрастом": "Закономерность А. Гезелла, постулирующая, что скорость и темп психического и моторного развития максимальны в первые месяцы жизни и неуклонно снижаются по мере взросления.",
"коэффициент интеллекта (IQ)": "Психометрический показатель уровня умственного развития индивида относительно среднестатистической нормы его возрастной группы, измеряемый с помощью стандартизированных тестов.",
"кривая нормального распределения": "Математическая колоколообразная кривая (распределение Гаусса), отражающая характер распределения признака (например, интеллекта) в популяции, где большинство значений сосредоточено около среднего.",
"бихевиоризм": "Направление зарубежной психологии, провозгласившее предметом науки объективно наблюдаемое поведение человека и животных, понимаемое как совокупность реакций на внешние стимулы.",
"схема стимул-реакция": "Базовая аналитическая единица бихевиоризма (S — R), утверждающая, что любое поведение является прямой реакцией организма на воздействующий раздражитель среды.",
"концепция оперантного обусловливания": "Теория Б. Скиннера, согласно которой поведение формируется и закрепляется в зависимости от его последствий (положительного или отрицательного подкрепления), возникающих после спонтанного действия.",
"закона научения Торндайка": "Система эмпирических правил (законы эффекта, повторяемости, готовности и ассоциативного сдвига), определяющая механизмы и успешность приобретения новых навыков.",
"теория социального научения": "Необихевиоральная концепция А. Бандуры, постулирующая, что новые формы поведения, социальные установки и роли приобретаются человеком в процессе наблюдения за моделью и подражания ей.",
"теория трех ступеней": "Преформистская концепция К. Бюлера, утверждающая, что развитие ребенка проходит три биологические стадии, повторяющие эволюцию животных: инстинкт, дрессуру (навык) и интеллект.",
"шимпанзеподобный возраст": "Понятие К. Бюлера, описывающее период в конце первого — начале второго года жизни ребенка, когда он начинает открывать первичные формы предметного мышления и использовать простейшие орудия.",
"закон функционального удовольствия": "Закономерность К. Бюлера, согласно которой живой организм испытывает внутреннее удовлетворение и радость от самого процесса успешного функционирования своих сил и способностей.",
"этология": "Самостоятельная научная дисциплина, изучающая генетически обусловленное поведение животных и человека в естественной среде обитания с эволюционной точки зрения.",
"врожденные пусковые механизмы": "Нейросенсорные структуры в этологии К. Лоренца, которые обеспечивают автоматическое распознавание ключевых стимулов среды и запуск врожденных поведенческих реакций.",
"фиксированные комплексы действий": "Генетически запрограммированные, стереотипные и жестко фиксированные последовательности двигательных актов, общие для всех представителей вида.",
"импринтинг": "Процесс и результат мгновенного, автоматического и необратимого запечатления в памяти новорожденного признаков первого увиденного движущегося объекта.",
"либидо": "Фундаментальное понятие психоанализа З. Фрейда, обозначающее специфическую психическую энергию, лежащую в основе полового влечения, инстинкта жизни и созидания.",
"базальная тревога": "Центральное понятие концепции К. Хорни, обозначающее глубокое, бессознательное чувство одиночества, беспомощности и незащищенности ребенка перед лицом потенциально враждебного внешнего мира.",
"психологическая защита Карен Хорни": "Иерархическая система стратегий совладания с базальной тревогой, включающая три типа направленности поведения личности: к людям (уступчивость), против людей (агрессия) и от людей (обособление).",
"теория фрустрации Долларда": "Социально-поведенческая концепция (гипотеза фрустрации-агрессии), согласно которой блокирование целенаправленного действия человека рождает внутреннее напряжение, неизбежно разряжающееся в форме агрессии.",
"эпигенетическая теория Эриксона": "Психосоциальная концепция Э. Эриксона, описывающая развитие личности на протяжении всей жизни через последовательное прохождение восьми стадий со специфическими возрастными кризисами.",
"кризис идентичности": "Острый нормативный период самоопределения в юности, связанный с поиском ответа на экзистенциальные вопросы 'Кто я?' и 'Каково мое место в обществе'.",
"диффузия идентичности": "Деструктивное ролевое смешение, выражающееся в неспособности молодого человека завершить психосоциальное самоопределение, приводящее к скуке, застою в работе или отрицательной идентичности.",
"психосоциальный мораторий": "Предоставляемый обществом юношеству нормативный период отсрочки взросления, в течение которого разрешается осуществлять свободный поиск и экспериментальные пробы социальных ролей.",
"теория ожидания Мида": "Интеракционистская концепция Дж. Мида, согласно которой личность и её самосознание формируются в процессе сюжетной игры за счет принятия ролей других людей и ориентации на их ожидания.",
"теория конвергенции двух факторов": "Методологическая концепция В. Штерна, постулирующая, что онтогенез психики определяется неразрывным схождением и взаимодействием двух факторов — наследственности (эндогенного) и среды (экзогенного).",
"теория когнитивного развития Жана Пиаже": "Концепция Ж. Пиаже, описывающая стадии качественного созревания интеллекта и мыслительных операций ребенка в процессе предметной адаптации к миру.",
"ассимиляция": "Когнитивный процесс включения новой информации или объектов в уже существующие ментальные схемы и структуры опыта ребенка.",
"аккомодация": "Когнитивный процесс качественной перестройки и изменения имеющихся ментальных схем ребенка в соответствии с новыми, изменившимися требованиями среды.",
"концепция Анри Валлона": "Психологическая теория, объясняющая переход от органического к психическому в онтогенезе через диалектическую взаимосвязь четырех понятий: эмоции, моторики, подражания и социума.",
"теория перцептивных гипотез": "Когнитивная концепция Дж. Брунера, утверждающая, что процессы восприятия и познания носят характер активного выдвижения гипотез и категоризации сигналов среды.",
"уровни развития нравственных суждений": "Этапы морального развития личности по Л. Кольбергу (доконвенциональный, конвенциональный, постконвенциональный), отражающие логику вынесения этических оценок.",
"персоногенетический подход": "Гуманистическое направление в возрастной психологии (А. Маслоу, К. Роджерс), рассматривающее развитие как результат собственного выбора личности на пути к самоактуализации.",
"законы психического развития человека": "Система фундаментальных правил онтогенеза (законы метаморфозы, неравномерности, сложной организации во времени и развития ВПФ), сформулированная Л. С. Выготским.",
"социальная ситуация развития": "Специфическое, исключительное и неповторимое для конкретного возраста отношение между ребенком и окружающей его социальной действительностью, определяющее весь ход развития.",
"возрастное новообразование": "Качественно новый тип личности человека и его взаимодействия с миром, возникающий в конце определенного возрастного этапа и перестраивающий структуру сознания.",
"закон появления функций дважды": "Постулат Л. С. Выготского, согласно которому любая высшая психическая функция изначально возникает во внешнем, социальном плане (интерпсихически), а затем переходит во внутренний (интрапсихически).",
"интериоризация": "Процесс и механизм перехода внешних практических действий и социальных знаков во внутренний, психический план сознания человека (формирование внутреннего мира).",
"зона ближайшего развития": "Область еще не созревших, но находящихся в процессе созревания психических функций; определяется разницей между самостоятельными действиями ребенка и его возможностями при помощи взрослого.",
"деятельность": "Динамическая, саморазвивающаяся система взаимодействий субъекта с миром, в процессе которых происходят и воплощаются в объекте психические процессы, сознание и личность.",
"структура деятельности Леонтьева": "Иерархическая макросистема, включающая три исполнительских уровня (деятельность, действие, операция), которым соответствует психологический ряд (мотив, цель, задача).",
"ведущая деятельность": "Вид деятельности, осуществление которой детерминирует формирование основных психологических достижений, новообразований и перестройку личности на конкретной ступени развития.",
"факторы психического развития": "Ведущие детерминанты онтогенеза, непосредственно определяющие его характер и содержание (наследственность, среда и самостоятельная активность человека).",
"предпосылки психического развития": "Анатомо-физиологические особенности организма, свойства нервной системы и генетически заданные возможности (задатки), создающие потенциальную почву для развития.",
"условия психического развития": "Внутренние и внешние постоянно действующие детерминанты (материальное окружение, характер воспитания), которые влияют на динамику, направленность и конечные результаты онтогенеза.",
"источники психического развития": "Социокультурная среда и исторический опыт человечества, содержащие в себе идеальные формы, которые индивид активно присваивает в процессе социализации.",
"движущие силы психического развития": "Внутренние диалектические противоречия между новыми потребностями человека и наличным уровнем его возможностей, выступающие главным драйвером онтогенеза.",
"принципы психического развития": "Общесистемные методологические правила (принципы неравновесия, цельности, дифференциации-интеграции), описывающие механизмы структурных изменений психики во времени.",
"закономерности психического развития": "Объективные, устойчивые и повторяющиеся особенности протекания онтогенеза (неравномерность, гетерохронность, неустойчивость, сензитивность, кумулятивность, дивергентность-конвергентность).",
"возраст": "Конкретная, относительно ограниченная во времени ступень психологического и физиологического развития индивида, характеризующаяся совокупностью качественных новообразований.",
"абсолютный возраст": "Календарный или хронологический возраст, выражающийся количеством временных единиц (лет, месяцев, дней), прошедших с момента рождения человека.",
"условный возраст": "Возраст развития, определяемый путем сопоставления индивидуального уровня психического или физиологического созревания человека со среднестатистическими нормами.",
"биологический возраст": "Совокупность морфофункциональных признаков, характеризующих текущее состояние зрелости организма, уровень его жизнеспособности и физического здоровья.",
"психологический возраст": "Новый уровень умственного, личностного и социального развития человека, отражающий степень его адаптации к среде и субъективное самоощущение.",
"возрастная норма": "Объективный диапазон типичных для конкретного этапа онтогенеза показателей психического развития, отражающих полноценное функционирование систем в данной культуре.",
"среднестатистический норматив": "Количественный усредненный показатель выраженности психического свойства или функции, полученный в статистическом подходе при обследовании большой выборки.",
"биологический оптимум функционирования": "Интервал оптимальной деятельности живой системы по К. В. Судакову, обеспечивающий адаптивное реагирование организма на факторы среды при минимальном напряжении.",
"возрастные кризисы": "Закономерные переломные периоды онтогенеза, характеризующиеся кардинальной психологической перестройкой личности и сменой социальных ситуаций развития.",
"закон периодичности Эльконина": "Закономерность Д. Б. Эльконина, постулирующая поочередную смену ведущих деятельностей в онтогенезе: от освоения сферы человеческих отношений к освоению сферы предметных действий, и наоборот.",
"сенсорные эталоны": "Общественно выработанные системы сенсорных качеств и свойств предметов (геометрические формы, цвета, решетка фонем), выступающие образцами при формировании перцептивных действий по А. В. Запорожцу.",
"теория поэтапного формирования Гальперина": "Концепция П. Я. Гальперина, детально описывающая процесс закономерного и последовательного перехода (интериоризации) внешнего предметного действия во внутренний, умственный план сознания.",
"теория первоначального очеловечивания": "Психолого-педагогическая концепция И. А. Соколянского и А. И. Мещерякова, описывающая этапы формирования человеческой психики, речи и мышления у слепоглухонемых детей посредством предметного самообслуживания.",
"пренатальное развитие": "Внутриутробный период развития человеческого организма от момента зачатия (слияния половых клеток) до момента рождения.",
"проблемы пренатального развития": "Комплекс физиологических (гипотрофия, пороки, инфекции) и психологических (стрессы матери, нежеланная беременность) деструкций, нарушающих гармоничный пренатальный онтогенез.",
"кризис рождения": "Нормативный физиологический и психологический этап перехода от внутриутробного к внеутробному существованию, требующий от организма кардинальной биологической адаптации.",
"рефлексы новорожденного": "Система врожденных безусловных рефлексов (пищевых, защитных и атавистических), обеспечивающих биологическое выживание младенца в первые недели жизни.",
"комплекс оживления": "Центральное психологическое новообразование периода новорожденности, выражающееся в специфической эмоционально-двигательной реакции ребенка (улыбка, вокализация, сосредоточение, движения) на появление взрослого.",
"социальная ситуация развития младенца": "Специфическое отношение между младенцем и средой, характеризующееся противоречием между максимальной социальностью (полной зависимостью от взрослого) и минимальными возможностями общения.",
"непосредственное эмоциональное общение": "Ведущая деятельность младенческого возраста (по М. И. Лисиной), заключающаяся в ситуативно-личностном обмене эмоциями, улыбками и экспрессивно-мимическими средствами со взрослым.",
"страх расставания": "Эмоциональная реакция младенца (сепарационная тревога), возникающая во втором полугодии жизни при временном исчезновении матери или контакте с незнакомыми людьми.",
"кризис одного года": "Нормативный возрастной кризис, знаменующий переход от младенчества к раннему детству и характеризующийся упрямством, капризностью и рождением автономной речи.",
"автономная речь": "Центральное новообразование кризиса одного года; специфическая, аморфная и ситуативная детская речь, служащая средством общения с близкими взрослыми.",
"социальная ситуация развития раннего детства": "Специфическая система отношений ребенка со средой в возрасте 1-3 лет, характеризующаяся совместной деятельностью со взрослым по поводу освоения общественных способов использования предметов.",
"предметно-манипулятивная деятельность": "Ведущая деятельность ребенка в раннем детстве (1-3 года), направленная на овладение общественно выработанными способами действий с предметами-орудиями.",
"ручные действия": "Действия ребенка с предметом (по П. Я. Гальперину), при которых предмет используется как простое продолжение руки, а движения подчиняются анатомии конечности.",
"орудийные действия": "Сложные действия ребенка (по П. Я. Гальперину), требующие перестройки моторики и полного подчинения движений руки логике, форме и общественной функции предмета-орудия.",
"репрезентативное мышление": "Первичная, воспроизводящая форма мышления в раннем возрасте, основанная на оперировании внутренними представлениями и образами предметов в отсутствие самих объектов в поле восприятия.",
"знаковая функция сознания": "Важнейшее новообразование раннего детства; способность человека использовать один объект в качестве заместителя другого, несущего его ментальный знак или символ.",
"кризис трех лет": "Нормативный возрастной кризис, знаменующий переход от раннего детства к дошкольному возрасту, психологическим смыслом которого является выделение своего Я и рождение ребенка как самостоятельной личности.",
"семивездие симптомов кризиса трех лет": "Описанный Л. С. Выготским комплекс поведенческих проявлений трехлетнего ребенка, включающий негативизм, упрямство, строптивость, своеволие, протест-бунт, обесценивание и деспотизм.",
"гордость за достижения": "Центральное личностное новообразование кризиса трех лет; поведенческий комплекс, выражающийся в обостренном отношении ребенка к результатам своей практической деятельности и потребности в социальном признании со стороны взрослых.",
"идеальная форма": "Понятие культурно-исторической концепции (Л. С. Выготский, Д. Б. Эльконин), обозначающее ту высшую, развитую форму объективной социокультурной действительности, с которой ребенок взаимодействует и которую активно усваивает.",
"эгоцентрическая позиция": "Перцептивная и когнитивная особенность ребенка дошкольного возраста, заключающаяся в неспособности посмотреть на объект или пространственные отношения с точки зрения другого наблюдателя, отличной от его собственной.",
"интериоризация воображения": "Процесс перехода творческой фантазии ребенка из внешнего предметного плана (игры с вещами-заместителями) во внутренний ментальный план представлений и образов.",
"соподчинение мотивов": "Центральное личностное новообразование дошкольного возраста; возникновение устойчивой иерархической структуры мотивов, при которой внутренние моральные нормы и цели начинают доминировать над импульсивными желаниями.",
"гуманистическая эмпатия": "Высший тип эмоционального сопереживания (по Т. П. Гавриловой), выражающийся в глубоком, бескорыстном сочувствии и сострадании к переживаниям другого человека, центрированный на его благе.",
"внеситуативно-познавательное общение": "Форма общения ребенка со взрослым (в 4-5 лет по М. И. Лисиной), направленная на познание физического мира вещей, где взрослый выступает в роли эксперта, а ребенок нуждается в уважении.",
"внеситуативно-личностное общение": "Высшая форма общения ребенка со взрослым (в 6-7 лет по М. И. Лисиной), центрированная на мире людей, их поступков, социальных ролей и моральных качеств, где главной потребностью выступает сопереживание и взаимопонимание.",
"структура игры Эльконина": "Система взаимосвязанных компонентов сюжетно-ролевой игры (тема, сюжет, роль, содержание, правила, реальные и ролевые отношения), выделенная Д. Б. Элькониным.",
"конструирование по образцу": "Вид конструирования, при котором ребенок воспроизводит объект по готовому физическому примеру, что развивает произвольность и зрительно-моторную координацию.",
"конструирование по условиям": "Вид конструирования, требующий от ребенка создания постройки в соответствии с жесткими критериями и текстовыми ограничениями, заданными взрослым.",
"конструирование по замыслу": "Творческий вид конструирования, при котором ребенок самостоятельно формулирует идею, конструирует образ будущего продукта и находит средства для его создания.",
"восприятие сказки": "Специфический вид деятельности дошкольника, основанный на мысленном содействии и принятии роли главного героя, обеспечивающий интериоризацию моральных норм и ценностей.",
"кризис семи лет": "Нормативный возрастной кризис, возникающий на стыке дошкольного и младшего школьного возраста, психологическим содержанием которого является рождение социального Я и дифференциация внутренней и внешней жизни ребенка.",
"утрата детской непосредственности": "Симптом кризиса семи лет по Л. С. Выготскому, выражающийся в появлении между желанием и действием ребенка интеллектуального компонента, что внешне проявляется как манерничанье и вычурность поведения.",
"аффективное обобщение": "Психический процесс формирования логики чувств (по Л. С. Выготскому), при котором единичные эмоциональные переживания ребенка обобщаются в устойчивые личностные образования (самолюбие, самооценку).",
"симптомы кризиса семи лет": "Поведенческий комплекс проявлений ребенка 6-7 лет (пауза, спор, хитрость, взрослое поведение, кривляние), свидетельствующий о перестройке его социальных отношений и готовности к школе.",
"психологическая готовность к школе": "Система взаимосвязанных психических качеств и уровней зрелости (интеллектуальной, эмоциональной, социальной), необходимых ребенку для успешного начала обучения в школе.",
"внутренняя позиция школьника": "Понятие Л. И. Божович, обозначающее центральное личностное новообразование на стыке дошкольного и младшего школьного возраста, выражающееся в осознанном стремлении ребенка стать учеником.",
"физиологическая буря": "Начальный ориентировочный этап адаптации первоклассника (первые 2-3 недели), характеризующийся бурным ответом и предельным напряжением всех систем организма на новые школьные нагрузки.",
"психологическая адаптация к школе": "Процесс и результат активного приспособления ребенка к новым условиям школьного обучения, требованиям учителей и системе межличностных отношений в коллективе сверстников.",
"социальная ситуация развития младшего школьника": "Специфическая система отношений ребенка со средой (6-7 — 10-11 лет), характеризующаяся включением в официальный институт школы и общественно значимую деятельность учения.",
"учебная деятельность": "Ведущая деятельность младшего школьного возраста, направленная на усвоение теоретических знаний, научных понятий и общих способов решения широкого класса задач.",
"новообразования младшего школьного возраста": "Качественно новые психические структуры (произвольность, рефлексия, внутренний план действий), формирующиеся в процессе освоения учебной деятельности.",
"кризис 10 лет": "Нормативный предподростковый кризис, характеризующийся снижением учебной мотивации, критичностью к взрослым и стремлением к социальной автономии.",
"социальная ситуация развития подростка": "Специфическая система отношений подростка со средой (10-11 — 14-15 лет), характеризующаяся процессами эмансипации от взрослых и переориентацией на группу сверстников.",
"интимно-личностное общение со сверстниками": "Ведущая деятельность подросткового возраста по Д. Б. Эльконину, в процессе которой происходит практическое освоение моральных норм и формирование самосознания.",
"общественно полезная деятельность": "Ведущая деятельность подросткового возраста по концепции Д. И. Фельдштейна, социально признаваемый и одобряемый труд, формирующий у подростка чувство личной ответственности.",
"чувство взрослости": "Центральное личностное новообразование подросткового возраста; субъективное отношение индивида к себе как к взрослому, проявляющееся в потребности в равноправии и автономии.",
"стадия формальных операций": "Высшая стадия развития интеллекта по Ж. Пиаже (после 11-12 лет), характеризующаяся способностью мыслить гипотетико-дедуктивно, абстрактно и системно.",
"поведенческие реакции подростков": "Специфический комплекс форм активности (эмансипация, группирование, имитация, оппозиция, гиперкомпенсация), определяющий характер поведения индивида в подростковом периоде.",
"подростковый кризис": "Нормативный возрастной кризис, знаменующий переход от детского состояния к подростковому возрасту и характеризующийся перестройкой личностной идентичности и социальных отношений со взрослыми.",
"негативная фаза подросткового возраста": "Начальный предкризисный этап подросткового периода по Л. С. Выготскому, выражающийся в отмирании прежних детских интересов, падении успеваемости и первичном непослушании.",
"путаница ролей": "Отрицательный полюс психосоциального кризиса юности по Э. Эриксону, выражающийся в неспособности интегрировать свои социальные роли в целостное Я, приводящий к ролевому смешению.",
"готовность к самоопределению": "Сформированная в старших классах школы (по И. В. Дубровиной) психологическая зрелость личности, выражающаяся в наличии планов и механизмов для выбора жизненного пути.",
"кризис идентичности в юности": "Нормативное психосоциальное противостояние периода взросления по Э. Эриксону, требующее интеграции всех представлений о своих ролях в целостный образ Я.",
"несовпадение видов зрелости": "Закономерность онтогенеза по Б. Г. Ананьеву, заключающаяся в асинхронности и несовпадении во времени моментов достижения человеком физической, гражданской и умственной зрелости.",
"кризисы профессионального развития": "Нормативные, обусловленные противоречиями трудовой деятельности переломные этапы (кризисы экспектаций, роста, карьеры), перестраивающие отношение человека к профессии и себе в ней.",
"кризис середины жизни": "Долговременное эмоциональное состояние переоценки своего жизненного опыта в среднем возрасте (35–55 лет), характеризующееся переосмыслением достижений, ценностей и поиском новых смыслов.",
"самореализация личности": "Процесс и результат максимально полного раскрытия и воплощения человеком своих внутренних потенциалов, способностей, талантов и ценностей в различных сферах жизнедеятельности.",
"двухкомпонентная модель интеллекта": "Концепция Р. Кеттелла, разделяющая умственные способности человека на подвижный интеллект (врожденная скорость обработки информации, падающая с возрастом) и кристаллизованный интеллект (накопленные знания, растущие в течение жизни).",
"стадии принятия смерти": "Система последовательных этапов эмоционального реагирования личности на неизбежность смерти по Э. Кюблер-Росс, включающая отрицание, гнев, торг, депрессию и принятие.",

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