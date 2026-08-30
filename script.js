// Переменные для хранения состояния приложения
let termsData = [];       // Сюда загрузятся наши термины из файла
let currentIndex = 0;     // Индекс текущей карточки (начинаем с нуля)

// Находим элементы интерфейса на странице
const cardElement = document.getElementById('myCard');
const termText = document.getElementById('term-text');
const definitionText = document.getElementById('definition-text');
const counterText = document.getElementById('counter-text');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

// 1. Функция загрузки данных из внешнего JSON-файла
async function loadDatabase() {
    try {
        const response = await fetch('database.json');
        termsData = await response.json();
        updateCard(); // Когда данные загрузились, показываем первую карточку
    } catch (error) {
        console.error("Ошибка загрузки базы данных:", error);
        termText.innerText = "Ошибка загрузки данных";
    }
}

// 2. Функция, которая обновляет тексты на карточке
function updateCard() {
    if (termsData.length === 0) return;

    // Сбрасываем переворот карточки на лицевую сторону при перелистывании
    cardElement.classList.remove('flipped');

    // Берем данные текущего термина
    const currentItem = termsData[currentIndex];
    
    // Подставляем тексты в HTML
    termText.innerText = currentItem.term;
    definitionText.innerText = currentItem.definition;
    
    // Обновляем счетчик (например: 1 / 3)
    counterText.innerText = `${currentIndex + 1} / ${termsData.length}`;
}

// 3. Логика переворота карточки по клику
cardElement.addEventListener('click', () => {
    cardElement.classList.toggle('flipped');
});

// 4. Логика кнопок «Вперед» и «Назад»
nextBtn.addEventListener('click', () => {
    if (currentIndex < termsData.length - 1) {
        currentIndex++;
        updateCard();
    } else {
        // Если карточки кончились, можно пойти по кругу на первую
        currentIndex = 0;
        updateCard();
    }
});

prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        updateCard();
    } else {
        // Если листаем назад с первой — переходим на самую последнюю
        currentIndex = termsData.length - 1;
        updateCard();
    }
});

// Запускаем приложение при старте страницы
loadDatabase();
