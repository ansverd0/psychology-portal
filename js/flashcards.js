let currentActiveCards = [];

function initFlashcards() {
    const allCards = appDatabase.flashcards;
    if (!allCards || allCards.length === 0) return;

    const tilesContainer = document.getElementById('cards-discipline-tiles');
    const liveCardElement = document.getElementById('myCard');
    const liveNextBtn = document.getElementById('next-btn');
    const livePrevBtn = document.getElementById('prev-btn');
    
    // Algorithme Fisher-Yates
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function startCardMode(filteredCards) {
        currentActiveCards = shuffleArray([...filteredCards]); 
        currentCardIndex = 0;
        updateCard();
    }

    if (tilesContainer) {
        tilesContainer.innerHTML = '';

        const allTile = document.createElement('button');
        allTile.classList.add('mobile-tile-btn', 'active');
        allTile.innerHTML = `🎲<br>Все темы`;
        allTile.addEventListener('click', () => {
            document.querySelectorAll('#cards-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
            allTile.classList.add('active');
            startCardMode(allCards);
        });
        tilesContainer.appendChild(allTile);

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

    startCardMode(allCards);

    // Безопасный сброс слушателей клика и запуск 3D-анимации поворота
    if (liveCardElement) {
        const newCardElement = liveCardElement.cloneNode(true);
        liveCardElement.parentNode.replaceChild(newCardElement, liveCardElement);
        
        const activeCard = document.getElementById('myCard');
        if (activeCard) {
            activeCard.addEventListener('click', () => {
                activeCard.classList.toggle('flipped');
            });
        }
    }

    if (liveNextBtn) {
        liveNextBtn.onclick = () => {
            if (currentActiveCards.length === 0) return;
            currentCardIndex = (currentCardIndex < currentActiveCards.length - 1) ? currentCardIndex + 1 : 0;
            updateCard();
        };
    }

    if (livePrevBtn) {
        livePrevBtn.onclick = () => {
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
