# RUNBOOK — эксплуатация Psy-Education Hub

Короткие процедуры для дежурного/автора. Все команды — из корня `C:\psychology-portal`.

---

## 1. Деплой

```powershell
git status
git add <файлы>
git commit -m "fix(ui): ..."
git push origin master
```

1. GitHub Action **Sync gh-pages** зеркалит `master` в `gh-pages`.
2. GitHub Pages пересобирает сайт (30–90 секунд).
3. Проверка:

```powershell
(Invoke-WebRequest https://ansverd0.github.io/psychology-portal/sw.js -UseBasicParsing).Content |
  Select-String "CACHE_NAME"
```

Если `CACHE_NAME` не изменился, а статику меняли — вы забыли поднять версию в `sw.js`.

### Откат

```powershell
git log --oneline -5
git revert <bad-commit>        # безопасный откат
git push origin master
```

Экстренно (только если понимаете последствия):

```powershell
git reset --hard <good-commit>
git push --force origin master
```

После отката также поднимите `CACHE_NAME`, иначе браузеры останутся на сломанной версии.

---

## 2. Кэш и Service Worker

- Список кэшируемых файлов — `ASSETS` в `sw.js`.
- Любое изменение HTML/CSS/JS → `CACHE_NAME = 'psy-hub-vN+1'`.
- Обновление у пользователя: вкладка получает новый SW, `controllerchange` перезагружает страницу один раз.
- Если пользователь видит старую версию: Ctrl+F5; в DevTools → Application → Service Workers → Unregister.

---

## 3. Бэкапы БД

### Вручную (перед миграцией)

```powershell
node scripts/backup-db.mjs
# результат: backups\<timestamp>_db\*.json + _security_before.json
```

### Автоматически

Workflow `.github/workflows/backup.yml` запускается ежедневно в 03:00 UTC (06:00 МСК) и вручную:

- нужны секреты `SUPABASE_PAT`, `SUPABASE_PROJECT_REF`, `BACKUP_PASSPHRASE`;
- дамп шифруется GPG (AES256) и 14 дней лежит в artifact;
- без `BACKUP_PASSPHRASE` workflow падает и **не** выгружает открытый дамп.

### Восстановление

1. Скачать artifact `db-backup-<run_id>`.
2. Расшифровать:

```bash
gpg --batch --yes --decrypt --passphrase "$BACKUP_PASSPHRASE" \
  -o backup.tar.gz backup.tar.gz.gpg
tar -xzf backup.tar.gz -C restore/
```

3. В `restore/` — JSON по таблицам. Автоматического восстановления нет: импорт выполняется вручную через Supabase Dashboard/Table Editor или SQL с учётом внешних ключей (`users_profiles` → исследовательские таблицы).
4. После восстановления проверить `node scripts/check-permissions.mjs` и сайт.

> Бэкап — снимок данных, не схема. Схема хранится в `db/*.sql` и в Supabase.

---

## 4. Ротация PAT (Management API)

PAT даёт полный доступ к БД в обход RLS, поэтому хранится только в `.env`.

1. Supabase Dashboard → Account → Access Tokens → **Revoke** старый токен.
2. Создать новый (срок — минимально необходимый).
3. Положить в `.env`:

```
SUPABASE_PAT=sbp_...
```

4. Проверить:

```powershell
node scripts/backup-db.mjs
```

5. Старые копии (`.mcp.json`, `.vscode`, `.kodacli`) не должны содержать токен; MCP запускается через `node scripts/mcp-supabase.mjs`.

При компрометации: отозвать токен → сменить `service_role` (Dashboard → Settings → API → Rotate) → обновить `.env` → проверить сайт.

---

## 5. Проверка RLS/прав

```powershell
node scripts/check-permissions.mjs
```

Ожидаемо 10/10 PASS:

- anon читает `articles`;
- не пишет/не удаляет `glossary`;
- создаёт профиль, читает свой ключ, не меняет профиль;
- не читает `session_essays`, но может отправить эссе и результат теста;
- `service_role` читает эссе.

Если проверка падает — не деплоить, разобраться с грантами/политиками.

---

## 6. Миграции

```powershell
node scripts/db-exec.mjs db/2026-10-25_enable_rls.sql --dry-run
node scripts/db-exec.mjs db/2026-10-25_enable_rls.sql
```

Правила:

- сначала бэкап;
- DDL — в транзакции `begin; ... commit;`;
- `--dry-run` заменяет финальный `COMMIT` на `ROLLBACK`;
- после DDL — `notify pgrst, 'reload schema';` (уже есть в миграции).

---

## 7. Инциденты

### Сайт не открывается

1. `https://ansverd0.github.io/psychology-portal/` — проверить с телефона/другой сети.
2. GitHub → Actions → последний **Sync gh-pages** и **pages build and deployment**.
3. Если Pages недоступен — проверить статус GitHub; Vercel-зеркало из РФ не показатель.
4. Мониторинг `monitor.yml` создаёт issue с меткой `incident` и закрывает его после восстановления.

### Supabase не отвечает

1. Status page Supabase.
2. Проверить REST:

```powershell
curl.exe -H "apikey: <publishable>" -H "Authorization: Bearer <publishable>" `
  "https://lrjszannmammzzqotaro.supabase.co/rest/v1/version_control?select=version&limit=1"
```

3. Сайт уйдёт в офлайн-снимок из `localStorage`; данные не теряются, но новые не пишутся.
4. Если проект на паузе (free plan) — разбудить в Dashboard.

### Аналитика/согласие

- Метрика не грузится до нажатия «Разрешить аналитику».
- Проверить: DevTools → Application → Local Storage → `analytics_consent` (`granted`/`denied`).
- Отозвать: `privacy.html` → кнопка «Отозвать согласие» (удаляет отметку) или очистить localStorage.
- Вебвизор не должен записывать ввод: у полей класс `ym-disable-keys`.

### Секрет попал в git

1. Немедленно отозвать токен/ключ.
2. Удалить из истории (`git filter-repo`) или считать репозиторий скомпрометированным.
3. Проверить GitHub Secret Scanning.

---

## 8. Мониторинг

`monitor.yml` каждые 30 минут проверяет:

- `index.html`;
- `sw.js`;
- `version_control` через Supabase REST.

При сбое создаёт issue с меткой `incident`, при восстановлении — закрывает. GitHub отключит scheduled workflow после 60 дней без активности в репозитории — периодически делайте любой коммит.

---

## 9. Секреты GitHub Actions

| Секрет | Где взять | Обязателен |
|---|---|---|
| `SUPABASE_PAT` | Supabase → Account → Access Tokens | для backup |
| `SUPABASE_PROJECT_REF` | `lrjszannmammzzqotaro` | для backup |
| `BACKUP_PASSPHRASE` | сгенерировать, хранить вне git | для backup |

`GITHUB_TOKEN` выдаётся автоматически, используется мониторингом для issue.

---

## 10. Политика данных

- Страница: `privacy.html`.
- Согласие в модалке: чекбокс **не** предзаполнен, ссылка на политику.
- Аналитика: `js/analytics.js`, только после согласия.
- При изменении состава данных/третьих лиц обновить `privacy.html` и дату редакции.
