// Выгрузка исследования: одна строка на студента + сырые события + словарь.
//
//   node scripts/export-research.mjs                     — окно сбора, файлы в exports/
//   node scripts/export-research.mjs --from 2026-11-01   — пре-окно (пилот)
//   node scripts/export-research.mjs --no-write          — только сводка, без файлов
//   node scripts/export-research.mjs --include-test      — вместе с тестовыми ключами
//
// Источник — Management API Supabase (SUPABASE_PAT), как survey-report.mjs.
// Формулы — scripts/metrics.mjs; определения — docs/TECHSPEC-FOOTPRINT.md §6–7.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  TZ,
  dedupeEvents,
  buildUserRow,
  studyTimeMs,
  practiceStats,
  surveyFunnel,
  metaOf,
} from './metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const FROM = argValue('--from', DEFAULTS.windowFrom);
const WINDOW_END = argValue('--window-end', DEFAULTS.windowEnd);
const INCLUDE_TEST = args.includes('--include-test');
const NO_WRITE = args.includes('--no-write');
const AS_JSON = args.includes('--json');
const OUT_ARG = argValue('--out', null);

if (!isDate(FROM) || !isDate(WINDOW_END)) {
  console.error('Даты должны быть в формате ГГГГ-ММ-ДД: --from 2026-11-17 --window-end 2027-01-29');
  process.exit(1);
}

const FROM_ISO = `${FROM}T00:00:00+03:00`;
const END_EXCLUSIVE = new Date(new Date(`${WINDOW_END}T00:00:00+03:00`).getTime() + 24 * 3600 * 1000).toISOString();

// ---------- доступ к базе ----------

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

async function query(sql) {
  const env = loadEnv();
  if (!env.SUPABASE_PAT || !env.SUPABASE_PROJECT_REF) {
    throw new Error('В .env нужны SUPABASE_PAT и SUPABASE_PROJECT_REF');
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_PAT}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return json;
}

/** Пагинация через json_agg: Management API не отдаёт больше одного результата */
async function pullAll(table, columns, { where = '', order = '1', pageSize = 2000 } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const sql = `select coalesce(json_agg(t), '[]'::json) as data
      from (select ${columns} from public.${table} ${where} order by ${order} limit ${pageSize} offset ${offset}) t`;
    const res = await query(sql);
    const chunk = Array.isArray(res?.[0]?.data) ? res[0].data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

// ---------- сбор данных ----------

const profiles = await pullAll('users_profiles',
  'user_key, group_code, course, is_test, survey_done, created_at', { order: 'user_key' });

const rawEvents = await pullAll('events',
  'id, user_key, session_id, page, event, ts, dwell_ms, scroll_pct, meta, event_id',
  { where: `where ts >= '${FROM_ISO}' and ts < '${END_EXCLUSIVE}'`, order: 'ts, id' });

const responses = await pullAll('instrument_responses',
  'user_key, instrument, scales, duration_ms, finished_at', { order: 'user_key, instrument' });

const quiz = await pullAll('quiz_results',
  'id, user_key, discipline_id, percentage, created_at', { order: 'id' });

const attempts = await pullAll('practice_attempts',
  'id, user_key, task_id, self_score, max_score, is_correct, duration_ms, created_at', { order: 'id' });

const tasks = await pullAll('practice_tasks',
  'id, discipline_id, level, kind', { order: 'id' });

const deadlines = await pullAll('deadlines',
  'id, group_code, course, discipline_id, kind, due_at', { order: 'id' });

const essays = await pullAll('session_essays',
  'id, user_key, motive_text, emotion_text, evaluation_text, regulation_text, codes, word_count, created_at',
  { order: 'id' });

// ---------- очистка ----------

const events = dedupeEvents(rawEvents);
const testKeys = new Set(profiles.filter((p) => p.is_test).map((p) => p.user_key));
const keep = (key) => INCLUDE_TEST || !testKeys.has(key);

const profilesClean = profiles.filter((p) => keep(p.user_key));
const eventsClean = events.filter((e) => keep(e.user_key));

const byUser = new Map();
for (const e of eventsClean) {
  if (!byUser.has(e.user_key)) byUser.set(e.user_key, []);
  byUser.get(e.user_key).push(e);
}
const responsesByUser = new Map();
for (const r of responses) {
  if (!keep(r.user_key)) continue;
  if (!responsesByUser.has(r.user_key)) responsesByUser.set(r.user_key, []);
  responsesByUser.get(r.user_key).push(r);
}
const attemptsByUser = new Map();
for (const a of attempts) {
  if (!keep(a.user_key)) continue;
  if (!attemptsByUser.has(a.user_key)) attemptsByUser.set(a.user_key, []);
  attemptsByUser.get(a.user_key).push(a);
}
const quizByUser = new Map();
for (const q of quiz) {
  if (!keep(q.user_key)) continue;
  if (!quizByUser.has(q.user_key)) quizByUser.set(q.user_key, []);
  quizByUser.get(q.user_key).push(q);
}
const essayByUser = new Map(essays.filter((e) => keep(e.user_key)).map((e) => [e.user_key, e]));

const SHAM_SCALES = ['cognitive', 'achievement', 'selfdev', 'selfrespect', 'introjected', 'external', 'amotivation'];
const SSPM_SCALES = ['planning', 'modeling', 'programming', 'results', 'flexibility', 'autonomy', 'overall'];

function scalesOf(key) {
  const rows = responsesByUser.get(key) || [];
  const sham = rows.find((r) => r.instrument === 'sham')?.scales || {};
  const sspm = rows.find((r) => r.instrument === 'sspm')?.scales || {};
  const out = {};
  for (const s of SHAM_SCALES) out[`sham_${s}`] = sham[s] ?? '';
  for (const s of SSPM_SCALES) out[`sspm_${s}`] = sspm[s] ?? '';
  return out;
}

function surveyDate(key) {
  const rows = (responsesByUser.get(key) || []).filter((r) => r.finished_at);
  if (!rows.length) return '';
  return rows.map((r) => r.finished_at).sort()[0];
}

const users = [];
for (const profile of profilesClean) {
  const key = profile.user_key;
  const userEvents = byUser.get(key) || [];
  const userResponses = responsesByUser.get(key) || [];
  const hasPair = new Set(userResponses.map((r) => r.instrument)).size === 2;
  const hasPractice = (attemptsByUser.get(key) || []).length > 0;
  // Пустые профили (ключ создан, но ничего не сделано) в выгрузку не идут
  if (!hasPair && !userEvents.length && !hasPractice) continue;

  const base = buildUserRow({
    profile,
    events: userEvents,
    deadlineRows: deadlines,
    windowEnd: `${WINDOW_END}T23:59:59+03:00`,
    opts: { studyPages: DEFAULTS.studyPages, segmentCapMs: DEFAULTS.segmentCapMs, depthSec: DEFAULTS.depthSec },
  });
  const pr = practiceStats(userEvents, attemptsByUser.get(key) || [], tasks);
  const practiceMs = studyTimeMs(userEvents.filter((e) => e.page === 'practice'));
  const quizRows = quizByUser.get(key) || [];
  const essay = essayByUser.get(key) || null;
  const scales = scalesOf(key);

  users.push({
    user_key: key,
    course: base.course,
    group_code: base.group_code,
    is_test: profile.is_test ? 1 : 0,
    survey_date: surveyDate(key),
    essay_date: essay?.created_at || '',
    ...scales,
    ...base,
    tests_completed: quizRows.length,
    tests_avg_pct: quizRows.length
      ? Number((quizRows.reduce((s, q) => s + Number(q.percentage || 0), 0) / quizRows.length).toFixed(1))
      : '',
    practice_attempts: (attemptsByUser.get(key) || []).length,
    practice_level_mix: Object.entries(pr.level_mix).map(([k, v]) => `${k}:${v}`).join('|'),
    self_score_avg: pr.self_score_avg ?? '',
    higher_order_share: base.total_time_min > 0
      ? Number((practiceMs / 60000 / base.total_time_min).toFixed(4))
      : 0,
    return_after_low_score: pr.return_after_low_score,
    essay_word_count: essay?.word_count ?? '',
    essay_codes: essay?.codes ? JSON.stringify(essay.codes) : '',
  });
}

users.sort((a, b) => String(a.user_key).localeCompare(String(b.user_key)));

// ---------- качество ----------

function quality() {
  const rawClean = rawEvents.filter((e) => keep(e.user_key));
  const leaves = eventsClean.filter((e) => e.event === 'page_leave');
  const segmentsOverCap = leaves.filter((e) => Number(e.dwell_ms) > DEFAULTS.segmentCapMs).length;
  const leavesUnder1s = leaves.filter((e) => Number(e.dwell_ms) < 1000).length;
  const usersNoStudy = users.filter((u) => !u.total_time_min).length;
  const coverage = users.filter((u) => u.window_days >= 14 && u.sessions_count >= 1).length;
  const withId = rawClean.filter((e) => e.event_id).length;
  return {
    events_raw: rawClean.length,
    events_dedup: eventsClean.length,
    duplicates_removed: rawClean.length - eventsClean.length,
    test_events_excluded: rawEvents.length - rawClean.length,
    event_id_share: rawClean.length ? Number((withId / rawClean.length).toFixed(3)) : null,
    segments_over_cap: segmentsOverCap,
    leaves_under_1s: leavesUnder1s,
    users_total: profilesClean.length,
    users_test_excluded: INCLUDE_TEST ? 0 : testKeys.size,
    users_in_export: users.length,
    users_without_study_time: usersNoStudy,
    users_14d_and_session: coverage,
  };
}

const funnel = surveyFunnel(eventsClean);
const funnelRows = [
  ['survey_open', funnel.survey_open],
  ['survey_group', funnel.survey_group],
  ['instrument_started', funnel.instrument_started],
  ['instrument_done', funnel.instrument_done],
  ['survey_finished', funnel.survey_finished],
];

const stats = quality();
const meta = {
  generated_at: new Date().toISOString(),
  window: { from: FROM, to: WINDOW_END, tz: TZ },
  rules: {
    session_gap_min: DEFAULTS.sessionGapMs / 60000,
    segment_cap_min: DEFAULTS.segmentCapMs / 60000,
    depth_sec: DEFAULTS.depthSec,
    study_pages: DEFAULTS.studyPages,
    test_excluded: !INCLUDE_TEST,
  },
  quality: stats,
  funnel: Object.fromEntries(funnelRows),
};

// ---------- запись ----------

const USERS_COLUMNS = [
  'user_key', 'course', 'group_code', 'is_test', 'survey_date', 'essay_date',
  ...SHAM_SCALES.map((s) => `sham_${s}`), ...SSPM_SCALES.map((s) => `sspm_${s}`),
  'total_time_min', 'time_all_min', 'sessions_count', 'avg_session_min', 'active_days',
  'window_days', 'regularity', 'tab_switch_index', 'tests_completed', 'tests_avg_pct',
  'articles_count', 'theory_depth', 'scroll_avg', 'scroll_avg_page',
  'deadline_share', 'prep_start_days', 'prep_start_days_5min',
  'practice_attempts', 'practice_level_mix', 'self_score_avg', 'higher_order_share',
  'return_after_low_score', 'essay_word_count', 'essay_codes',
];

function csvLine(values) {
  return values.map((v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
}

function toCsv(rows, columns) {
  return '\uFEFF' + [columns.join(','), ...rows.map((r) => csvLine(columns.map((c) => r[c])))].join('\r\n') + '\r\n';
}

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = OUT_ARG ? path.resolve(OUT_ARG) : path.join(ROOT, 'exports', stamp);

if (AS_JSON) {
  console.log(JSON.stringify({ meta, users: users.length }, null, 1));
} else {
  console.log(`Окно: ${FROM} — ${WINDOW_END} (Europe/Moscow)`);
  console.log(`Событий: ${stats.events_raw} → после дедупа ${stats.events_dedup} (убрано ${stats.duplicates_removed})`);
  console.log(`Студентов в выгрузке: ${users.length}` + (stats.users_test_excluded ? `, тестовых исключено: ${stats.users_test_excluded}` : ''));
  console.log(`Воронка опроса: ${funnelRows.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`Качество: событий с event_id ${stats.event_id_share ?? '—'}, сегментов > 30 мин ${stats.segments_over_cap}, < 1 с ${stats.leaves_under_1s}, без учебного времени ${stats.users_without_study_time}`);
}

if (!NO_WRITE) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'users.csv'), toCsv(users, USERS_COLUMNS), 'utf8');
  fs.writeFileSync(path.join(outDir, 'events.csv'), toCsv(
    eventsClean.map((e) => ({ ...e, meta_json: JSON.stringify(metaOf(e)) })),
    ['user_key', 'session_id', 'page', 'event', 'ts', 'dwell_ms', 'scroll_pct', 'event_id', 'meta_json']
  ), 'utf8');
  fs.writeFileSync(path.join(outDir, 'essays.csv'), toCsv(
    essays.filter((e) => keep(e.user_key)).map((e) => ({ ...e, codes_json: e.codes ? JSON.stringify(e.codes) : '' })),
    ['user_key', 'motive_text', 'emotion_text', 'evaluation_text', 'regulation_text', 'codes_json', 'word_count', 'created_at']
  ), 'utf8');
  fs.writeFileSync(path.join(outDir, 'practice.csv'), toCsv(
    attempts.filter((a) => keep(a.user_key)),
    ['user_key', 'task_id', 'self_score', 'max_score', 'is_correct', 'duration_ms', 'created_at']
  ), 'utf8');
  fs.writeFileSync(path.join(outDir, 'funnel.csv'), toCsv(
    funnelRows.map(([milestone, count]) => ({ milestone, users: count, events: eventsClean.filter((e) => e.event === milestone).length })),
    ['milestone', 'users', 'events']
  ), 'utf8');
  fs.writeFileSync(path.join(outDir, 'dictionary.md'), dictionary(USERS_COLUMNS), 'utf8');
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1), 'utf8');
  console.log(`Файлы: ${outDir}`);
}

function dictionary(columns) {
  const docs = {
    user_key: 'анонимный ключ (псевдоним)',
    course: 'курс из профиля',
    group_code: 'учебная группа',
    is_test: '1 — тестовый ключ (в анализ не идёт)',
    survey_date: 'дата первого завершённого опросника',
    essay_date: 'дата эссе',
    total_time_min: 'Σ видимого времени на учебных страницах, сегмент ≤ 30 мин',
    time_all_min: 'то же по всем страницам (диагностика)',
    sessions_count: 'сессии: разрыв между событиями > 30 мин',
    avg_session_min: 'среднее учебное время на сессию',
    active_days: 'календарные дни (МСК) с событиями',
    window_days: 'дни от первого события до конца окна включительно',
    regularity: 'active_days / window_days, 0…1',
    tab_switch_index: 'переключения вкладки на 10 мин учебного времени',
    tests_completed: 'число завершённых тестов (quiz_results)',
    tests_avg_pct: 'средний процент по тестам',
    articles_count: 'статей с записанным сегментом',
    theory_depth: 'статей, где Σ видимого времени ≥ 60 с',
    scroll_avg: 'средняя максимальная прокрутка статьи, %',
    scroll_avg_page: 'средняя прокрутка учебной страницы (фолбэк)',
    deadline_share: 'доля учебного времени в 3 дня до ближайшего дедлайна',
    prep_start_days: 'дней от первого содержательного события по дисциплине до дедлайна',
    prep_start_days_5min: 'то же, но первая сессия с ≥ 5 мин учёбы (приближение)',
    practice_attempts: 'попыток практикума',
    practice_level_mix: 'уровни Блума попыток: apply:2|analyze:1',
    self_score_avg: 'средняя самооценка open-задач (0…1)',
    higher_order_share: 'доля учебного времени на практикуме',
    return_after_low_score: 'возвратов к задаче после самооценки < 0.5 (30 мин)',
    essay_word_count: 'слов в эссе',
    essay_codes: 'коды контент-анализа (JSON)',
  };
  const lines = [
    '# Словарь выгрузки',
    '',
    `Сгенерировано: ${new Date().toISOString()}`,
    `Окно: ${FROM} — ${WINDOW_END} (Europe/Moscow)`,
    '',
    'Правила: дедуп по `event_id` (старые строки — по отпечатку), учебные страницы',
    `${DEFAULTS.studyPages.join(', ')}; сегмент ≤ 30 мин; сессия — разрыв > 30 мин.`,
    '',
    '| Колонка | Что это |',
    '|---|---|',
    ...columns.map((c) => `| \`${c}\` | ${docs[c] || '—'} |`),
    '',
  ];
  return lines.join('\n');
}
