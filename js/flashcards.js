let currentActiveCards = [];

function initFlashcards() {
    const allCards = appDatabase.flashcards;
    if (!allCards || allCards.length === 0) return;

    const tilesContainer = document.getElementById('cards-discipline-tiles');
    
    // Алгоритм Фишера — Йетса для случайного перемешивания массива
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // Запуск конкретного режима тренировки
    function startCardMode(filteredCards) {
        currentActiveCards = shuffleArray([...filteredCards]); 
        currentCardIndex = 0;
        updateCard();
    }

    // Генерация плиток навигации по дисциплинам
    if (tilesContainer) {
        tilesContainer.innerHTML = '';

        // Первая обязательная плитка: Общий микс по всему курсу
        const allTile = document.createElement('button');
        allTile.classList.add('mobile-tile-btn', 'active');
        allTile.innerHTML = `🎲<br>Все темы`;
        allTile.addEventListener('click', () => {
            document.querySelectorAll('#cards-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
            allTile.classList.add('active');
            startCardMode(allCards);
        });
        tilesContainer.appendChild(allTile);

        // Динамические плитки: собираем разделы, которые реально есть в карточках
        const uniqueDisciplines = [...new Set(allCards.map(c => c.discipline).filter(Boolean))];
        
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
                
                const filtered = allCards.filter(c => c.discipline === dispId);
                startCardMode(filtered);
            });
            tilesContainer.appendChild(tile);
        });
    }

    // Включение режима общего случайного микса по умолчанию
    startCardMode(allCards);

    // Сброс старых слушателей через клонирование ноды (защита от утечек памяти)
    if (cardElement) {
        const newCardElement = cardElement.cloneNode(true);
        cardElement.parentNode.replaceChild(newCardElement, cardElement);
        
        const activeCard = document.getElementById('myCard');
        if (activeCard) {
            activeCard.addEventListener('click', () => {
                activeCard.classList.toggle('flipped');
            });
        }
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (currentActiveCards.length === 0) return;
            currentCardIndex = (currentCardIndex < currentActiveCards.length - 1) ? currentCardIndex + 1 : 0;
            updateCard();
        };
    }

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (currentActiveCards.length === 0) return;
            currentCardIndex = (currentCardIndex > 0) ? currentCardIndex - 1 : currentActiveCards.length - 1;
            updateCard();
        };
    }
}

function updateCard() {
    const liveTermText = document.getElementById('term-text');
    const liveDefinitionText = document.getElementById('definition-text');
    const liveCounterText = document.getElementById('counter-text');

    if (!currentActiveCards || currentActiveCards.length === 0) {
        if (liveTermText) liveTermText.innerText = "В этой теме пока нет карточек";
        if (liveDefinitionText) liveDefinitionText.innerText = "Скоро они здесь появятся!";
        if (liveCounterText) liveCounterText.innerText = "0 / 0";
        return;
    }

    const activeCard = document.getElementById('myCard');
    if (activeCard) activeCard.classList.remove('flipped');
    
    const currentItem = currentActiveCards[currentCardIndex];
    
    if (liveTermText) liveTermText.innerText = currentItem.term;
    if (liveDefinitionText) liveDefinitionText.innerText = currentItem.definition;
    if (liveCounterText) liveCounterText.innerText = `${currentCardIndex + 1} / ${currentActiveCards.length}`;
}
