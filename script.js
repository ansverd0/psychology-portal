let termsData = [];       
let currentIndex = 0;     

const cardElement = document.getElementById('myCard');
const termText = document.getElementById('term-text');
const definitionText = document.getElementById('definition-text');
const counterText = document.getElementById('counter-text');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

async function loadDatabase() {
    try {
        const response = await fetch('database.json');
        termsData = await response.json();
        updateCard(); 
    } catch (error) {
        console.error("Ошибка загрузки базы данных:", error);
        if (termText) termText.innerText = "Ошибка загрузки данных";
    }
}

function updateCard() {
    if (termsData.length === 0 || !cardElement) return;

    cardElement.classList.remove('flipped');
    const currentItem = termsData[currentIndex];
    
    if (termText) termText.innerText = currentItem.term;
    if (definitionText) definitionText.innerText = currentItem.definition;
    if (counterText) counterText.innerText = `${currentIndex + 1} / ${termsData.length}`;
}

// Проверяем, есть ли карточка на странице, прежде чем вешать события
if (cardElement) {
    cardElement.addEventListener('click', () => {
        cardElement.classList.toggle('flipped');
    });

    nextBtn.addEventListener('click', () => {
        if (currentIndex < termsData.length - 1) {
            currentIndex++;
            updateCard();
        } else {
            currentIndex = 0;
            updateCard();
        }
    });

    prevBtn.addEventListener('click', () => {
        if (currentIndex > 0) {
            currentIndex--;
            updateCard();
        } else {
            currentIndex = termsData.length - 1;
            updateCard();
        }
    });

    // Запускаем загрузку данных ТОЛЬКО если мы на странице тренажера
    loadDatabase();
}
