let currentActiveQuestions = [];

function initQuiz() {
    const allQuestions = appDatabase.tests;
    if (!allQuestions || allQuestions.length === 0) return;

    const quizTilesContainer = document.getElementById('quiz-discipline-tiles');

    function shuffleQuestions(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function startQuizMode(filteredQuestions) {
        let shuffled = shuffleQuestions([...filteredQuestions]); 
        
        const limitSelect = document.getElementById('quiz-limit-select');
        const chosenLimit = limitSelect ? limitSelect.value : "10"; 
        
        if (chosenLimit === "all") {
            currentActiveQuestions = shuffled; 
        } else {
            const limitNumber = parseInt(chosenLimit, 10);
            currentActiveQuestions = shuffled.slice(0, limitNumber); 
        }
        
        currentTestIndex = 0;
        score = 0;
        
        const qw = document.getElementById('quiz-wrapper');
        const rw = document.getElementById('result-wrapper');
        if (qw) qw.style.display = 'block';
        if (rw) rw.style.display = 'none';
        
        const oldProgress = document.querySelector('.result-progress-container');
        if (oldProgress) oldProgress.remove();
        const oldBtn = document.querySelector('.review-theme-btn');
        if (oldBtn) oldBtn.remove();

        showQuestion();
    }

    const limitSelect = document.getElementById('quiz-limit-select');
    if (limitSelect) {
        limitSelect.onchange = () => {
            const activeTile = document.querySelector('#quiz-discipline-tiles .mobile-tile-btn.active');
            if (activeTile) activeTile.click(); 
        };
    }

    if (quizTilesContainer) {
        quizTilesContainer.innerHTML = '';

        const allTile = document.createElement('button');
        allTile.classList.add('mobile-tile-btn', 'active');
        allTile.innerHTML = `🎲<br>Все темы`;
        allTile.addEventListener('click', () => {
            document.querySelectorAll('#quiz-discipline-tiles .mobile-tile-btn').forEach(b => b.classList.remove('active'));
            allTile.classList.add('active');
            startQuizMode(allQuestions);
        });
        quizTilesContainer.appendChild(allTile);

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

    startQuizMode(allQuestions);

    const quizNextBtn = document.getElementById('quiz-next-btn');
    if (quizNextBtn) {
        const newNextBtn = quizNextBtn.cloneNode(true);
        quizNextBtn.parentNode.replaceChild(newNextBtn, quizNextBtn);

        newNextBtn.addEventListener('click', () => {
            currentTestIndex++;
            if (currentTestIndex < currentActiveQuestions.length) {
                showQuestion();
                const qw = document.getElementById('quiz-wrapper');
                if (qw) qw.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                showResults();
                const rw = document.getElementById('result-wrapper');
                if (rw) rw.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }
}

function showQuestion() {
    if (!currentActiveQuestions || currentActiveQuestions.length === 0) return;

    const oldBtn = document.querySelector('.review-theme-btn');
    if (oldBtn) oldBtn.remove();

    const currentQuestion = currentActiveQuestions[currentTestIndex];
    const quizQuestionElement = document.getElementById('quiz-question');
    const quizOptionsContainer = document.getElementById('quiz-options');
    const quizProgressElement = document.getElementById('quiz-progress');
    const quizNextBtn = document.getElementById('quiz-next-btn');

    if (quizQuestionElement) quizQuestionElement.innerText = currentQuestion.question;
    if (quizProgressElement) quizProgressElement.innerText = `Вопрос ${currentTestIndex + 1} из ${currentActiveQuestions.length}`;
    if (quizOptionsContainer) quizOptionsContainer.innerHTML = '';
    if (quizNextBtn) quizNextBtn.style.display = 'none';

    let mappedOptions = currentQuestion.options.map((opt, idx) => {
        return { text: opt, isCorrect: idx === currentQuestion.correct };
    });

    // Перемешивание вариантов ответов внутри одного вопроса
    for (let i = mappedOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mappedOptions[i], mappedOptions[j]] = [mappedOptions[j], mappedOptions[i]];
    }

    if (quizOptionsContainer) {
        mappedOptions.forEach((option, index) => {
            const button = document.createElement('button');
            button.classList.add('option-btn');
            button.innerText = option.text;
            
            button.addEventListener('click', () => {
                const correctIdxInNewArray = mappedOptions.findIndex(o => o.isCorrect);
                handleAnswer(button, index, correctIdxInNewArray);
            });
            quizOptionsContainer.appendChild(button);
        });
    }
}

function handleAnswer(selectedButton, selectedIndex, correctIndex) {
    const quizOptionsContainer = document.getElementById('quiz-options');
    if (!quizOptionsContainer) return;

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
        if (allButtons[correctIndex]) allButtons[correctIndex].classList.add('correct');

        if (currentQuestion.link) {
            const reviewLink = document.createElement('a');
            reviewLink.href = currentQuestion.link;
            reviewLink.classList.add('review-theme-btn');
            reviewLink.innerHTML = `📖 Повторить тему конспекта`;
            quizOptionsContainer.appendChild(reviewLink);
        }
    }

    allButtons.forEach(btn => btn.classList.add('disabled'));
    if (quizNextBtn) quizNextBtn.style.display = 'block';
}

function showResults() {
    const qw = document.getElementById('quiz-wrapper');
    const rw = document.getElementById('result-wrapper');
    const st = document.getElementById('score-text');
    if (qw) qw.style.display = 'none';
    if (rw) rw.style.display = 'block';
    
    const oldBtn = document.querySelector('.review-theme-btn');
    if (oldBtn) oldBtn.remove();

    if (st) st.innerText = `${score} из ${currentActiveQuestions.length}`;

    const percentage = currentActiveQuestions.length > 0 ? (score / currentActiveQuestions.length) * 100 : 0;
    
    let progressContainer = document.querySelector('.result-progress-container');
    if (!progressContainer && st) {
        progressContainer = document.createElement('div');
        progressContainer.classList.add('result-progress-container');
        progressContainer.innerHTML = `<div class="result-progress-bar"><span class="progress-bar-text"></span></div>`;
        st.after(progressContainer);
    }
    
    if (progressContainer) {
        const progressBar = progressContainer.querySelector('.result-progress-bar');
        const progressBarText = progressContainer.querySelector('.progress-bar-text');
        
        if (progressBar) {
            if (percentage >= 75) progressBar.style.backgroundColor = '#38a169'; 
            else if (percentage >= 50) progressBar.style.backgroundColor = '#ecc94b'; 
            else progressBar.style.backgroundColor = '#e53e3e'; 
            
            setTimeout(() => {
                progressBar.style.width = `${percentage}%`;
                if (progressBarText) progressBarText.innerText = `${Math.round(percentage)}%`;
            }, 100);
        }
    }

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
