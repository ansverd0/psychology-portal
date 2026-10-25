// ==========================================
// ЭКРАНИРОВАНИЕ ДАННЫХ ИЗ БД
// Контент приходит из Supabase и не должен
// интерпретироваться как HTML (защита от XSS).
// ==========================================
function escapeNewsHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// ЛОГИКА МОДУЛЯ «ЛИТЕРАТУРА»
// ==========================================
function initLibrary() {
    const books = appDatabase.library;
    const container = document.getElementById('books-container');
    if (!books || !container) return;

    container.innerHTML = '';

    // Алфавитная сортировка книг по фамилии автора
    const sortedBooks = [...books].sort((a, b) => String(a.author || '').localeCompare(String(b.author || ''), 'ru'));

    sortedBooks.forEach(book => {
        const bookCard = document.createElement('div');
        bookCard.classList.add('menu-item');

        bookCard.innerHTML = `
            <div class="icon">📚</div>
            <h2>${escapeNewsHtml(book.author)} — ${escapeNewsHtml(book.title)}</h2>
            <p>${escapeNewsHtml(book.annotation)}</p>
        `;
        container.appendChild(bookCard);
    });
}

// ==========================================
// ЛОГИКА МОДУЛЯ «ЧЕНДЖЛОГ / НОВОСТИ»
// ==========================================
function initNews() {
    const newsData = appDatabase.news;
    const container = document.getElementById('news-timeline');
    if (!newsData || !container) return;

    container.innerHTML = '';

    newsData.forEach(item => {
        const newsCard = document.createElement('div');
        newsCard.style.cssText = "background: white; border: 2px solid #e2e8f0; border-radius: 16px; padding: 25px; margin-bottom: 25px; text-align: left;";

        // Превращаем массив строк изменений в маркированный список
        const changes = Array.isArray(item.changes) ? item.changes : [];
        const changesList = changes
            .map(change => `<li style="margin-bottom: 8px; line-height: 1.5; color: #4a5568;">${escapeNewsHtml(change)}</li>`)
            .join('');

        newsCard.innerHTML = `
            <div style="display: inline-block; background: #ebf8ff; color: #2b6cb0; font-size: 13px; font-weight: bold; padding: 4px 10px; border-radius: 12px; margin-bottom: 12px;">📅 ${escapeNewsHtml(item.date)}</div>
            <h2 style="margin: 0 0 15px 0; color: #1a365d; font-size: 20px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 10px;">${escapeNewsHtml(item.title)}</h2>
            <ul style="margin: 0; padding-left: 20px;">${changesList}</ul>
        `;
        container.appendChild(newsCard);
    });
}
