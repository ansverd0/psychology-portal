# Промт для нового чата: спринт 3 «Дисциплина»

> Скопировать блок ниже в новый чат. Он самодостаточен: проект, что уже сделано, что делать, чем проверять, что нельзя трогать.

```text
Проект: C:\psychology-portal (статический сайт + Supabase + PWA, без сборщика).
Прочитай: docs/PLAN-UI-2026-11-13.md (спринт 3 — задачи UI2-11…UI2-13 и находки
U-09, U-12, S1, S2, P0-1, U-22, S13, U-08, P1-6, S12, P2-5), docs/UI-REDESIGN-2026-11-13.md
§«Вариант A — Дисциплины сразу», TECH-ROADMAP.md §4 этап 7, TECHCARD.md §ИНТЕРФЕЙС
(спринты 1–2 закрыты), materials/disciplines.json, js/disciplines.js,
scripts/build-disciplines.mjs, js/tickets.js, js/sections-wiki.js, js/flashcards.js,
js/quiz.js, index.html, tickets.html, sections.html, cards.html, tests.html.

Состояние: спринты 1 «Экран» (13.11, SW v36) и 2 «Практикум» (14.11, SW v37) закрыты,
node scripts/ui-probe.mjs — 177/177, 0 упавших. Практикум не трогаем: там уже
nextTop 16 px после ответа, «Решено 1 из 4» после F5, ?task= и прокрутка после F5,
первая карточка на 360×740 — 289 px.

Реестр дисциплин ещё не собран. Факты (проверены 14.11.2026):
- в materials/disciplines.json 27 дисциплин; материалы есть у 16, у 11 — ни одного
  файла (intro-profession, psychophysiology, defectology, experimental-psych,
  research-methods, conflictology, neuropsychology, clinical-child-psych,
  special-psych, differential-psych, psychocorrection), и нигде не сказано
  «материалов пока нет»;
- счётчики нигде не собираются: js/disciplines.js генерируется из disciplines.json
  и знает только название, иконку и курс;
- главная — 8 плиток инструментов, дисциплин в первом экране 0; у главной нет
  загрузчика PAGE_LOADERS, т.е. таблиц она сейчас не грузит — так и должно остаться;
- во всех списках дисциплины берутся из загруженных данных, поэтому пустых
  дисциплин там просто нет (tickets.html:63 #mobile-tickets-tiles,
  sections.html:65 #mobile-sections-tiles, cards.html:45 #cards-discipline-tiles,
  tests.html:57 #quiz-discipline-tiles);
- внутренние окна: .limited-tiles max-height 260 px, #mobile-questions-list 240 px,
  #mobile-articles-list 224 px; «Следующий/Предыдущий» в билетах и статьях нет.

Задача — только спринт 3, задачи UI2-11…UI2-13 из плана:
1. UI2-11 Реестр дисциплин: один компонент «27 дисциплин со статусами» (билеты /
   статьи / карточки / тесты / задания), пустые — «материалов пока нет» + ссылка
   на то, что есть. Счётчики — из сборки: scripts/build-disciplines.mjs →
   js/disciplines-stats.js из materials/*/content/*.json. Показывать на главной,
   билетах, разделах, тестах, карточках.
2. UI2-12 Главная по варианту A: 5 lead-строк с реальными счётчиками, «Все 27»
   (и честно «у 11 материалов пока нет»), инструменты чипами, «Что нового» —
   строкой внизу с датой из данных, кнопка ID — чипом в шапке. Ориентир —
   .audit/ui-prototype-2026-11-13/variant-a.html и его снимки.
3. UI2-13 Навигация в контенте: «Следующий / Предыдущий» в конце билета и статьи +
   «билет N из M»; список вопросов — details/drawer вместо окна 240 px; плитки
   дисциплин без окна 260 px.

Файлы: index.html, tickets.html, sections.html, cards.html, tests.html,
scripts/build-disciplines.mjs, js/disciplines-stats.js (новый, только генерация),
js/tickets.js, js/sections-wiki.js, js/flashcards.js, js/quiz.js, style.css
(блоки реестра, главной и навигации), sw.js. js/disciplines.js руками не править —
только пересборкой. Контент (materials/*/content/*.json), БД, scripts/check-*.mjs,
практикум, privacy/survey/library/news/404/offline не трогать.

Приёмка (мерить, а не «на глаз»):
- 27 дисциплин на 5 страницах (главная, билеты, разделы, тесты, карточки);
  у 11 пустых — «материалов пока нет» и ссылка на то, что есть; счётчики совпадают
  с materials (сверить скриптом, расхождений 0);
- главная: 0 запросов к Supabase (CDP Network), дата «Что нового» = последняя
  запись news;
- 390×844: в первом экране ≥ 4 дисциплины (по прототипу первая — на ~195 px);
  до списка билетов дисциплины — 1 клик, до первого билета — 2;
- у списков clientH = scrollH: .limited-tiles, #mobile-questions-list,
  #mobile-articles-list — ни одного внутреннего окна 240/260 px на 5 страницах;
- из конца билета и статьи «Следующий» переключает без прокрутки наверх
  (scrollY после перехода ≤ 120), «билет N из M» на месте;
- node scripts/ui-probe.mjs — 177/177 или больше, 0 упавших.

Снимки 390 и 1440 до/после:
$env:AUDIT_OUT='ui2-s3-before'; node scripts/audit/ui-audit.mjs --widths=390,1440
(и то же с 'ui2-s3-after'). Человеческий проход: сервер поднять отдельно
python -m http.server 8767 --bind 127.0.0.1, затем node scripts/audit/human-site-mobile.mjs
и node scripts/audit/human-tiles-nav.mjs. Новый замер — scripts/audit/discipline-metrics.mjs
($env:METRICS_OUT): 27/11, дисциплины в первом экране, клики до билета,
clientH=scrollH, scrollY после «Следующего», число запросов к Supabase.

Правила проекта: один спринт — один коммит (feat(ui2): …); CACHE_NAME поднять
(v37 → v38); новый файл — в sw.js ASSETS; новые значения в CSS — только через
:root-токены; кириллицу не переписывать через PowerShell Get-Content/Set-Content;
после работы обновить TECHCARD §ИНТЕРФЕЙС, TECH-ROADMAP (журнал) и
docs/PLAN-UI-2026-11-13.md (журнал выполнения), затем
python "$env:USERPROFILE\.dsh\tools\handoff.py" --project C:\psychology-portal --next "…"
и --check = 0.

Сначала покажи план правок по файлам и что именно померишь до/после, потом делай.
```

## Что проверить перед стартом

- `git log --oneline -3` — последние коммиты спринта 2.
- `git status` — рабочее дерево чистое (кроме `docs/AUDIT-2026-11-10.md`, `docs/AUDIT-UI-2026-11-10.md` и `docs/audit-2026-11-10/` — они вне этапа).
- `node scripts/build-disciplines.mjs` — пересборка ничего не меняет (реестр в git синхронен).
- `node scripts/ui-probe.mjs --only=practice` — зелёный до правок (практикум не должен ломаться).
