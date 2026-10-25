// Проверка прав anon после включения RLS.
// Запуск: node scripts/check-permissions.mjs
// Создаёт временные строки и удаляет их через service_role.

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
const anon = fs.readFileSync(path.join(root, 'js/supabase-config.js'), 'utf8')
  .match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
const service = env.SUPABASE_SERVICE_ROLE;

if (!url || !anon || !service) {
  console.error('Не найдены URL / publishable key / service_role');
  process.exit(1);
}

const testKey = `dsh-perm-${Date.now().toString(36)}`;
const results = [];

async function req(method, endpoint, { body, key = anon, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

function check(name, actual, expected, detail = '') {
  const ok = expected(actual);
  results.push({ name, actual, ok, detail });
}

try {
  let r = await req('GET', 'articles?select=id&limit=1');
  check('anon читает контент (articles)', r.status, (s) => s === 200);

  r = await req('POST', 'glossary', { body: { term: `_perm_${testKey}`, definition: 'x' } });
  check('anon НЕ может писать в glossary', r.status, (s) => s >= 400 && s < 500);

  r = await req('DELETE', `glossary?term=eq._perm_${testKey}`);
  check('anon НЕ может удалять из glossary', r.status, (s) => s >= 400 && s < 500);

  r = await req('POST', 'users_profiles', { body: { user_key: testKey } });
  check('anon может создать профиль', r.status, (s) => s >= 200 && s < 300, r.text.slice(0, 120));

  r = await req('GET', `users_profiles?select=user_key&user_key=eq.${testKey}`);
  check('anon может прочитать свой ключ', r.status, (s) => s === 200);

  r = await req('PATCH', `users_profiles?user_key=eq.${testKey}`, { body: { user_key: testKey + '-x' } });
  check('anon НЕ может менять профиль', r.status, (s) => s >= 400 && s < 500);

  r = await req('GET', 'session_essays?select=id');
  check('anon НЕ читает чужие эссе', r.status, (s) => s >= 400 && s < 500);

  r = await req('POST', 'session_essays', { body: { user_key: testKey, motive_text: 'test' } });
  check('anon может отправить эссе', r.status, (s) => s >= 200 && s < 300, r.text.slice(0, 120));

  r = await req('POST', 'quiz_results', {
    body: { user_key: testKey, discipline_id: 'general-psych', score_obtained: 1, total_questions: 2, percentage: 50 },
  });
  check('anon может записать результат теста', r.status, (s) => s >= 200 && s < 300, r.text.slice(0, 120));

  r = await req('GET', 'session_essays?select=id', { key: service });
  check('service_role читает эссе', r.status, (s) => s === 200);

  // Чистка тестовых строк
  await req('DELETE', `session_essays?user_key=eq.${testKey}`, { key: service });
  await req('DELETE', `quiz_results?user_key=eq.${testKey}`, { key: service });
  await req('DELETE', `users_profiles?user_key=eq.${testKey}`, { key: service });
} catch (e) {
  console.error('Ошибка проверки:', e);
  process.exitCode = 1;
}

console.table(results.map((r) => ({ test: r.name, status: r.actual, ok: r.ok ? 'PASS' : 'FAIL' })));
if (results.some((r) => !r.ok)) process.exitCode = 1;
