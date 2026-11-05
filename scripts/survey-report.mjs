// Отчёт по опросу: шкалы ШАМ и ССПМ, метки качества протоколов.
//
//   node scripts/survey-report.mjs             — отчёт по живой базе
//   node scripts/survey-report.mjs --json      — то же машинным выводом
//   node scripts/survey-report.mjs --selftest  — проверка правил на фикстуре
//
// Отбраковка протоколов: в среднем меньше 2 секунд на пункт — «скоростной»,
// такой протокол помечается и в статистику не идёт (правило в docs/METHOD-FREEZE.md).
// Ограничение в БД (5 с) — санитарное, отбраковкой не является.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ITEMS = { sham: 28, sspm: 46 };
const SHAM_SCALES = ['cognitive', 'achievement', 'selfdev', 'selfrespect', 'introjected', 'external', 'amotivation'];
const SSPM_SCALES = ['planning', 'modeling', 'programming', 'results', 'flexibility', 'autonomy'];
// Пороги первоисточника (Моросанова, 1998): [низкий < X, средний A..B, высокий > Y].
// Значения в «щелях» (3, 7 для шкал 0–9; 4, 8 для шкал 0–9 с другим порогом;
// 23 для общего уровня) в первоисточнике не определены — так и помечаем.
const SSPM_LEVELS = {
  planning: [3, 4, 6, 7],
  modeling: [3, 4, 6, 7],
  programming: [4, 5, 7, 8],
  results: [3, 4, 6, 7],
  flexibility: [4, 5, 7, 8],
  overall: [23, 24, 32, 32]
};
const FAST_SEC_PER_ITEM = 2;

// ---------- чистые функции (их же проверяет --selftest) ----------

export function answersOf(resp) {
  const n = ITEMS[resp.instrument];
  const src = resp.answers || {};
  const out = [];
  for (let i = 1; i <= n; i++) out.push(Number(src[String(i)]));
  return out;
}

/** Среднее время на пункт в секундах; null, если время не передали */
export function secondsPerItem(resp) {
  const n = ITEMS[resp.instrument];
  if (!n || !resp.duration_ms) return null;
  return resp.duration_ms / 1000 / n;
}

/** Метка качества протокола */
export function flagOf(resp) {
  const perItem = secondsPerItem(resp);
  if (perItem == null) return 'нет времени';
  return perItem < FAST_SEC_PER_ITEM ? 'скоростной' : 'ок';
}

/** Сумма шкалы: ШАМ — сумма значений пунктов, ССПМ — число «да» по ключу */
export function scoreOf(keys, instrument, scale, answers) {
  const items = keys.filter((k) => k.instrument === instrument && k.scale === scale);
  return items.reduce((sum, k) => {
    const value = answers[k.item_no - 1];
    if (instrument === 'sham') return sum + value;
    const yes = k.sign === 1 ? value <= 2 : value > 2;
    return sum + (yes ? 1 : 0);
  }, 0);
}

/** Уровень по порогам первоисточника; 'щель' — значение вне всех диапазонов */
export function levelOf(value, thresholds) {
  const [lowBelow, midLo, midHi, highAbove] = thresholds;
  if (value < lowBelow) return 'низкий';
  if (value >= midLo && value <= midHi) return 'средний';
  if (value > highAbove) return 'высокий';
  return 'щель';
}

/** Альфа Кронбаха по строкам ответов */
export function alpha(rows) {
  if (rows.length < 2) return null;
  const k = rows[0].length;
  if (k < 2) return null;
  const variance = (xs) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  };
  const itemVar = k === 0 ? 0 : Array.from({ length: k }, (_, i) => variance(rows.map((r) => r[i]))).reduce((a, b) => a + b, 0);
  const totalVar = variance(rows.map((r) => r.reduce((a, b) => a + b, 0)));
  if (!totalVar) return null;
  return (k / (k - 1)) * (1 - itemVar / totalVar);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const round = (v, d = 2) => (v == null ? null : Number(v.toFixed(d)));

/** Полный расчёт по выгрузке: { profiles, responses, keys } */
export function buildReport(data) {
  const responses = data.responses || [];
  const keys = data.keys || [];
  const profiles = data.profiles || [];
  const byKey = new Map();
  for (const r of responses) {
    if (!byKey.has(r.user_key)) byKey.set(r.user_key, []);
    byKey.get(r.user_key).push(r);
  }
  const pairs = [...byKey.entries()].filter(([, list]) => new Set(list.map((r) => r.instrument)).size === 2);
  const excluded = responses.filter((r) => flagOf(r) !== 'ок');
  const excludedKeys = new Set(excluded.map((r) => r.user_key));
  const clean = responses.filter((r) => !excludedKeys.has(r.user_key));

  const sham = clean.filter((r) => r.instrument === 'sham').map(answersOf);
  const sspm = clean.filter((r) => r.instrument === 'sspm').map(answersOf);

  const shamScales = SHAM_SCALES.map((scale) => {
    const values = sham.map((a) => scoreOf(keys, 'sham', scale, a));
    return { scale, n: values.length, mean: round(mean(values)), sd: round(sd(values)), values };
  });

  const sspmScales = SSPM_SCALES.concat('overall').map((scale) => {
    const values = sspm.map((a) => scoreOf(keys, 'sspm', scale, a));
    const thresholds = SSPM_LEVELS[scale];
    return {
      scale,
      n: values.length,
      mean: round(mean(values)),
      sd: round(sd(values)),
      values,
      levels: thresholds ? values.map((v) => levelOf(v, thresholds)) : null
    };
  });

  // Дрейф по блокам: средний ответ по десяткам пунктов внутри методики
  const blocks = (rows) => {
    if (!rows.length) return [];
    const size = ITEMS[rows[0].length === 28 ? 'sham' : 'sspm'];
    const out = [];
    for (let from = 0; from < rows[0].length; from += 10) {
      const slice = rows.map((r) => r.slice(from, Math.min(from + 10, r.length)));
      out.push({ from: from + 1, to: Math.min(from + 10, rows[0].length), mean: round(mean(slice.flat ? slice.flat() : [].concat(...slice))) });
    }
    return out;
  };

  // Альфа считается по ключу, а не по сырым ответам: у обратных пунктов полярность
  // перевёрнута, и без ключа согласованность занижается до бессмысленной
  const sspmOverall = keys.filter((k) => k.instrument === 'sspm' && k.scale === 'overall');
  const sspmBinary = sspm.map((a) => sspmOverall.map((k) => {
    const value = a[k.item_no - 1];
    return (k.sign === 1 ? value <= 2 : value > 2) ? 1 : 0;
  }));

  return {
    profiles: profiles.length,
    responses: responses.length,
    pairs: pairs.length,
    groups: [...new Set(pairs.map(([k]) => (profiles.find((p) => p.user_key === k) || {}).group_code))],
    excluded: excluded.map((r) => ({ user_key: r.user_key, instrument: r.instrument, per_item: round(secondsPerItem(r)) })),
    sham: shamScales,
    sspm: sspmScales,
    alpha: { sham: round(alpha(sham)), sspm: round(alpha(sspmBinary)) },
    drift: { sham: blocks(sham), sspm: blocks(sspm) }
  };
}

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
    body: JSON.stringify({ query: sql })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Ответ не JSON: ' + text.slice(0, 200));
  }
}

async function pull() {
  const profiles = await query(`select user_key, group_code, course, survey_done, created_at
    from public.users_profiles order by created_at`);
  const responses = await query(`select user_key, instrument, answers, duration_ms, finished_at
    from public.instrument_responses order by finished_at`);
  const keys = await query(`select instrument, scale, item_no, sign from public.instrument_keys
    order by instrument, scale, item_no`);
  return { profiles, responses, keys };
}

// ---------- вывод ----------

function printReport(report) {
  const lines = [];
  const num = (v) => (v == null ? '—' : String(v).replace('.', ','));

  lines.push('=== ОБЪЁМ ===');
  lines.push(`профилей ${report.profiles}, ответов ${report.responses}, полных пар ${report.pairs}`);
  lines.push(`группы: ${report.groups.join(', ') || '—'}`);
  if (report.excluded.length) {
    lines.push('исключены как скоростные:');
    for (const e of report.excluded) {
      lines.push(`  ${e.user_key} / ${e.instrument}: ${num(e.per_item)} с на пункт`);
    }
  } else {
    lines.push('скоростных протоколов нет');
  }

  lines.push('');
  lines.push('=== ШАМ (4–20 по шкале) ===');
  for (const s of report.sham) lines.push(`  ${s.scale.padEnd(14)} ${num(s.mean)}  (σ ${num(s.sd)}, n=${s.n})`);

  lines.push('');
  lines.push('=== ССПМ (0–9, общий 0–46) ===');
  for (const s of report.sspm) {
    const levels = s.levels ? `  уровни: ${s.levels.join(', ')}` : '';
    lines.push(`  ${s.scale.padEnd(14)} ${num(s.mean)}  (σ ${num(s.sd)}, n=${s.n})${levels}`);
  }

  lines.push('');
  lines.push(`альфа Кронбаха: ШАМ ${num(report.alpha.sham)}, ССПМ ${num(report.alpha.sspm)}`);
  lines.push('');
  lines.push('=== СРЕДНИЙ ОТВЕТ ПО БЛОКАМ (дрейф внутри методики) ===');
  for (const [name, rows] of Object.entries(report.drift)) {
    if (!rows.length) continue;
    lines.push(`  ${name}: ` + rows.map((b) => `${b.from}–${b.to}: ${num(b.mean)}`).join('  '));
  }
  console.log(lines.join('\n'));
}

// ---------- самопроверка ----------

function selftest() {
  const checks = [];
  const ok = (cond, label, detail) => checks.push({ pass: Boolean(cond), label, detail });

  const fast = { instrument: 'sham', duration_ms: 24900, answers: {} };
  const slow = { instrument: 'sspm', duration_ms: 385000, answers: {} };
  ok(round(secondsPerItem(fast)) === 0.89, 'время на пункт у скоростного протокола', secondsPerItem(fast));
  ok(flagOf(fast) === 'скоростной', 'скоростной протокол помечается', flagOf(fast));
  ok(flagOf(slow) === 'ок', 'нормальный протокол не помечается', flagOf(slow));
  ok(flagOf({ instrument: 'sham', duration_ms: null }) === 'нет времени', 'без времени — отдельная метка');

  const keys = [
    { instrument: 'sham', scale: 'cognitive', item_no: 1, sign: 1 },
    { instrument: 'sham', scale: 'cognitive', item_no: 2, sign: 1 },
    { instrument: 'sspm', scale: 'planning', item_no: 1, sign: 1 },
    { instrument: 'sspm', scale: 'planning', item_no: 2, sign: -1 }
  ];
  ok(scoreOf(keys, 'sham', 'cognitive', [4, 5]) === 9, 'ШАМ: сумма пунктов', scoreOf(keys, 'sham', 'cognitive', [4, 5]));
  ok(scoreOf(keys, 'sspm', 'planning', [1, 3]) === 2, 'ССПМ: «да» по прямому и обратному пункту', scoreOf(keys, 'sspm', 'planning', [1, 3]));
  ok(scoreOf(keys, 'sspm', 'planning', [4, 1]) === 0, 'ССПМ: оба ответа мимо ключа', scoreOf(keys, 'sspm', 'planning', [4, 1]));

  ok(levelOf(2, SSPM_LEVELS.planning) === 'низкий', 'уровень: 2 — низкий');
  ok(levelOf(3, SSPM_LEVELS.planning) === 'щель', 'уровень: 3 — щель (в первоисточнике не определён)');
  ok(levelOf(6, SSPM_LEVELS.planning) === 'средний', 'уровень: 6 — средний');
  ok(levelOf(7, SSPM_LEVELS.planning) === 'щель', 'уровень: 7 — щель');
  ok(levelOf(8, SSPM_LEVELS.planning) === 'высокий', 'уровень: 8 — высокий');
  ok(levelOf(23, SSPM_LEVELS.overall) === 'щель', 'общий уровень 23 — щель');
  ok(levelOf(33, SSPM_LEVELS.overall) === 'высокий', 'общий уровень 33 — высокий');
  ok(levelOf(4, SSPM_LEVELS.programming) === 'щель', 'программирование: 4 — щель');

  const rows = [[4, 4], [4, 4], [4, 4]];
  ok(alpha(rows) === null, 'альфа на постоянных ответах не считается (делим на ноль)');

  const fixtureAnswers = (n, first) => {
    const a = {};
    for (let i = 1; i <= n; i++) a[String(i)] = 3;
    a['1'] = first;
    a['2'] = first;
    return a;
  };
  const fixture = {
    profiles: [{ user_key: 'a', group_code: '842' }, { user_key: 'b', group_code: '842' }],
    keys,
    responses: [
      { user_key: 'a', instrument: 'sham', answers: fixtureAnswers(28, 4), duration_ms: 120000 },
      { user_key: 'b', instrument: 'sham', answers: fixtureAnswers(28, 1), duration_ms: 20000 }
    ]
  };
  const rep = buildReport(fixture);
  ok(rep.excluded.length === 1 && rep.excluded[0].user_key === 'b', 'скоростной протокол исключён из шкал', rep.excluded);
  const clean = rep.sham.find((s) => s.scale === 'cognitive');
  ok(clean && clean.n === 1 && clean.values[0] === 8, 'в шкалах остался только чистый протокол', clean);

  // Альфа по ключу: два пункта с противоположным знаком, ответы согласованы —
  // по сырым ответам корреляция была бы отрицательной
  const paired = {
    profiles: [],
    keys: [
      { instrument: 'sspm', scale: 'overall', item_no: 1, sign: 1 },
      { instrument: 'sspm', scale: 'overall', item_no: 2, sign: -1 }
    ],
    responses: [
      { user_key: 'a', instrument: 'sspm', answers: { 1: 1, 2: 4 }, duration_ms: 400000 },
      { user_key: 'b', instrument: 'sspm', answers: { 1: 2, 2: 3 }, duration_ms: 400000 },
      { user_key: 'c', instrument: 'sspm', answers: { 1: 3, 2: 2 }, duration_ms: 400000 },
      { user_key: 'd', instrument: 'sspm', answers: { 1: 4, 2: 1 }, duration_ms: 400000 }
    ]
  };
  ok(buildReport(paired).alpha.sspm === 1, 'альфа ССПМ считается по ключу (обратные пункты учтены)',
    buildReport(paired).alpha.sspm);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) {
    console.log(`${c.pass ? '✔' : '✘'} ${c.label}${c.pass ? '' : ' — ' + JSON.stringify(c.detail)}`);
  }
  console.log(`\nИтог: ${checks.length - failed.length}/${checks.length}`);
  return failed.length === 0;
}

// ---------- запуск ----------

const args = process.argv.slice(2);
if (args.includes('--selftest')) {
  process.exit(selftest() ? 0 : 1);
}

const data = await pull();
const report = buildReport(data);
if (args.includes('--json')) console.log(JSON.stringify(report, null, 1));
else printReport(report);
