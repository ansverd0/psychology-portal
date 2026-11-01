// Проверка исследовательской схемы: RPC, RLS, подсчёт шкал.
// Запуск: node scripts/check-research.mjs
// Создаёт тестовый ключ, прогоняет все RPC и удаляет данные через service_role.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const url = env.SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE;
const anon = fs.readFileSync(path.join(root, 'js/supabase-config.js'), 'utf8')
  .match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];

if (!url || !anon || !service) {
  console.error('Не найдены URL / publishable key / service_role');
  process.exit(1);
}

const key = `dsh-research-${Date.now().toString(36)}`;
const results = [];

function check(name, actual, expected, detail = '') {
  const ok = expected(actual);
  const shown = JSON.stringify(actual) ?? String(actual);
  results.push({ name, actual: shown.slice(0, 90), ok, detail });
}

async function req(method, endpoint, { body, token = anon, prefer } = {}) {
  const headers = { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* текст ошибки */ }
  return { status: res.status, text, json };
}

const answerSet = (count, value) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), value]));

try {
  // 1. Профиль создаётся как на сайте — анонимно
  let r = await req('POST', 'users_profiles', { body: { user_key: key } });
  check('anon создаёт профиль', r.status, (s) => s >= 200 && s < 300, r.text.slice(0, 100));

  r = await req('POST', 'rpc/set_course', { body: { p_key: key, p_course: 2 } });
  check('set_course', r.status, (s) => s === 204 || s === 200, r.text.slice(0, 100));

  // 2. ШАМ: все ответы «3» → каждая шкала 12
  r = await req('POST', 'rpc/submit_instrument', {
    body: { p_key: key, p_instrument: 'sham', p_answers: answerSet(28, 3), p_duration_ms: 300000 },
  });
  const sham = r.json;
  check('ШАМ принят', r.status, (s) => s === 200, r.text.slice(0, 120));
  check('ШАМ: 7 шкал', sham ? Object.keys(sham).length : 0, (n) => n === 7);
  check('ШАМ: все шкалы = 12', sham ? Object.values(sham).every((v) => v === 12) : false, (b) => b === true);

  // 3. ССПМ: все ответы «верно» (1) → сумма положительных ключей
  r = await req('POST', 'rpc/submit_instrument', {
    body: { p_key: key, p_instrument: 'sspm', p_answers: answerSet(46, 1), p_duration_ms: 400000 },
  });
  const sspm = r.json;
  check('ССПМ принят', r.status, (s) => s === 200, r.text.slice(0, 120));
  check('ССПМ: 7 шкал', sspm ? Object.keys(sspm).length : 0, (n) => n === 7);
  check('ССПМ планирование = 7', sspm?.planning, (v) => v === 7);
  check('ССПМ моделирование = 2', sspm?.modeling, (v) => v === 2);
  check('ССПМ программирование = 6', sspm?.programming, (v) => v === 6);
  check('ССПМ результаты = 2', sspm?.results, (v) => v === 2);
  check('ССПМ гибкость = 6', sspm?.flexibility, (v) => v === 6);
  check('ССПМ самостоятельность = 8', sspm?.autonomy, (v) => v === 8);
  check('ССПМ общий = 26', sspm?.overall, (v) => v === 26);

  // 4. Повторная отправка не создаёт вторую запись
  r = await req('POST', 'rpc/submit_instrument', {
    body: { p_key: key, p_instrument: 'sham', p_answers: answerSet(28, 5) },
  });
  check('повторная отправка не падает', r.status, (s) => s === 200, r.text.slice(0, 100));

  r = await req('GET', `instrument_responses?user_key=eq.${key}&select=instrument,scales`, { token: service });
  check('записей методик ровно 2', r.json?.length, (n) => n === 2);
  check('первая версия ШАМ сохранена', r.json?.find((x) => x.instrument === 'sham')?.scales?.cognitive, (v) => v === 12);

  // 5. События
  const batch = [
    { page: 'index', event: 'page_view', ts: new Date().toISOString(), dwell_ms: 12000, scroll_pct: 40 },
    { page: 'tickets', event: 'article_open', ts: new Date().toISOString(), dwell_ms: 90000, scroll_pct: 80, meta: { id: '42' } },
    { page: 'tests', event: 'test_complete', ts: new Date().toISOString(), meta: { score: 7, total: 10 } },
  ];
  r = await req('POST', 'rpc/log_events', { body: { p_key: key, p_session: 'test-session-0001', p_events: batch } });
  check('log_events вернул 3', r.json, (n) => n === 3, r.text.slice(0, 100));

  r = await req('POST', 'rpc/log_events', {
    body: { p_key: key, p_session: 'test-session-0001', p_events: [{ page: 'index', event: 'BAD EVENT', ts: 'x' }] },
  });
  check('мусорное событие отброшено', r.json, (n) => n === 0);

  r = await req('GET', `events?user_key=eq.${key}&select=event`, { token: service });
  check('в базе 3 события', r.json?.length, (n) => n === 3);

  r = await req('GET', `events?user_key=eq.${key}&select=event`);
  check('anon не читает чужие события', r.json?.length, (n) => n === 0 || n === undefined);

  // 6. Тест знаний
  r = await req('POST', 'rpc/log_quiz_result', {
    body: { p_key: key, p_discipline: 'general-psych', p_score: 7, p_total: 10 },
  });
  check('log_quiz_result = 70', r.json, (n) => n === 70);

  // 7. Эссе
  const long = 'Это осмысленный текст достаточной длины для проверки сохранения эссе.';
  r = await req('POST', 'rpc/submit_essay', {
    body: { p_key: key, p_motive: long, p_emotion: long, p_evaluation: long, p_regulation: long },
  });
  check('эссе сохранено', r.status, (s) => s === 200, r.text.slice(0, 100));

  r = await req('POST', 'rpc/submit_essay', {
    body: { p_key: key, p_motive: 'коротко', p_emotion: long, p_evaluation: long, p_regulation: long },
  });
  check('короткое эссе отклонено', r.status, (s) => s >= 400);

  r = await req('GET', `session_essays?user_key=eq.${key}&select=id,word_count`, { token: service });
  check('эссе ровно одно', r.json?.length, (n) => n === 1);

  // 8. Флаги профиля
  r = await req('GET', `users_profiles?user_key=eq.${key}&select=course,survey_done,essay_done,tests_completed_count`, { token: service });
  const p = r.json?.[0];
  check('курс записан', p?.course, (v) => v === 2);
  check('survey_done', p?.survey_done, (v) => v === true);
  check('essay_done', p?.essay_done, (v) => v === true);
  check('счётчик тестов = 1', p?.tests_completed_count, (v) => v === 1);

  // 9. Неизвестный ключ отклоняется
  r = await req('POST', 'rpc/log_events', {
    body: { p_key: 'no-such-key-xyz', p_session: 'test-session-0002', p_events: batch },
  });
  check('неизвестный ключ отклонён', r.status, (s) => s >= 400);
} catch (e) {
  console.error('Ошибка проверки:', e);
  process.exitCode = 1;
} finally {
  // Чистка: каскад удалит responses/events по FK
  await req('DELETE', `session_essays?user_key=eq.${key}`, { token: service });
  await req('DELETE', `quiz_results?user_key=eq.${key}`, { token: service });
  await req('DELETE', `users_profiles?user_key=eq.${key}`, { token: service });
}

console.table(results.map((r) => ({ test: r.name, value: r.actual, ok: r.ok ? 'PASS' : 'FAIL' })));
if (results.some((r) => !r.ok)) process.exitCode = 1;
