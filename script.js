// Глобальные переменные для данных
let appDatabase = {}; 
let currentCardIndex = 0;     
let currentTestIndex = 0; // Индекс текущего вопроса в тесте
let score = 0;            // Количество правильных ответов

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

// 1. Единая функция загрузки всей базы данных
async function loadDatabase() {
    try {
        const response = await fetch('database.json');
        appDatabase = await response.json();

        if (cardElement) {
            initFlashcards();
        }
        if (ticketsListContainer) {
            initTickets();
        }
        // Вот это новое условие:
        if (document.getElementById('quiz-wrapper')) {
            initQuiz();
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

// ПОЛНОСТЬЮ ЗАМЕНИТЕ ФУНКЦИЮ initTickets() В script.js НА ЭТУ:

function initTickets() {
    const tickets = appDatabase.tickets;
    if (!tickets || tickets.length === 0) {
        console.log("Билеты в базе данных не найдены!");
        return;
    }

    const desktopContainer = document.getElementById('tickets-list-desktop');
    const mobileSelect = document.getElementById('tickets-list-mobile');

    // Очищаем оба контейнера перед заполнением
    if (desktopContainer) desktopContainer.innerHTML = '';
    if (mobileSelect) {
        mobileSelect.innerHTML = '<option value="" disabled selected>📋 Выберите билет...</option>';
    }

    // Заполняем ОБА интерфейса параллельно
    tickets.forEach((ticket, index) => {
        
        // 1. Создаем кнопку для ПК
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

        // 2. Создаем строку для мобильного выпадающего списка
        if (mobileSelect) {
            const option = document.createElement('option');
            option.value = index;
            option.innerText = `${ticket.number}: ${ticket.title}`;
            mobileSelect.appendChild(option);
        }
    });

    // Навешиваем событие клика на выпадающий список
    if (mobileSelect) {
        mobileSelect.addEventListener('change', (event) => {
            const selectedIndex = event.target.value;
            const selectedTicket = tickets[selectedIndex];
            showTicketContent(selectedTicket);
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

// Точка входа: запускается при открытии любой страницы сайта
loadDatabase();
// ==========================================
// ЛОГИКА МОДУЛЯ «ИНТЕРАКТИВНЫЕ ТЕСТЫ»
// ==========================================

const quizWrapper = document.getElementById('quiz-wrapper');
const resultWrapper = document.getElementById('result-wrapper');
const quizProgress = document.getElementById('quiz-progress');
const quizQuestion = document.getElementById('quiz-question');
const quizOptionsContainer = document.getElementById('quiz-options');
const quizNextBtn = document.getElementById('quiz-next-btn');
const scoreText = document.getElementById('score-text');
const resultFeedback = document.getElementById('result-feedback');

function initQuiz() {
    const questions = appDatabase.tests;
    if (!questions || questions.length === 0) return;
    
    showQuestion();

    // Логика перехода к следующему вопросу
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

    // Скрываем кнопку "Дальше" до тех пор, пока пользователь не выберет ответ
    quizNextBtn.style.display = 'none';
    quizOptionsContainer.innerHTML = '';

    // Обновляем прогресс и текст вопроса
    quizProgress.innerText = `Вопрос ${currentTestIndex + 1} из ${questions.length}`;
    quizQuestion.innerText = currentQuestion.question;

    // Генерируем кнопки с вариантами ответов
    currentQuestion.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.classList.add('option-btn');
        button.innerText = option;

        // Обработка клика по варианту ответа
        button.addEventListener('click', () => {
            handleAnswer(button, index, currentQuestion.correct);
        });

        quizOptionsContainer.appendChild(button);
    });
}

function handleAnswer(selectedButton, selectedIndex, correctIndex) {
    const allButtons = quizOptionsContainer.querySelectorAll('.option-btn');

    // Если ответ уже выбран — блокируем повторные клики
    if (selectedButton.classList.contains('disabled')) return;

    // Проверяем, правильный ли выбор
    if (selectedIndex === correctIndex) {
        selectedButton.classList.add('correct');
        score++;
    } else {
        selectedButton.classList.add('wrong');
        // Подсвечиваем пользователю, какой ответ на самом деле был правильным
        allButtons[correctIndex].classList.add('correct');
    }

    // Блокируем все кнопки и показываем кнопку "Дальше"
    allButtons.forEach(btn => btn.classList.add('disabled'));
    quizNextBtn.style.display = 'block';
}

function showResults() {
    const questions = appDatabase.tests;
    
    // Прячем сам тест и показываем экран результатов
    quizWrapper.style.display = 'none';
    resultWrapper.style.display = 'block';

    // Выводим баллы
    scoreText.innerText = `${score} из ${questions.length}`;

    // Психологический фидбэк в зависимости от успешности
    const percentage = (score / questions.length) * 100;
    if (percentage === 100) {
        resultFeedback.innerText = "Великолепный результат! Вы идеально владеете материалом. Госэкзамен вам точно по плечу! 🎯";
    } else if (percentage >= 50) {
        resultFeedback.innerText = "Хороший результат, но есть куда расти. Рекомендуем еще раз заглянуть в раздел «Экзаменационные билеты» и повторить теорию. 👍";
    } else {
        resultFeedback.innerText = "Материал усвоен слабо. Не переживайте, для этого мы и создали этот хаб. Прочитайте конспекты билетов и попробуйте пройти тест снова! 💪";
    }
}
