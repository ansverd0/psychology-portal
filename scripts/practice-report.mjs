// Отчёт по «Практикуму»: задачи, попытки, самопроверка. Только чтение.
// Запуск:
//   node scripts/practice-report.mjs
//   node scripts/practice-report.mjs --json
// Секреты — из .env; SUPABASE_SERVICE_ROLE не печатается.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');

const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const url = env.SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE;
if (!url || !service) {
  console.error('В .env нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

const LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

async function rest(endpoint) {
  const res = await fetch(`${url}/rest/v1/${endpoint}`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function restAll(endpoint) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const glue = endpoint.includes('?') ? '&' : '?';
    const page = await rest(`${endpoint}${glue}limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error('REST вернул не массив');
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

try {
  const tasks = await restAll('practice_tasks?select=id,slug,level,kind,active,sort_order&order=sort_order');
  const attempts = await restAll(
    'practice_attempts?select=id,user_key,task_id,self_score,max_score,is_correct,created_at&order=created_at.desc',
  );

  const levelById = new Map(tasks.map((t) => [t.id, t.level]));
  const slugById = new Map(tasks.map((t) => [t.id, t.slug]));

  const tasksByLevel = {};
  tasks.forEach((t) => inc(tasksByLevel, t.level));

  const attemptsByLevel = {};
  const users = new Set();
  const open = [];
  attempts.forEach((a) => {
    users.add(a.user_key);
    const level = levelById.get(a.task_id) || 'unknown';
    inc(attemptsByLevel, level);
    if (a.self_score != null && a.max_score != null && a.max_score > 0) {
      open.push({ self: a.self_score, max: a.max_score });
    }
  });

  const openAvg = open.length
    ? {
        count: open.length,
        avg_self_score: round(open.reduce((s, x) => s + x.self, 0) / open.length),
        avg_max_score: round(open.reduce((s, x) => s + x.max, 0) / open.length),
        avg_ratio: round(open.reduce((s, x) => s + x.self / x.max, 0) / open.length, 3),
      }
    : { count: 0, avg_self_score: null, avg_max_score: null, avg_ratio: null };

  const recent = attempts.slice(0, 5).map((a) => ({
    task_id: a.task_id,
    slug: slugById.get(a.task_id) || null,
    level: levelById.get(a.task_id) || null,
    is_correct: a.is_correct,
    self_score: a.self_score,
    max_score: a.max_score,
    created_at: a.created_at,
  }));

  const report = {
    tasks: {
      total: tasks.length,
      active: tasks.filter((t) => t.active).length,
      by_level: tasksByLevel,
    },
    attempts: {
      total: attempts.length,
      unique_users: users.size,
      by_level: attemptsByLevel,
    },
    open_scores: openAvg,
    users_with_attempts: users.size,
    recent,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const levelsLine = LEVELS
      .filter((level) => tasksByLevel[level] || attemptsByLevel[level])
      .map((level) => `${level}: ${tasksByLevel[level] || 0}`)
      .join(', ') || 'нет';

    console.log(`Практикум — отчёт от ${new Date().toISOString()}`);
    console.log('');
    console.log(`Задачи: ${report.tasks.total} (активных ${report.tasks.active})`);
    console.log(`  по уровням: ${levelsLine}`);
    console.log('');
    console.log(`Попытки: ${report.attempts.total}, уникальных пользователей: ${report.attempts.unique_users}`);
    const attemptsLevels = LEVELS
      .filter((level) => attemptsByLevel[level])
      .map((level) => `${level}: ${attemptsByLevel[level]}`)
      .join(', ') || 'нет';
    console.log(`  по уровням: ${attemptsLevels}`);
    console.log('');
    console.log(
      `Open-попытки: ${openAvg.count}, средний self_score: ${openAvg.avg_self_score ?? '—'}, `
      + `средний max_score: ${openAvg.avg_max_score ?? '—'}, средняя доля: ${openAvg.avg_ratio ?? '—'}`,
    );
    console.log(`Пользователей с хотя бы одной попыткой: ${report.users_with_attempts}`);
    console.log('');
    console.log('Последние 5 попыток:');
    if (!recent.length) {
      console.log('  нет');
    } else {
      recent.forEach((a) => {
        const result = a.self_score != null ? `${a.self_score}/${a.max_score}` : (a.is_correct ? 'верно' : 'неверно');
        console.log(`  ${a.created_at}  ${a.level || '—'}  ${a.slug || a.task_id}  ${result}`);
      });
    }
  }
} catch (e) {
  console.error('Отчёт упал:', e.message);
  process.exit(1);
}
