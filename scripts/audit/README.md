# scripts/audit — измерительный харнесс

Скрипты только читают проект и пишут снимки/замеры в `.audit/` (в git не попадает).
Нужен Chrome (или Edge); путь можно задать `CHROME_PATH`.

## UI-аудит (сервер поднимает сам)

```powershell
node scripts/audit/ui-audit.mjs                       # все 12 страниц × 4 ширины
node scripts/audit/ui-audit.mjs --only=index,tickets  # выборочно
$env:AUDIT_OUT='ui2-s1-before'; node scripts/audit/ui-audit.mjs   # свой каталог
```

Пишет `measure.json` и PNG в `.audit/<AUDIT_OUT>/` (по умолчанию `ui-audit-latest`).

## Человеческие проходы (нужен внешний сервер)

```powershell
python -m http.server 8767 --bind 127.0.0.1     # в отдельном окне
node scripts/audit/human-practice.mjs           # 360 и 1366 по практикуму
node scripts/audit/human-site-mobile.mjs        # все страницы на 360
```

База — `APP_BASE` (по умолчанию `http://127.0.0.1:8767`), снимки — `.audit/<HUMAN_OUT>` (по умолчанию имя скрипта).

## Замеры практикума (нужен внешний сервер)

```powershell
python -m http.server 8767 --bind 127.0.0.1
$env:METRICS_OUT='practice-s2-before'; node scripts/audit/practice-metrics.mjs
$env:METRICS_OUT='practice-s2-after';  node scripts/audit/practice-metrics.mjs
```

Пишет `.audit/<METRICS_OUT>.json`: `firstCardTop`, `nextTop` после ответа, прогресс
после F5, `history.back()`, `?task=`/F5 с прокруткой, слова модалки. Числа для
«до/после» сравниваются по одному и тому же сценарию (360×740 и 1366×768).
