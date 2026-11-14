// Формулы цифрового следа: одна реализация для отчёта и выгрузки.
//
//   node scripts/metrics.mjs --selftest   — проверки на фикстурах, без сети
//
// Определения — docs/METHOD-FREEZE.md §5 и docs/TECHSPEC-FOOTPRINT.md §6.
// Всё считается по событиям после дедупликации, время — Europe/Moscow.

export const TZ = 'Europe/Moscow';

export const DEFAULTS = {
  sessionGapMs: 30 * 60 * 1000,
  segmentCapMs: 30 * 60 * 1000,
  depthSec: 60,
  studyPages: ['tickets', 'sections', 'tests', 'cards', 'practice'],
  windowFrom: '2026-11-17',
  windowEnd: '2027-01-29',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CONTENT_EVENTS = new Set(['article_open', 'ticket_open', 'test_complete', 'task_open']);

const dateFormatters = new Map();
function localDate(ts, tz = TZ) {
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  if (!dateFormatters.has(tz)) {
    dateFormatters.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  }
  const parts = dateFormatters.get(tz).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function utcMs(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Дни между локальными датами включительно: 1 января → 29 января = 29 */
export function windowDays(firstTs, endTs, tz = TZ) {
  const first = localDate(firstTs, tz);
  const last = localDate(endTs, tz);
  if (!first || !last) return 0;
  const days = Math.round((utcMs(last) - utcMs(first)) / DAY_MS) + 1;
  return days > 0 ? days : 0;
}

export function metaOf(event) {
  const meta = event && event.meta;
  if (!meta) return {};
  if (typeof meta === 'string') {
    try { return JSON.parse(meta); } catch { return {}; }
  }
  return typeof meta === 'object' ? meta : {};
}

/** Одна строка на событие: сначала event_id, иначе отпечаток старых записей */
export function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events || []) {
    const key = e.event_id
      ? `id|${e.user_key}|${e.event_id}`
      : ['fp', e.user_key, e.session_id, e.page, e.event, e.ts].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function isStudyPage(page, opts = {}) {
  return new Set(opts.pages || DEFAULTS.studyPages).has(page);
}

/** Сегменты учёбы: page_leave на учебных страницах, каждый не длиннее cap */
export function studySegments(events, opts = {}) {
  const cap = opts.segmentCapMs ?? DEFAULTS.segmentCapMs;
  return (events || [])
    .filter((e) => e.event === 'page_leave' && e.dwell_ms != null && isStudyPage(e.page, opts))
    .map((e) => ({ ...e, dwell: Math.min(Math.max(0, Number(e.dwell_ms) || 0), cap) }));
}

export function studyTimeMs(events, opts = {}) {
  return studySegments(events, opts).reduce((sum, e) => sum + e.dwell, 0);
}

/** Сессии по разрыву > gap; внутри — только учебное время */
export function sessionize(events, gapMs = DEFAULTS.sessionGapMs) {
  const sorted = [...(events || [])].sort((a, b) => {
    const t = new Date(a.ts) - new Date(b.ts);
    if (t !== 0) return t;
    return String(a.event_id || a.event).localeCompare(String(b.event_id || b.event));
  });
  const sessions = [];
  let current = null;
  let prev = null;
  for (const e of sorted) {
    const ts = new Date(e.ts).getTime();
    if (Number.isNaN(ts)) continue;
    if (!current || ts - prev > gapMs) {
      current = [];
      sessions.push(current);
    }
    current.push(e);
    prev = ts;
  }
  return sessions;
}

export function sessionStats(events, opts = {}) {
  const sessions = sessionize(events, opts.sessionGapMs ?? DEFAULTS.sessionGapMs);
  const withStudy = sessions
    .map((s) => studyTimeMs(s, opts))
    .filter((ms) => ms > 0);
  return {
    sessions_count: sessions.length,
    avg_session_min: withStudy.length
      ? Number((withStudy.reduce((a, b) => a + b, 0) / withStudy.length / 60000).toFixed(2))
      : null,
  };
}

export function activeDays(events, tz = TZ) {
  const days = new Set();
  for (const e of events || []) {
    const d = localDate(e.ts, tz);
    if (d) days.add(d);
  }
  return days.size;
}

export function regularity(active, window) {
  if (!window || window <= 0) return null;
  return Number(Math.min(1, active / window).toFixed(4));
}

export function tabSwitchIndex(events, studyMs) {
  if (!studyMs || studyMs < 60000) return null;
  const switches = (events || []).filter((e) => e.event === 'tab_switch').length;
  return Number((switches / (studyMs / 600000)).toFixed(2));
}

/** Статьи: сумма видимого времени по article_id и максимум прокрутки */
export function articleStats(events, opts = {}) {
  const depthMs = (opts.depthSec ?? DEFAULTS.depthSec) * 1000;
  const byArticle = new Map();
  for (const e of events || []) {
    if (e.event !== 'article_leave') continue;
    const meta = metaOf(e);
    const id = meta.article_id;
    if (!id) continue;
    if (!byArticle.has(id)) byArticle.set(id, { dwell: 0, scroll: 0 });
    const row = byArticle.get(id);
    row.dwell += Math.min(Math.max(0, Number(e.dwell_ms) || 0), opts.segmentCapMs ?? DEFAULTS.segmentCapMs);
    row.scroll = Math.max(row.scroll, Number(meta.scroll_pct ?? e.scroll_pct) || 0);
  }
  const articles = [...byArticle.values()];
  return {
    articles_count: articles.length,
    theory_depth: articles.filter((a) => a.dwell >= depthMs).length,
    scroll_avg: articles.length
      ? Number((articles.reduce((s, a) => s + a.scroll, 0) / articles.length).toFixed(2))
      : null,
  };
}

export function pageScrollAvg(events, opts = {}) {
  const rows = (events || []).filter((e) => e.event === 'page_leave' && e.scroll_pct != null
    && isStudyPage(e.page, opts));
  if (!rows.length) return null;
  return Number((rows.reduce((s, e) => s + Number(e.scroll_pct), 0) / rows.length).toFixed(2));
}

/** Дедлайны студента: сначала по группе, иначе по курсу (строки без группы) */
export function deadlinesFor(deadlines, profile) {
  const all = deadlines || [];
  if (profile?.group_code) {
    const byGroup = all.filter((d) => d.group_code === profile.group_code);
    if (byGroup.length) return byGroup;
  }
  return all.filter((d) => !d.group_code && d.course != null && Number(d.course) === Number(profile?.course));
}

export function nearestDeadline(deadlines, profile) {
  const list = deadlinesFor(deadlines, profile)
    .filter((d) => d.due_at)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  return list[0] || null;
}

/** Первое содержательное событие по дисциплине (article/ticket/test/task) */
export function firstContentEvent(events, discipline) {
  if (!discipline) return null;
  const rows = (events || [])
    .filter((e) => CONTENT_EVENTS.has(e.event) && metaOf(e).discipline === discipline)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return rows[0] || null;
}

export function prepStartDays(events, discipline, dueAt) {
  const first = firstContentEvent(events, discipline);
  if (!first || !dueAt) return null;
  const days = Math.floor((new Date(dueAt).getTime() - new Date(first.ts).getTime()) / DAY_MS);
  return days >= 0 ? days : null;
}

/** Приближение «≥ 5 мин за раз»: первая сессия с дисциплиной и 5 мин учёбы */
export function prepStartDays5Min(events, discipline, dueAt, opts = {}) {
  if (!discipline || !dueAt) return null;
  const sessions = sessionize(events, opts.sessionGapMs ?? DEFAULTS.sessionGapMs);
  for (const session of sessions) {
    const content = session.filter((e) => CONTENT_EVENTS.has(e.event) && metaOf(e).discipline === discipline);
    if (!content.length) continue;
    if (studyTimeMs(session, opts) < 5 * 60000) continue;
    const days = Math.floor((new Date(dueAt).getTime() - new Date(content[0].ts).getTime()) / DAY_MS);
    return days >= 0 ? days : null;
  }
  return null;
}

/** Доля учебного времени в последние `days` дней перед дедлайном */
export function deadlineShare(events, dueAt, opts = {}) {
  const total = studyTimeMs(events, opts);
  if (!total || !dueAt) return null;
  const due = new Date(dueAt).getTime();
  const from = due - (opts.deadlineDays ?? 3) * DAY_MS;
  const inWindow = studySegments(events, opts)
    .filter((e) => {
      const t = new Date(e.ts).getTime();
      return t >= from && t <= due;
    })
    .reduce((sum, e) => sum + e.dwell, 0);
  return Number((inWindow / total).toFixed(4));
}

/** Метрики практикума: уровень, самооценка, возврат после низкой самооценки */
export function practiceStats(events, attempts, tasks, opts = {}) {
  const list = attempts || [];
  const taskById = new Map((tasks || []).map((t) => [Number(t.id), t]));
  const levelOf = (a) => (taskById.get(Number(a.task_id)) || {}).level || '';
  const levels = {};
  for (const a of list) {
    const level = levelOf(a);
    if (!level) continue;
    levels[level] = (levels[level] || 0) + 1;
  }
  const scored = list.filter((a) => Number(a.max_score) > 0);
  const selfScoreAvg = scored.length
    ? Number((scored.reduce((s, a) => s + Number(a.self_score) / Number(a.max_score), 0) / scored.length).toFixed(3))
    : null;

  const low = (events || [])
    .filter((e) => e.event === 'self_check')
    .filter((e) => {
      const meta = metaOf(e);
      const max = Number(meta.max_score) || 0;
      return max > 0 && Number(meta.self_score) / max < 0.5;
    })
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const windowMs = (opts.returnWindowMin ?? 30) * 60000;
  let returns = 0;
  for (const check of low) {
    const taskId = Number(metaOf(check).task_id);
    const after = new Date(check.ts).getTime();
    const found = (events || []).some((e) => {
      if (e.event !== 'task_open' && e.event !== 'task_submit') return false;
      if (Number(metaOf(e).task_id) !== taskId) return false;
      const t = new Date(e.ts).getTime();
      return t > after && t - after <= windowMs;
    });
    if (found) returns++;
  }
  return { level_mix: levels, self_score_avg: selfScoreAvg, return_after_low_score: returns };
}

/** Воронка опроса: уникальные пользователи по вехам */
export function surveyFunnel(events) {
  const milestones = ['survey_open', 'survey_group', 'instrument_started', 'instrument_done', 'survey_finished'];
  const out = {};
  for (const m of milestones) {
    out[m] = new Set((events || []).filter((e) => e.event === m).map((e) => e.user_key)).size;
  }
  return out;
}

/** Полная строка студента */
export function buildUserRow({ profile, events, deadlineRows, windowEnd, opts = {} }) {
  const rows = events || [];
  const studyMs = studyTimeMs(rows, opts);
  const totalMin = Number((studyMs / 60000).toFixed(2));
  const first = rows.length
    ? rows.reduce((min, e) => (new Date(e.ts) < new Date(min.ts) ? e : min), rows[0])
    : null;
  const wDays = first ? windowDays(first.ts, windowEnd || first.ts, opts.tz || TZ) : 0;
  const act = activeDays(rows, opts.tz || TZ);
  const sessions = sessionStats(rows, opts);
  const articles = articleStats(rows, opts);
  const deadline = nearestDeadline(deadlineRows, profile);
  const discipline = deadline ? deadline.discipline_id : '';
  const due = deadline ? deadline.due_at : null;

  return {
    user_key: profile.user_key,
    course: profile.course ?? null,
    group_code: profile.group_code ?? null,
    total_time_min: totalMin,
    time_all_min: Number(((rows || [])
      .filter((e) => e.event === 'page_leave' && e.dwell_ms != null)
      .reduce((s, e) => s + Math.min(Math.max(0, Number(e.dwell_ms) || 0), opts.segmentCapMs ?? DEFAULTS.segmentCapMs), 0) / 60000).toFixed(2)),
    sessions_count: sessions.sessions_count,
    avg_session_min: sessions.avg_session_min,
    active_days: act,
    window_days: wDays,
    regularity: regularity(act, wDays),
    tab_switch_index: tabSwitchIndex(rows, studyMs),
    articles_count: articles.articles_count,
    theory_depth: articles.theory_depth,
    scroll_avg: articles.scroll_avg,
    scroll_avg_page: pageScrollAvg(rows, opts),
    deadline_share: deadlineShare(rows, due, opts),
    prep_start_days: prepStartDays(rows, discipline, due),
    prep_start_days_5min: prepStartDays5Min(rows, discipline, due, opts),
  };
}

// ---------------------------------------------------------------------------
// Самопроверка: фикстуры без сети
// ---------------------------------------------------------------------------

function selftest() {
  const checks = [];
  const ok = (cond, label, detail) => checks.push({ pass: Boolean(cond), label, detail });
  const at = (min) => new Date(Date.UTC(2026, 10, 14, 9, min)).toISOString(); // 14.11.2026 09:MM UTC
  const ev = (o) => ({ user_key: 'u', session_id: 's', page: 'sections', event: 'page_leave', ts: at(0), dwell_ms: 60000, ...o });

  // дедуп
  const dupId = [ev({ event_id: 'same-id-1' }), ev({ event_id: 'same-id-1', ts: at(1) })];
  ok(dedupeEvents(dupId).length === 1, 'дедуп по event_id', dedupeEvents(dupId).length);
  const dupFp = [ev({ event: 'page_view', dwell_ms: null }), ev({ event: 'page_view', dwell_ms: null })];
  ok(dedupeEvents(dupFp).length === 1, 'дедуп по отпечатку без event_id', dedupeEvents(dupFp).length);

  // сессии
  const s29 = [ev({ ts: at(0) }), ev({ ts: at(29) })];
  const s31 = [ev({ ts: at(0) }), ev({ ts: at(31) })];
  ok(sessionize(s29).length === 1, 'разрыв 29 мин — одна сессия', sessionize(s29).length);
  ok(sessionize(s31).length === 2, 'разрыв 31 мин — две сессии', sessionize(s31).length);

  // cap и учебные страницы
  ok(studyTimeMs([ev({ dwell_ms: 60 * 60000 })]) === 30 * 60000, 'сегмент 60 мин подрезан до 30', studyTimeMs([ev({ dwell_ms: 60 * 60000 })]));
  ok(studyTimeMs([ev({ page: 'index', dwell_ms: 60000 })]) === 0, 'index вне учебного времени', studyTimeMs([ev({ page: 'index', dwell_ms: 60000 })]));
  ok(studyTimeMs([ev({ page: 'library', dwell_ms: 60000 })]) === 0, 'library вне учебного времени');
  ok(studyTimeMs([ev({ page: 'tickets', dwell_ms: 60000 })]) === 60000, 'tickets — учебная страница');

  // часовой пояс: 22:30 UTC и 20:30 UTC — разные даты по Москве
  ok(localDate('2026-11-14T22:30:00Z') === '2026-11-15', 'МСК: 22:30 UTC = 15-е', localDate('2026-11-14T22:30:00Z'));
  ok(localDate('2026-11-14T20:30:00Z') === '2026-11-14', 'МСК: 20:30 UTC = 14-е', localDate('2026-11-14T20:30:00Z'));
  ok(activeDays([ev({ ts: '2026-11-14T22:30:00Z' }), ev({ ts: '2026-11-14T20:30:00Z' })]) === 2, 'активные дни по МСК', activeDays([ev({ ts: '2026-11-14T22:30:00Z' }), ev({ ts: '2026-11-14T20:30:00Z' })]));

  // окно и регулярность
  ok(windowDays('2027-01-01T00:00:00+03:00', '2027-01-29T00:00:00+03:00') === 29, 'окно 1–29 января = 29 дней', windowDays('2027-01-01T00:00:00+03:00', '2027-01-29T00:00:00+03:00'));
  ok(regularity(3, 10) === 0.3, 'регулярность 3/10', regularity(3, 10));

  // переключения
  const five = [1, 2, 3, 4, 5].map((i) => ev({ event: 'tab_switch', ts: at(i), dwell_ms: null }));
  ok(tabSwitchIndex(five, 10 * 60000) === 5, '5 переключений на 10 мин', tabSwitchIndex(five, 10 * 60000));
  ok(tabSwitchIndex(five, 30000) === null, 'меньше минуты — индекс не считается');

  // статьи
  const article = [
    ev({ event: 'article_leave', ts: at(0), dwell_ms: 30000, meta: { article_id: 'a', scroll_pct: 80 } }),
    ev({ event: 'article_leave', ts: at(1), dwell_ms: 40000, meta: { article_id: 'a', scroll_pct: 90 } }),
    ev({ event: 'article_leave', ts: at(2), dwell_ms: 20000, meta: { article_id: 'b', scroll_pct: 40 } }),
  ];
  const arts = articleStats(article);
  ok(arts.theory_depth === 1, 'глубина: 30+40 с по одной статье = 1', arts.theory_depth);
  ok(arts.scroll_avg === 65, 'средняя прокрутка: (90+40)/2', arts.scroll_avg);
  ok(articleStats([ev({ event: 'article_leave', meta: { scroll_pct: 50 } })]).theory_depth === 0, 'статья без article_id не считается');

  // дедлайны
  const due = '2027-01-10T10:00:00+03:00';
  const content = ev({ event: 'article_open', ts: '2026-12-31T10:00:00+03:00', dwell_ms: null, meta: { discipline: 'general-psych' } });
  const near = ev({ event: 'page_leave', ts: '2027-01-09T10:00:00+03:00', dwell_ms: 30 * 60000, page: 'sections' });
  const far = ev({ event: 'page_leave', ts: '2026-12-01T10:00:00+03:00', dwell_ms: 30 * 60000, page: 'sections' });
  ok(prepStartDays([content], 'general-psych', due) === 10, 'подготовка за 10 дней', prepStartDays([content], 'general-psych', due));
  ok(deadlineShare([near, far], due) === 0.5, 'доля времени в последние 3 дня = 0.5', deadlineShare([near, far], due));
  ok(deadlineShare([far], due) === 0, 'вне трёх дней — 0');

  // практикум
  const taskList = [{ id: 1, level: 'apply' }, { id: 2, level: 'create' }];
  const attempts = [
    { task_id: 1, self_score: 2, max_score: 4 },
    { task_id: 2, self_score: 4, max_score: 4 },
  ];
  const pr = practiceStats([], attempts, taskList);
  ok(pr.level_mix.apply === 1 && pr.level_mix.create === 1, 'level_mix по уровням', pr.level_mix);
  ok(pr.self_score_avg === 0.75, 'средняя самооценка 0.75', pr.self_score_avg);
  const lowCheck = ev({ event: 'self_check', ts: at(0), dwell_ms: null, meta: { task_id: 1, self_score: 1, max_score: 4 } });
  const reopen = ev({ event: 'task_open', ts: at(10), dwell_ms: null, meta: { task_id: 1 } });
  ok(practiceStats([lowCheck, reopen], [], taskList).return_after_low_score === 1, 'возврат после низкой самооценки', practiceStats([lowCheck, reopen], [], taskList).return_after_low_score);

  // воронка
  const funnel = surveyFunnel([
    ev({ event: 'survey_open', ts: at(0) }), ev({ event: 'survey_open', ts: at(1) }),
    ev({ event: 'survey_finished', ts: at(2) }),
  ]);
  ok(funnel.survey_open === 1 && funnel.survey_finished === 1, 'воронка считает уникальных', funnel);

  const failed = checks.filter((c) => !c.pass);
  for (const c of checks) {
    console.log(`${c.pass ? '✔' : '✘'} ${c.label}${c.pass ? '' : ' — ' + JSON.stringify(c.detail)}`);
  }
  console.log(`\nИтог: ${checks.length - failed.length}/${checks.length}`);
  return failed.length === 0;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/metrics.mjs') && process.argv.includes('--selftest')) {
  process.exit(selftest() ? 0 : 1);
}
