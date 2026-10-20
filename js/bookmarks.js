// ==========================================================================
// СИСТЕМА ЗАКЛАДОК (bookmarks.js)
// Единый модуль для страниц tickets.html и sections.html
// ==========================================================================

const BOOKMARKS_STORAGE_KEY = 'hub_bookmarks';

// --- БАЗОВЫЕ ОПЕРАЦИИ ---

/** Получить все закладки */
function getBookmarks() {
    try {
        const data = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.warn('⚠️ Ошибка чтения закладок:', e);
        return [];
    }
}

/** Сохранить массив закладок */
function saveBookmarks(bookmarks) {
    try {
        localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
    } catch (e) {
        console.warn('⚠️ Ошибка сохранения закладок:', e);
    }
}

/** Добавить закладку */
function addBookmark(id, title, type) {
    const bookmarks = getBookmarks();
    // Проверяем, нет ли уже такой закладки
    if (bookmarks.find(b => b.id === id && b.type === type)) return false;
    
    bookmarks.push({
        id: id,
        title: title,
        type: type, // 'ticket' или 'article'
        timestamp: Date.now()
    });
    saveBookmarks(bookmarks);
    return true;
}

/** Удалить закладку */
function removeBookmark(id, type) {
    const bookmarks = getBookmarks()
        .filter(b => !(b.id === id && b.type === type));
    saveBookmarks(bookmarks);
}

/** Проверить, есть ли закладка */
function isBookmarked(id, type) {
    return getBookmarks().some(b => b.id === id && b.type === type);
}

/** Переключить закладку (добавить/удалить) */
function toggleBookmark(id, title, type) {
    if (isBookmarked(id, type)) {
        removeBookmark(id, type);
        return false; // удалена
    } else {
        addBookmark(id, title, type);
        return true; // добавлена
    }
}

// --- РЕНДЕР ПАНЕЛИ ЗАКЛАДОК ---

/** Отрендерить панель закладок в контейнер */
function renderBookmarksPanel(container, type, onItemClick) {
    if (!container) return;
    
    const bookmarks = getBookmarks().filter(b => b.type === type);
    
    let html = `<h3>⭐ Закладки</h3>`;
    
    if (bookmarks.length === 0) {
        html += `<div class="bookmarks-empty">Нет сохранённых закладок</div>`;
    } else {
        html += `<div class="bookmarks-list">`;
        bookmarks.forEach(b => {
            html += `
                <div class="bookmark-item" data-id="${b.id}">
                    <span class="bookmark-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</span>
                    <button class="bookmark-remove-btn" data-remove-id="${b.id}" title="Удалить из закладок">✕</button>
                </div>
            `;
        });
        html += `</div>`;
    }
    
    container.innerHTML = html;
    
    // Обработчики кликов на элементы закладок
    container.querySelectorAll('.bookmark-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Не срабатывает на кнопку удаления
            if (e.target.closest('.bookmark-remove-btn')) return;
            
            const id = item.getAttribute('data-id');
            if (onItemClick) onItemClick(id);
        });
    });
    
    // Обработчики кликов на кнопки удаления
    container.querySelectorAll('.bookmark-remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-remove-id');
            removeBookmark(id, type);
            renderBookmarksPanel(container, type, onItemClick);
        });
    });
}

/** Обновить кнопку звёздочки для конкретного элемента */
function updateBookmarkStar(button, id, type) {
    if (!button) return;
    
    const bookmarked = isBookmarked(id, type);
    button.classList.toggle('active', bookmarked);
    button.innerHTML = bookmarked ? '★' : '☆';
}

/** Обработчик клика на кнопку звёздочки */
function createBookmarkStarHandler(button, id, title, type, onChange) {
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        const added = toggleBookmark(id, title, type);
        updateBookmarkStar(button, id, type);
        if (onChange) onChange(added, id);
    });
}

// --- ВСПОМОГАТЕЛЬНЫЕ ---

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}
