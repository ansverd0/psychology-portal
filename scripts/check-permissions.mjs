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
  check('anon НЕ пишет в quiz_results напрямую', r.status, (s) => s >= 400 && s < 500, r.text.slice(0, 120));

  r = await req('POST', 'rpc/log_quiz_result', {
    body: { p_key: testKey, p_discipline: 'general-psych', p_score: 1, p_total: 2 },
  });
  check('anon пишет результат теста через RPC log_quiz_result', r.status, (s) => s >= 200 && s < 300, r.text.slice(0, 120));

  r = await req('GET', `quiz_results?select=id,percentage&user_key=eq.${testKey}`, { key: service });
  const savedRows = (() => { try { return JSON.parse(r.text).length; } catch { return -1; } })();
  check('результат лёг в quiz_results (видно через service_role)', savedRows, (n) => n === 1);

  r = await req('GET', `users_profiles?select=tests_completed_count&user_key=eq.${testKey}`, { key: service });
  const counter = (() => { try { return JSON.parse(r.text)[0].tests_completed_count; } catch { return -1; } })();
  check('счётчик пройденных тестов вырос до 1', counter, (n) => n === 1);

  r = await req('GET', 'session_essays?select=id', { key: service });
  check('service_role читает эссе', r.status, (s) => s === 200);

  // Практикум: задания читаются, попытки — только через RPC
  r = await req('GET', 'practice_tasks?select=id,kind,correct_index,criteria&active=eq.true&order=sort_order');
  const practiceTasks = (() => { try { return JSON.parse(r.text) || []; } catch { return []; } })();
  check('anon читает задания практикума', r.status, (s) => s === 200);
  const choiceTask = practiceTasks.find((t) => t.kind === 'choice');
  const openTask = practiceTasks.find((t) => t.kind === 'open');
  check('в базе есть задачи practice (choice и open)', Boolean(choiceTask && openTask), (b) => b === true);

  r = await req('POST', 'practice_tasks', {
    body: {
      discipline_id: 'general-psych', slug: 'perm-test-task', level: 'apply', title: 'тестовая задача',
      situation: 'x'.repeat(60), task: 'x'.repeat(30), kind: 'open',
      criteria: ['x'.repeat(12), 'y'.repeat(12), 'z'.repeat(12)], model_answer: 'm'.repeat(60),
    },
  });
  check('anon НЕ может писать в practice_tasks', r.status, (s) => s >= 400 && s < 500);

  r = await req('GET', 'practice_attempts?select=id');
  const attemptsVisible = (() => { try { return JSON.parse(r.text)?.length; } catch { return null; } })();
  check('anon НЕ читает попытки практикума', r.status >= 400 || attemptsVisible === 0, (b) => b === true, `HTTP ${r.status}`);

  r = await req('POST', 'practice_attempts', {
    body: { user_key: testKey, task_id: choiceTask?.id ?? 0, answer: { choice: 0 }, is_correct: true },
  });
  check('anon НЕ пишет в practice_attempts напрямую', r.status, (s) => s >= 400 && s < 500);

  r = await req('POST', 'rpc/submit_practice_attempt', {
    body: {
      p_key: testKey,
      p_task_id: choiceTask?.id ?? 0,
      p_answer: { choice: choiceTask?.correct_index ?? 0 },
      p_duration_ms: 60000,
    },
  });
  const choiceResult = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
  check('anon отправляет choice-попытку через RPC', r.status, (s) => s === 200, r.text.slice(0, 120));
  check('choice-попытка: is_correct — boolean', choiceResult?.is_correct, (v) => typeof v === 'boolean');

  r = await req('POST', 'rpc/submit_practice_attempt', {
    body: { p_key: testKey, p_task_id: choiceTask?.id ?? 0, p_answer: { choice: 99 } },
  });
  check('неверный choice отклоняется', r.status, (s) => s >= 400 && s < 500);

  const openAnswer = 'В этом ответе достаточно символов, чтобы пройти проверку длины открытого ответа.';
  r = await req('POST', 'rpc/submit_practice_attempt', {
    body: { p_key: testKey, p_task_id: openTask?.id ?? 0, p_answer: { text: 'коротко' }, p_self_score: 1 },
  });
  check('слишком короткий open-ответ отклоняется', r.status, (s) => s >= 400 && s < 500);

  const openMax = (openTask?.criteria?.length ?? 0) * 2;
  r = await req('POST', 'rpc/submit_practice_attempt', {
    body: {
      p_key: testKey,
      p_task_id: openTask?.id ?? 0,
      p_answer: { text: openAnswer },
      p_self_score: 2,
      p_duration_ms: 60000,
    },
  });
  const openResult = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
  check('валидный open с self_score принят', r.status, (s) => s === 200, r.text.slice(0, 120));
  check('open: max_score = criteria*2', openResult?.max_score, (v) => v === openMax);

  r = await req('POST', 'rpc/submit_practice_attempt', {
    body: { p_key: testKey, p_task_id: openTask?.id ?? 0, p_answer: { text: openAnswer }, p_self_score: openMax + 1 },
  });
  check('self_score вне диапазона отклоняется', r.status, (s) => s >= 400 && s < 500);

  r = await req('POST', 'rpc/practice_progress', { body: { p_key: testKey } });
  const practiceProgress = (() => { try { return JSON.parse(r.text); } catch { return null; } })();
  check('practice_progress возвращает прогресс', r.status, (s) => s === 200);
  check('practice_progress: есть задача с попытками', Array.isArray(practiceProgress) && practiceProgress.length >= 1, (b) => b === true);

  r = await req('GET', `practice_attempts?select=id&user_key=eq.${testKey}&task_id=eq.${choiceTask?.id ?? 0}`, { key: service });
  const savedPracticeAttempts = (() => { try { return JSON.parse(r.text)?.length; } catch { return -1; } })();
  check('попытка легла в practice_attempts (service_role)', savedPracticeAttempts, (n) => n === 1);

  // Чистка тестовых строк
  await req('DELETE', `session_essays?user_key=eq.${testKey}`, { key: service });
  await req('DELETE', `quiz_results?user_key=eq.${testKey}`, { key: service });
  await req('DELETE', `practice_attempts?user_key=eq.${testKey}`, { key: service });
  await req('DELETE', 'practice_tasks?discipline_id=eq.general-psych&slug=eq.perm-test-task', { key: service });
  await req('DELETE', `users_profiles?user_key=eq.${testKey}`, { key: service });
} catch (e) {
  console.error('Ошибка проверки:', e);
  process.exitCode = 1;
}

console.table(results.map((r) => ({ test: r.name, status: r.actual, ok: r.ok ? 'PASS' : 'FAIL' })));
if (results.some((r) => !r.ok)) process.exitCode = 1;
