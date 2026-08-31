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
        if (ticketsListContainer && document.getElementById('ticket-content')) {
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
function initFlashcards() {
    updateCard();

    cardElement.addEventListener('click', () => {
        cardElement.classList.toggle('flipped');
    });

    nextBtn.addEventListener('click', () => {
        const cards = appDatabase.flashcards;
        if (currentCardIndex < cards.length - 1) {
            currentCardIndex++;
        } else {
            currentCardIndex = 0;
        }
        updateCard();
    });

    prevBtn.addEventListener('click', () => {
        const cards = appDatabase.flashcards;
        if (currentCardIndex > 0) {
            currentCardIndex--;
        } else {
            currentCardIndex = cards.length - 1;
        }
        updateCard();
    });
}

function updateCard() {
    const cards = appDatabase.flashcards;
    if (!cards || cards.length === 0) return;

    cardElement.classList.remove('flipped');
    const currentItem = cards[currentCardIndex];
    
    if (termText) termText.innerText = currentItem.term;
    if (definitionText) definitionText.innerText = currentItem.definition;
    if (counterText) counterText.innerText = `${currentCardIndex + 1} / ${cards.length}`;
}

// ==========================================
// ЛОГИКА МОДУЛЯ «ЭКЗАМЕНАЦИОННЫЕ БИЛЕТЫ»
// ==========================================
function initTickets() {
    const tickets = appDatabase.tickets;
    if (!tickets || tickets.length === 0) return;

    const desktopContainer = document.getElementById('tickets-list-desktop');
    const mobileSelect = document.getElementById('tickets-list-mobile');

    if (desktopContainer) desktopContainer.innerHTML = '';
    if (mobileSelect) {
        mobileSelect.innerHTML = '<option value="" disabled selected>📋 Выберите билет...</option>';
    }

    tickets.forEach((ticket, index) => {
        if (desktopContainer) {
            const button = document.createElement('button');
            button.classList.add('ticket-nav-btn');
            button.innerText = `${ticket.number}: ${ticket.title.substring(0, 25)}...`;
            
            button.addEventListener('click', () => {
                document.querySelectorAll('.ticket-nav-btn').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showTicketContent(ticket);
            });
            desktopContainer.appendChild(button);
        }

        if (mobileSelect) {
            const option = document.createElement('option');
            option.value = index;
            option.innerText = `${ticket.number}: ${ticket.title}`;
            mobileSelect.appendChild(option);
        }
    });

    if (mobileSelect) {
        mobileSelect.addEventListener('change', (event) => {
            showTicketContent(tickets[event.target.value]);
        });
    }
}

function showTicketContent(ticket) {
    if (!ticketContentContainer) return;
    const litItems = ticket.literature.map(book => `<li>${book}</li>`).join('');
    ticketContentContainer.innerHTML = `
        <h2>${ticket.number}. ${ticket.title}</h2>
        <div class="content-text">${ticket.content}</div>
        <div class="literature-box">
            <h3>📚 Рекомендованная литература к билету:</h3>
            <ul>${litItems}</ul>
        </div>
    `;
}

// ==========================================
// ЛОГИКА МОДУЛЯ «ИНТЕРАКТИВНЫЕ ТЕСТЫ»
// ==========================================
function initQuiz() {
    const questions = appDatabase.tests;
    if (!questions || questions.length === 0) return;
    showQuestion();

    const quizNextBtn = document.getElementById('quiz-next-btn');
    quizNextBtn.addEventListener('click', () => {
        currentTestIndex++;
        if (currentTestIndex < questions.length) {
            showQuestion();
        } else {
            showResults();
        }
    });
}

function showQuestion() {
    const questions = appDatabase.tests;
    const currentQuestion = questions[currentTestIndex];
    const quizNextBtn = document.getElementById('quiz-next-btn');
    const quizOptionsContainer = document.getElementById('quiz-options');
    const quizProgress = document.getElementById('quiz-progress');
    const quizQuestion = document.getElementById('quiz-question');

    quizNextBtn.style.display = 'none';
    quizOptionsContainer.innerHTML = '';
    quizProgress.innerText = `Вопрос ${currentTestIndex + 1} из ${questions.length}`;
    quizQuestion.innerText = currentQuestion.question;

    currentQuestion.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.classList.add('option-btn');
        button.innerText = option;
        button.addEventListener('click', () => {
            handleAnswer(button, index, currentQuestion.correct);
        });
        quizOptionsContainer.appendChild(button);
    });
}

function handleAnswer(selectedButton, selectedIndex, correctIndex) {
    const quizOptionsContainer = document.getElementById('quiz-options');
    const allButtons = quizOptionsContainer.querySelectorAll('.option-btn');
    const quizNextBtn = document.getElementById('quiz-next-btn');

    if (selectedButton.classList.contains('disabled')) return;

    if (selectedIndex === correctIndex) {
        selectedButton.classList.add('correct');
        score++;
    } else {
        selectedButton.classList.add('wrong');
        allButtons[correctIndex].classList.add('correct');
    }

    allButtons.forEach(btn => btn.classList.add('disabled'));
    quizNextBtn.style.display = 'block';
}

function showResults() {
    const questions = appDatabase.tests;
    document.getElementById('quiz-wrapper').style.display = 'none';
    document.getElementById('result-wrapper').style.display = 'block';
    document.getElementById('score-text').innerText = `${score} из ${questions.length}`;

    const percentage = (score / questions.length) * 100;
    const resultFeedback = document.getElementById('result-feedback');
    if (percentage === 100) {
        resultFeedback.innerText = "Великолепный результат! Вы идеально владеете материалом. Госэкзамен вам точно по плечу! 🎯";
    } else if (percentage >= 50) {
        resultFeedback.innerText = "Хороший результат, но есть куда расти. Рекомендуем еще раз заглянуть в раздел «Экзаменационные билеты» и повторить теорию. 👍";
    } else {
        resultFeedback.innerText = "Материал усвоен слабо. Не переживайте, для этого мы и создали этот хаб. Прочитайте конспекты билетов и попробуйте пройти тест снова! 💪";
    }
}

// ==========================================
// ЛОГИКА МОДУЛЯ «РАЗДЕЛЫ ПСИХОЛОГИИ»
// ==========================================
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

        // --- ДЛЯ МОБИЛЬНЫХ (ВЫПАДАЮЩИЙ СПИСОК С ГРУППИРОВКОЙ) ---
        if (mobileSelect) {
            // Создаем визуальную группу в выпадающем списке
            const optgroup = document.createElement('optgroup');
            optgroup.label = section.title;

            section.articles.forEach(article => {
                const option = document.createElement('option');
                // Сохраняем ссылку на саму статью в формате JSON строки, чтобы потом легко прочитать
                option.value = JSON.stringify(article);
                option.innerText = article.title;
                optgroup.appendChild(option);
            });
            mobileSelect.appendChild(optgroup);
        }
    });

    if (mobileSelect) {
        mobileSelect.addEventListener('change', (event) => {
            const articleData = JSON.parse(event.target.value);
            showSectionContent(articleData);
        });
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
    "экстернальный": "Внешний локус контроля: склонность личности объяснять все свои успехи и неудачи внешними факторами (судьбой, везением, действиями других)."
};


function showSectionContent(section) {
    const contentContainer = document.getElementById('section-content');
    if (!contentContainer) return;
    
    let processedContent = section.content;

    // Автоматически ищем ключевые слова из словаря в тексте и оборачиваем их в специальный тег
    Object.keys(psychologyGlossary).forEach(term => {
        // Создаем регулярное выражение, чтобы искать слово с учетом регистра
        const regex = new RegExp(`\\b${term}\\b|(?<=\\s|^)${term}(?=\\s|[.,!?;:-]|$)`, 'gi');
        
        processedContent = processedContent.replace(regex, (match) => {
            return `<span class="wiki-term" data-tooltip="${psychologyGlossary[term]}">${match}</span>`;
        });
    });
    
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

    books.forEach(book => {
        const bookCard = document.createElement('div');
        bookCard.classList.add('menu-item'); // Используем стиль плитки из меню
        
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