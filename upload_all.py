import json
from supabase import create_client, Client

# 1. Данные для подключения (Проверьте Project Settings -> API в Supabase)
SUPABASE_URL = "https://supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_bwLDUQMS1RVwHF2wHE62hg_sODGX5vi" # Используйте service_role_key, если anon выдаст ошибку доступа

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# 2. Открываем ваш полный локальный файл с данными
with open('database.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

print("📡 Запуск синхронизации локального database.json с облаком Supabase...")

def clear_and_upload():
    try:
        # --- 1. ОЧИСТКА СТАРЫХ ДАННЫХ (Строго снизу вверх по внешним ключам) ---
        print("🗑️ Очистка таблиц в облаке...")
        supabase.table("ticket_library").delete().neq("ticket_id", 0).execute()
        supabase.table("tickets").delete().neq("id", 0).execute()
        supabase.table("library").delete().neq("id", 0).execute()
        supabase.table("tests").delete().neq("id", 0).execute()
        supabase.table("flashcards").delete().neq("id", 0).execute()
        supabase.table("articles").delete().neq("id", 0).execute()
        supabase.table("glossary").delete().neq("term", "").execute()
        supabase.table("news").delete().neq("id", 0).execute()

        # --- 2. СИНХРОНИЗАЦИЯ НОВОСТЕЙ (Слово в слово из JSON) ---
        print("📰 Загрузка ченджлога новостей...")
        news_rows = []
        for idx, item in enumerate(db.get("news", []), start=1):
            news_rows.append({
                "id": idx,
                "date": item.get("date"),
                "title": item.get("title"),
                "changes": item.get("changes", []) # PostgreSQL массив
            })
        if news_rows: supabase.table("news").insert(news_rows).execute()

        # --- 3. СИНХРОНИЗАЦИЯ ГЛОССАРИЯ (Все 300+ терминов) ---
        print("🧠 Загрузка глоссария...")
        glossary_rows = []
        # Вытаскиваем термины из flashcards, определяя дисциплину
        for card in db.get("flashcards", []):
            glossary_rows.append({
                "term": card.get("term").strip(),
                "definition": card.get("definition"),
                "discipline_id": card.get("discipline", "general-psych")
            })
        # Убираем дубликаты терминов, если они есть
        unique_glossary = {x['term']: x for x in glossary_rows}.values()
        if unique_glossary: supabase.table("glossary").insert(list(unique_glossary)).execute()

        # --- 4. СИНХРОНИЗАЦИЯ ОСТАЛЬНЫХ ТАБЛИЦ ---
        print("🌱 Загрузка флэш-карточек...")
        card_rows = [{"term": c.get("term"), "definition": c.get("definition"), "discipline_id": c.get("discipline")} for c in db.get("flashcards", [])]
        if card_rows: supabase.table("flashcards").insert(card_rows).execute()

        print("🧠 Загрузка интерактивных тестов...")
        test_rows = [{
            "discipline_id": t.get("discipline"),
            "question": t.get("question"),
            "options": t.get("options", []),
            "correct_index": t.get("correct"),
            "link_url": t.get("link", "")
        } for t in db.get("tests", [])]
        if test_rows: supabase.table("tests").insert(test_rows).execute()

        print("📚 Загрузка библиотеки...")
        library_rows = []
        books_pool = {}
        for idx, b in enumerate(db.get("library", []), start=1):
            b_id = b.get("id") or idx
            library_rows.append({
                "id": b_id,
                "title": b.get("title"),
                "author": b.get("author"),
                "annotation": b.get("annotation", "")
            })
            books_pool[f"{b.get('author').strip().lower()} {b.get('title').strip().lower()}"] = b_id
        if library_rows: supabase.table("library").insert(library_rows).execute()

        print("📋 Загрузка экзаменационных билетов...")
        ticket_rows = []
        ticket_library_rows = []
        t_id_counter = 1
        for tg in db.get("tickets", []):
            disc_id = tg.get("id")
            for q in tg.get("questions", []):
                t_id = t_id_counter
                t_id_counter += 1
                ticket_rows.append({
                    "id": t_id,
                    "discipline_id": disc_id,
                    "number": q.get("number"),
                    "title": q.get("title"),
                    "recommend_time": q.get("time", ""),
                    "plan": q.get("plan", ""),
                    "content": q.get("content")
                })
                for lit_str in q.get("literature", []):
                    for pool_key, b_id in books_pool.items():
                        if pool_key in lit_str.lower() or lit_str.lower() in pool_key:
                            ticket_library_rows.append({"ticket_id": t_id, "book_id": b_id})
                            break
        if ticket_rows: supabase.table("tickets").insert(ticket_rows).execute()
        if ticket_library_rows: supabase.table("ticket_library").insert(ticket_library_rows).execute()

        print("📄 Загрузка статей-лонгридов...")
        article_rows = []
        for sec in db.get("sections", []):
            disc_id = sec.get("id")
            for art in sec.get("articles", []):
                article_rows.append({
                    "discipline_id": disc_id,
                    "title": art.get("title"),
                    "content": art.get("content")
                })
        if article_rows: supabase.table("articles").insert(article_rows).execute()

        print("🎉 СИНХРОНИЗАЦИЯ УСПЕШНО ЗАВЕРШЕНА! Все данные в облаке.")

    except Exception as e:
        print(f"❌ Произошла ошибка при загрузке: {e}")

if __name__ == "__main__":
    clear_and_upload()
