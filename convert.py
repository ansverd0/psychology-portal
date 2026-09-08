import json
import csv
import re

# 1. Загружаем исходный файл данных
with open('database.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

# --- ТАБЛИЦА 1: Дисциплины (статический справочник) ---
disciplines_data = [
    {"id": "general-psych", "title": "Общая психология", "short_title": "Общая", "emoji": "🧠"},
    {"id": "social-psych", "title": "Социальная психология", "short_title": "Социальная", "emoji": "👥"},
    {"id": "developmental-psych", "title": "Возрастная психология", "short_title": "Возрастная", "emoji": "🌱"}
]
with open('csv_disciplines.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=["id", "title", "short_title", "emoji"])
    writer.writeheader()
    writer.writerows(disciplines_data)

# --- ТАБЛИЦА 2: Флэш-карточки ---
with open('csv_flashcards.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["discipline_id", "term", "definition"])
    for card in db.get("flashcards", []):
        writer.writerow([card.get("discipline"), card.get("term"), card.get("definition")])

# --- ТАБЛИЦА 3: Интерактивные тесты ---
with open('csv_tests.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["discipline_id", "question", "options", "correct_index", "link_url"])
    for test in db.get("tests", []):
        # Преобразуем массив строк в формат массива PostgreSQL: {"Вариант 1","Вариант 2"}
        opts = test.get("options", [])
        escaped_opts = [opt.replace('"', '\\"') for opt in opts]
        pg_array = "{" + ",".join(f'"{o}"' for o in escaped_opts) + "}"
        
        writer.writerow([
            test.get("discipline"),
            test.get("question"),
            pg_array,
            test.get("correct"), # В JSON индексы уже 0, 1, 2, 3
            test.get("link", "")
        ])

# --- ТАБЛИЦА 4: Секции (Статьи-лонгриды) ---
with open('csv_articles.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["discipline_id", "title", "content", "sort_order"])
    order = 0
    for section in db.get("sections", []):
        disc_id = section.get("id")
        for art in section.get("articles", []):
            writer.writerow([disc_id, art.get("title"), art.get("content"), order])
            order += 1

# --- ТАБЛИЦА 5: Литература ---
# Сначала соберем словарь существующих книг, чтобы привязать их к билетам по авторам/названиям
books_pool = {}
book_id_counter = 1

with open('csv_library.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["id", "title", "author", "annotation"])
    for book in db.get("library", []):
        b_id = book.get("id") or book_id_counter
        # Если ID строковый, заменим на число
        if isinstance(b_id, str):
            b_id = book_id_counter
            book_id_counter += 1
        else:
            if b_id >= book_id_counter:
                book_id_counter = b_id + 1
                
        title = book.get("title")
        author = book.get("author")
        writer.writerow([b_id, title, author, book.get("annotation", "")])
        # Кешируем для связующей таблицы билетов
        books_pool[f"{author.strip().lower()} {title.strip().lower()}"] = b_id

# --- ТАБЛИЦА 6 & 7: Билеты и Связи Many-to-Many ---
tickets_rows = []
ticket_library_rows = []
ticket_id_counter = 1

for ticket_group in db.get("tickets", []):
    disc_id = ticket_group.get("id") # general-psych, social-psych и т.д.
    for q in ticket_group.get("questions", []):
        t_id = ticket_id_counter
        ticket_id_counter += 1
        
        tickets_rows.append([
            t_id,
            disc_id,
            q.get("number"),
            q.get("title"),
            q.get("time", ""),
            q.get("plan", ""),
            q.get("content")
        ])
        
        # Разбираем массив литературы ("literature") и ищем совпадения в библиотеке
        for lit_str in q.get("literature", []):
            matched = False
            for pool_key, b_id in books_pool.items():
                # Если строка литературы содержит автора или название из пула книг
                if pool_key in lit_str.lower() or lit_str.lower() in pool_key:
                    ticket_library_rows.append([t_id, b_id])
                    matched = True
                    break

with open('csv_tickets.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["id", "discipline_id", "number", "title", "recommend_time", "plan", "content"])
    writer.writerows(tickets_rows)

with open('csv_ticket_library.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(["ticket_id", "book_id"])
    writer.writerows(ticket_library_rows)

print("🎉 Конвертация успешна! Сгенерировано 7 CSV файлов.")
