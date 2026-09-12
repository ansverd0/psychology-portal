// Генератор случайных двухкомпонентных хэшей
function generateResearchKey() {
    const colors = ['зеленый', 'синий', 'красный', 'желтый', 'белый', 'серый', 'черный', 'быстрый', 'тихий', 'умный'];
    const objects = ['кедр', 'клен', 'орел', 'барс', 'ручей', 'маяк', 'шторм', 'ветер', 'филин', 'камень'];
    const number = Math.floor(Math.random() * 90) + 10; 
    
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const randomObject = objects[Math.floor(Math.random() * objects.length)];
    
    return `${randomColor}-${randomObject}-${number}`;
}

async function proceedResearchAuth() {
    const authModal = document.getElementById('research-auth-box');
    const guestBlock = document.getElementById('auth-status-guest');
    const loggedBlock = document.getElementById('auth-status-logged');
    const keyDisplay = document.getElementById('research-key-output');
    
    const generateBtn = document.getElementById('btn-generate');
    const restoreBtn = document.getElementById('btn-login');
    const inputKey = document.getElementById('research-key-input');
    const openModalBtn = document.getElementById('btn-open-auth-modal');
    const consentCheckbox = document.getElementById('chk-consent');

    function updateAuthInterface(key) {
        if (key) {
            if (guestBlock) guestBlock.style.display = 'none';
            if (loggedBlock) loggedBlock.style.display = 'block';
            if (keyDisplay) keyDisplay.innerText = key;
            if (authModal) authModal.style.display = 'none'; // Скрываем окно при успешном входе
            
            if (typeof ym === "function") {
                ym(98319694, 'userParams', { UserID: key }); 
            }
        } else {
            if (guestBlock) guestBlock.style.display = 'block';
            if (loggedBlock) loggedBlock.style.display = 'none';
            // Если пользователя нет — принудительно открываем поп-ап с размытием фона
            if (authModal) authModal.style.display = 'flex';
        }
    }

    // Ручное открытие модального окна по кнопке из шапки
    if (openModalBtn) {
        openModalBtn.onclick = () => {
            if (authModal) authModal.style.display = 'flex';
        };
    }

    // Логика генерации ID
    if (generateBtn) {
        generateBtn.onclick = async () => {
            if (consentCheckbox && !consentCheckbox.checked) {
                alert("Для работы с платформой необходимо подтвердить согласие на сохранение локального кэша.");
                return;
            }

            generateBtn.disabled = true;
            generateBtn.innerText = "Создание профиля...";
            
            let isSaved = false;
            let attempts = 0;
            let targetKey = "";

            while (!isSaved && attempts < 5) {
                targetKey = generateResearchKey();
                try {
                    const { error } = await supabaseClient
                        .from('users_profiles')
                        .insert([{ user_key: targetKey }]);
                    
                    if (!error) isSaved = true;
                    else if (error.code === "23505") attempts++;
                    else throw error;
                } catch (err) {
                    break;
                }
            }

            if (isSaved) {
                localStorage.setItem('research_user_key', targetKey);
                updateAuthInterface(targetKey);
            } else {
                alert("Ошибка соединения. Обновите страницу.");
                generateBtn.disabled = false;
                generateBtn.innerText = "🎲 Сгенерировать новый личный ID";
            }
        };
    }

    // Войти по старому ID
    if (restoreBtn && inputKey) {
        restoreBtn.onclick = async () => {
            if (consentCheckbox && !consentCheckbox.checked) {
                alert("Необходимо подтвердить согласие на обработку данных.");
                return;
            }

            const enteredKey = inputKey.value.trim().toLowerCase();
            if (!enteredKey) return;

            restoreBtn.disabled = true;

            try {
                const { data, error } = await supabaseClient
                    .from('users_profiles')
                    .select('user_key')
                    .eq('user_key', enteredKey)
                    .maybeSingle();

                if (error) throw error;

                if (data) {
                    localStorage.setItem('research_user_key', data.user_key);
                    updateAuthInterface(data.user_key);
                } else {
                    alert("Указанный ID не найден.");
                }
            } catch (err) {
                alert("Ошибка верификации.");
            } finally {
                restoreBtn.disabled = false;
            }
        };
    }

    let savedKey = localStorage.getItem('research_user_key');
    updateAuthInterface(savedKey);
}
