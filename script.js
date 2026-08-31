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
function initSections() {
    const sections = appDatabase.sections;
    if (!sections || sections.length === 0) return;

    const desktopContainer = document.getElementById('sections-list-desktop');
    const mobileSelect = document.getElementById('sections-list-mobile');

    if (desktopContainer) desktopContainer.innerHTML = '';
    if (mobileSelect) {
        mobileSelect.innerHTML = '<option value="" disabled selected>📋 Выберите раздел...</option>';
    }

    sections.forEach((section, index) => {
        if (desktopContainer) {
            const button = document.createElement('button');
            button.classList.add('ticket-nav-btn');
            button.innerText = section.title;
            
            button.addEventListener('click', () => {
                document.querySelectorAll('#sections-list-desktop .ticket-nav-btn').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                showSectionContent(section);
            });
            desktopContainer.appendChild(button);
        }

        if (mobileSelect) {
            const option = document.createElement('option');
            option.value = index;
            option.innerText = section.title;
            mobileSelect.appendChild(option);
        }
    });

    if (mobileSelect) {
        mobileSelect.addEventListener('change', (event) => {
            showSectionContent(sections[event.target.value]);
        });
    }
}

function showSectionContent(section) {
    const contentContainer = document.getElementById('section-content');
    if (!contentContainer) return;
    
    contentContainer.innerHTML = `
        <h2>${section.title}</h2>
${section.content}
`;
}// Железный запуск всей системы при открытии любой страницы сайтаloadDatabase();
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

loadDatabase();