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
    // Счётчик на кнопке-звёздочке (мобилка) должен обновляться сразу
    if (typeof refreshBookmarksFab === 'function') refreshBookmarksFab();
}

/** Добавить закладку
 *  meta — необязательные поля (number, folder), нужные для подписи и точного открытия */
function addBookmark(id, title, type, meta) {
    const bookmarks = getBookmarks();
    // Проверяем, нет ли уже такой закладки
    if (bookmarks.find(b => b.id === id && b.type === type)) return false;
    
    const bookmark = {
        id: id,
        title: title,
        type: type, // 'ticket' или 'article'
        timestamp: Date.now()
    };
    
    if (meta) {
        Object.keys(meta).forEach(key => {
            if (meta[key] !== null && meta[key] !== undefined) bookmark[key] = meta[key];
        });
    }
    
    bookmarks.push(bookmark);
    saveBookmarks(bookmarks);
    return true;
}

/** Удалить закладку
 *  id приходит из data-атрибута строкой, а у билетов он числовой — сравниваем нестрого */
function removeBookmark(id, type) {
    const bookmarks = getBookmarks()
        .filter(b => !(b.id == id && b.type === type));
    saveBookmarks(bookmarks);
}

/** Проверить, есть ли закладка */
function isBookmarked(id, type) {
    return getBookmarks().some(b => b.id == id && b.type === type);
}

/** Переключить закладку (добавить/удалить) */
function toggleBookmark(id, title, type, meta) {
    if (isBookmarked(id, type)) {
        removeBookmark(id, type);
        return false; // удалена
    } else {
        addBookmark(id, title, type, meta);
        return true; // добавлена
    }
}

// --- ОТОБРАЖЕНИЕ ---

/** Подпись закладки: у билетов всегда показываем номер вопроса */
function getBookmarkLabel(bookmark) {
    const number = bookmark.number !== undefined && bookmark.number !== null
        ? bookmark.number
        : (bookmark.type === 'ticket' ? bookmark.id : null);
    
    return number !== null && number !== undefined ? `№${number}. ${bookmark.title}` : bookmark.title;
}

// --- РЕНДЕР ПАНЕЛИ ЗАКЛАДОК ---

/** Отрендерить панель закладок в контейнер.
 *  options.showHeading=false — когда заголовок уже есть (модалка на телефоне) */
function renderBookmarksPanel(container, type, onItemClick, options) {
    if (!container) return;
    
    const bookmarks = getBookmarks().filter(b => b.type === type);
    const showHeading = !options || options.showHeading !== false;
    
    let html = showHeading ? `<h3>⭐ Закладки</h3>` : '';
    
    if (bookmarks.length === 0) {
        html += `<div class="bookmarks-empty">Нет сохранённых закладок</div>`;
    } else {
        html += `<div class="bookmarks-list">`;
        bookmarks.forEach(b => {
            const label = escapeHtml(getBookmarkLabel(b));
            html += `
                <div class="bookmark-item" data-id="${escapeHtml(String(b.id))}">
                    <span class="bookmark-title" title="${label}">${label}</span>
                    <button class="bookmark-remove-btn" data-remove-id="${escapeHtml(String(b.id))}" title="Удалить из закладок">✕</button>
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
            const bookmark = bookmarks.find(b => String(b.id) === id);
            if (onItemClick) onItemClick(id, bookmark);
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

/** Подматривает колонку навигации так, чтобы нужный пункт стал виден.
 *  Страницу не прокручивает — работает только внутри контейнера со скроллом */
function scrollIntoContainer(container, element) {
    if (!container || !element) return;
    
    const box = container.getBoundingClientRect();
    const item = element.getBoundingClientRect();
    
    if (item.top < box.top) {
        container.scrollTop -= (box.top - item.top);
    } else if (item.bottom > box.bottom) {
        container.scrollTop += (item.bottom - box.bottom);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

// ==========================================================================
// ЗАКЛАДКИ НА ТЕЛЕФОНЕ: кнопка-звёздочка и модалка со списком (UI-02)
// На ПК список и так виден в правой колонке, там кнопка скрыта стилями.
// ==========================================================================

/** Обработчики открытия закладки для конкретной страницы: type → fn(id, bookmark) */
const BOOKMARK_OPEN_HANDLERS = {};

function setBookmarkOpenHandler(type, fn) {
    BOOKMARK_OPEN_HANDLERS[type] = fn;
}

/** Тип закладок текущей страницы: tickets → 'ticket', sections → 'article' */
function getPageBookmarkType() {
    const fab = document.getElementById('bookmarks-fab');
    if (fab && fab.dataset.bookmarkType) return fab.dataset.bookmarkType;

    const page = document.body && document.body.dataset.page;
    return page === 'sections' ? 'article' : 'ticket';
}

function countBookmarks(type) {
    return getBookmarks().filter(b => b.type === type).length;
}

/** Обновляет счётчик на плавающей кнопке */
function refreshBookmarksFab() {
    const fab = document.getElementById('bookmarks-fab');
    if (!fab) return;

    const n = countBookmarks(getPageBookmarkType());
    const badge = fab.querySelector('.bookmarks-fab__count');

    if (badge) {
        badge.textContent = String(n);
        badge.hidden = n === 0;
    }

    fab.classList.toggle('is-empty', n === 0);
    fab.setAttribute('aria-label', n > 0 ? `Мои закладки: ${n}` : 'Мои закладки: пусто');
}

let bookmarksModalEl = null;
let bookmarksModalReturnFocus = null;

function openBookmarksModal() {
    if (!bookmarksModalEl) return;

    const type = getPageBookmarkType();
    const body = bookmarksModalEl.querySelector('#bookmarks-modal-body');

    if (body) {
        renderBookmarksPanel(body, type, (id, bookmark) => {
            closeBookmarksModal();
            const handler = BOOKMARK_OPEN_HANDLERS[type];
            if (typeof handler === 'function') handler(id, bookmark);
        }, { showHeading: false });
    }

    bookmarksModalReturnFocus = document.activeElement;
    bookmarksModalEl.hidden = false;
    document.body.classList.add('bookmarks-modal-open');

    const closeBtn = bookmarksModalEl.querySelector('.bookmarks-modal__close');
    if (closeBtn) closeBtn.focus();
}

function closeBookmarksModal() {
    if (!bookmarksModalEl || bookmarksModalEl.hidden) return;

    bookmarksModalEl.hidden = true;
    document.body.classList.remove('bookmarks-modal-open');

    if (bookmarksModalReturnFocus && typeof bookmarksModalReturnFocus.focus === 'function') {
        bookmarksModalReturnFocus.focus();
    }
    refreshBookmarksFab();
}

/** Создаёт кнопку и модалку. Только для страниц, где есть закладки. */
function buildBookmarksUi() {
    const page = document.body && document.body.dataset.page;
    if (page !== 'tickets' && page !== 'sections') return;
    if (document.getElementById('bookmarks-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'bookmarks-fab';
    fab.type = 'button';
    fab.className = 'bookmarks-fab';
    fab.dataset.bookmarkType = page === 'sections' ? 'article' : 'ticket';
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.innerHTML = '<span class="bookmarks-fab__icon" aria-hidden="true">⭐</span>' +
        '<span class="bookmarks-fab__count" hidden>0</span>';
    fab.addEventListener('click', openBookmarksModal);
    document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.id = 'bookmarks-modal';
    modal.className = 'bookmarks-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'bookmarks-modal-title');
    modal.innerHTML = `
        <div class="bookmarks-modal__panel">
            <div class="bookmarks-modal__head">
                <h3 id="bookmarks-modal-title">⭐ Закладки</h3>
                <button type="button" class="bookmarks-modal__close" aria-label="Закрыть список закладок">×</button>
            </div>
            <div class="bookmarks-modal__body" id="bookmarks-modal-body"></div>
        </div>
    `;
    document.body.appendChild(modal);
    bookmarksModalEl = modal;

    modal.querySelector('.bookmarks-modal__close').addEventListener('click', closeBookmarksModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBookmarksModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeBookmarksModal();
    });

    refreshBookmarksFab();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildBookmarksUi);
} else {
    buildBookmarksUi();
}
