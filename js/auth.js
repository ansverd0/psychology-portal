// Генератор случайных двухкомпонентных хэшей
function generateResearchKey() {
    const colors = ['зеленый', 'синий', 'красный', 'желтый', 'белый', 'серый', 'черный', 'быстрый', 'тихий', 'умный'];
    const objects = ['кедр', 'клен', 'орел', 'барс', 'ручей', 'маяк', 'шторм', 'ветер', 'филин', 'камень'];
    const number = Math.floor(Math.random() * 90) + 10; 
    
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const randomObject = objects[Math.floor(Math.random() * objects.length)];
    
    return `${randomColor}-${randomObject}-${number}`;
}

// ========== Модалка авторизации: доступность (U-02) ==========
let _authModalRestoreFocus = null;
let _authModalKeydownHandler = null;

function openAuthModal() {
    const authModal = document.getElementById('research-auth-box');
    if (!authModal) return;
    _authModalRestoreFocus = document.activeElement;
    authModal.style.display = 'flex';
    const closeBtn = document.getElementById('btn-close-auth');
    if (closeBtn) closeBtn.focus();
    _setupAuthModalKeydown();
}

function closeAuthModal(restoreFocus = true) {
    const authModal = document.getElementById('research-auth-box');
    if (!authModal) return;
    authModal.style.display = 'none';
    if (_authModalKeydownHandler) {
        document.removeEventListener('keydown', _authModalKeydownHandler);
        _authModalKeydownHandler = null;
    }
    if (restoreFocus) {
        const trigger = document.getElementById('btn-open-auth-modal');
        if (trigger && trigger.offsetParent !== null) {
            trigger.focus();
        } else if (_authModalRestoreFocus) {
            _authModalRestoreFocus.focus();
        }
        _authModalRestoreFocus = null;
    }
}

function _setupAuthModalKeydown() {
    if (_authModalKeydownHandler) {
        document.removeEventListener('keydown', _authModalKeydownHandler);
    }
    _authModalKeydownHandler = function (e) {
        if (e.key === 'Escape') {
            closeAuthModal(true);
            return;
        }
        if (e.key !== 'Tab') return;
        const authModal = document.getElementById('research-auth-box');
        if (!authModal || authModal.style.display === 'none') return;
        const whitePanel = document.getElementById('research-auth-panel');
        if (!whitePanel) return;
        const focusable = whitePanel.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };
    document.addEventListener('keydown', _authModalKeydownHandler);
}

// ========== Основная логика авторизации ==========

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
    const guestBtn = document.getElementById('btn-guest');

    // Кнопка "Продолжить как гость" — всегда доступна, не зависит от Supabase
    if (guestBtn) {
        guestBtn.addEventListener('click', () => {
            continueAsGuest();
        });
    }

    function updateAuthInterface(key) {
        if (key) {
            if (guestBlock) guestBlock.style.display = 'none';
            if (loggedBlock) loggedBlock.style.display = 'block';
            if (keyDisplay) keyDisplay.innerText = key;
            // Не показываем модалку автоматически при наличии ключа
            if (authModal) authModal.style.display = 'none';
            
            if (typeof ym === "function") {
                ym(112398882, 'userParams', { UserID: key }); 
            }
        } else {
            // Больше не блокируем пользователя — показываем кнопку входа в шапке
            if (guestBlock) guestBlock.style.display = 'block';
            if (loggedBlock) loggedBlock.style.display = 'none';
            // НЕ открываем модалку автоматически — пользователь сам нажмёт кнопку
            // if (authModal) authModal.style.display = 'flex';  // УДАЛЕНО: блокировка
        }
    }

    // Ручное открытие модального окна по кнопке из шапки
    if (openModalBtn) {
        openModalBtn.onclick = () => {
            openAuthModal();
        };
    }

    // Кнопка закрытия модалки (крестик)
    const closeBtn = document.getElementById('btn-close-auth');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeAuthModal(true);
        });
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

            if (!supabaseClient) {
                alert("Сервер временно недоступен. Попробуйте позже или продолжите как гость.");
                generateBtn.disabled = false;
                generateBtn.innerText = "🎲 Сгенерировать новый личный ID";
                return;
            }
            
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
                closeAuthModal(false);
            } else {
                alert("Ошибка соединения. Обновите страницу.");
                generateBtn.disabled = false;
                generateBtn.innerText = "🎲 Сгенерировать новый личный ID";
            }
        };
    }

    // Войти как гость — сайт работает без авторизации (для чтения библиотеки и новостей)
    function continueAsGuest() {
        closeAuthModal(true);
        if (guestBlock) guestBlock.style.display = 'block';
        if (loggedBlock) loggedBlock.style.display = 'none';
        // Сохраняем пустой ключ — сайт будет работать в режиме только чтения
        localStorage.removeItem('research_user_key');
    }

    if (restoreBtn && inputKey) {
        restoreBtn.onclick = async () => {
            if (consentCheckbox && !consentCheckbox.checked) {
                alert("Необходимо подтвердить согласие на обработку данных.");
                return;
            }

            const enteredKey = inputKey.value.trim().toLowerCase();
            if (!enteredKey) return;

            if (!supabaseClient) {
                alert("Сервер временно недоступен. Попробуйте позже или продолжите как гость.");
                return;
            }

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
                    closeAuthModal(false);
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
