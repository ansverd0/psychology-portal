// Замеры приёмки спринта 3 «Дисциплина» (UI2-11…UI2-13). Только чтение проекта,
// пишет .audit/<METRICS_OUT>.json (по умолчанию discipline-metrics.json).
//
//   python -m http.server 8767 --bind 127.0.0.1      # в отдельном окне
//   $env:METRICS_OUT='ui2-s3-before'; node scripts/audit/discipline-metrics.mjs
//   $env:METRICS_OUT='ui2-s3-after';  node scripts/audit/discipline-metrics.mjs
//
// Метрики (числа — не «на глаз»):
//   pages.<page>.rows            — строк [data-discipline] на странице (должно быть 27);
//   pages.<page>.emptyRows       — строк с data-empty="1" (должно быть 11);
//   pages.<page>.emptyTexts      — из них с текстом «материалов пока нет»;
//   pages.<page>.counts          — счётчики из данных строки, сверяются с materials (diffs);
//   pages.index.firstActionTop   — верх первой карточки действия на главной, px;
//   pages.index.actionsInFirstScreen — действий целиком в кадре 390×844 (цель ≥ 4);
//   pages.index.firstLeadTop     — верх первой дисциплины на главной, px;
//   pages.index.leadsInFirstScreen — дисциплин целиком в кадре 390×844;
//   pages.index.supabaseRequests — запросов к Supabase на главной (цель 0);
//   pages.index.newsDate         — дата «Что нового» в подвале главной;
//   clicks.*                     — клики с главной до списка билетов и до контента билета;
//   lists.*                      — clientH/scrollH у .limited-tiles, #mobile-questions-list,
//                                  #mobile-articles-list (цель clientH = scrollH, окна нет);
//   nav.tickets/nav.articles     — scrollY и верх контента после «Следующего» из конца билета/статьи;
//   news.latest/equal            — последняя запись news из REST и совпадение с датой на главной.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', (process.env.METRICS_OUT || 'discipline-metrics') + '.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const TYPES = ['tickets', 'articles', 'flashcards', 'tests', 'practice'];

// --- счётчики из materials: эталон для сверки ------------------------------
function materialsCounts() {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'materials/disciplines.json'), 'utf8'));
  const canonical = registry.canonical || {};
  const out = {};
  for (const id of Object.keys(canonical)) {
    out[id] = {};
    for (const type of TYPES) {
      const file = path.join(ROOT, 'materials', id, 'content', type + '.json');
      out[id][type] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).length : 0;
    }
  }
  return out;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) (this.listeners.get(m.method) || []).forEach((fn) => fn(m.params));
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    return new CDP(ws);
  }
  send(m, p = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + m)); } }, 60000);
    });
  }
  once(m, t = 40000) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('event ' + m)), t);
      const fn = (p) => { clearTimeout(timer); this.listeners.set(m, (this.listeners.get(m) || []).filter((x) => x !== fn)); res(p); };
      this.listeners.set(m, (this.listeners.get(m) || []).concat(fn));
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  on(m, f) { this.listeners.set(m, (this.listeners.get(m) || []).concat(f)); return f; }
}

const PORT = 9362 + (process.pid % 100);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-metrics-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { /* ждём */ }
  await sleep(250);
}
const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');

const vp = (w, h, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: w, screenHeight: h });
const touch = (on) => cdp.send('Emulation.setTouchEmulationEnabled', { enabled: on, maxTouchPoints: 5 });
const go = async (p, settle = 2600) => {
  const l = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/${p}` });
  await l; await sleep(settle);
};
const waitFor = async (expr, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await cdp.eval(`Boolean(${expr})`)) return true; } catch { /* страница перезагружается */ }
    await sleep(150);
  }
  return false;
};
// Навигация во время замера рвёт контекст — это не ошибка замера
const safe = async (expr, fallback = null) => {
  try { return await cdp.eval(expr); } catch { return fallback; }
};
const clickNavigate = async (expr, settle = 2600) => {
  const l = cdp.once('Page.loadEventFired');
  await cdp.eval(expr);
  await l; await sleep(settle);
};

// Запросы к Supabase считаем по факту: Network.requestWillBeSent
let netLog = [];
cdp.on('Network.requestWillBeSent', (p) => { netLog.push(p.request.url); });
const supabaseRequests = () => netLog.filter((u) => /supabase\.co/.test(u)).length;

const READ_PAGE = `(() => {
  const q = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('[data-discipline]')];
  const counts = {};
  let emptyRows = 0, emptyTexts = 0;
  rows.forEach((row) => {
    const id = row.getAttribute('data-discipline');
    counts[id] = {};
    ['tickets','articles','flashcards','tests','practice'].forEach((t) => {
      counts[id][t] = Number(row.getAttribute('data-' + t) || 0);
    });
    if (row.getAttribute('data-empty') === '1') {
      emptyRows++;
      if (/материалов\\s+пока\\s+нет/i.test(row.innerText || '')) emptyTexts++;
    }
  });
  const leads = [...document.querySelectorAll('[data-lead-discipline]')];
  const actions = [...document.querySelectorAll('[data-home-action]')];
  const vh = innerHeight;
  return {
    rows: rows.length,
    uniqueRows: new Set(rows.map((r) => r.getAttribute('data-discipline'))).size,
    emptyRows,
    emptyTexts,
    counts,
    actions: actions.length,
    actionHrefs: actions.map((a) => a.getAttribute('href')),
    firstActionTop: actions.length ? Math.round(actions[0].getBoundingClientRect().top + scrollY) : null,
    actionsInFirstScreen: actions.filter((a) => a.getBoundingClientRect().bottom <= vh).length,
    leads: leads.length,
    firstLeadTop: leads.length ? Math.round(leads[0].getBoundingClientRect().top + scrollY) : null,
    leadsInFirstScreen: leads.filter((l) => l.getBoundingClientRect().bottom <= vh).length,
    newsDate: q('[data-news-date]') ? q('[data-news-date]').textContent.trim() : null,
    newsHref: q('[data-news-link]') ? q('[data-news-link]').getAttribute('href') : null,
    supabaseRequests: 0
  };
})()`;

// --- 1. Счётчики материалов (эталон) ---------------------------------------
const materials = materialsCounts();

// --- 2. Пять страниц при 390×844 -------------------------------------------
const pages = {};
const PAGE_LIST = ['index.html', 'tickets.html', 'sections.html', 'cards.html', 'tests.html'];
await vp(390, 844, true);
await touch(true);

for (const page of PAGE_LIST) {
  netLog = [];
  await go(page);
  await waitFor(`document.querySelectorAll('[data-discipline]').length > 0 || document.body.dataset.page === 'index'`, 12000);
  await sleep(600);
  const r = await safe(READ_PAGE);
  const key = page.replace('.html', '');
  pages[key] = Object.assign({}, r, { supabaseRequests: supabaseRequests() });
  log(page, 'rows', pages[key].rows, 'empty', pages[key].emptyRows, 'supabase', pages[key].supabaseRequests);
}

// --- 3. Сверка счётчиков с materials ---------------------------------------
const diffs = [];
for (const page of Object.keys(pages)) {
  const counts = pages[page].counts || {};
  for (const id of Object.keys(counts)) {
    for (const type of TYPES) {
      const want = (materials[id] || {})[type];
      const got = counts[id][type];
      if (want === undefined) { diffs.push({ page, id, type, want: null, got }); continue; }
      if (want !== got) diffs.push({ page, id, type, want, got });
    }
  }
}
log('расхождений счётчиков с materials:', diffs.length);

// --- 4. Клики: главная → список билетов → билет ----------------------------
await go('index.html');
const leadCount = await safe(`document.querySelectorAll('[data-lead-discipline]').length`, 0);
const leadHref = await safe(`(document.querySelector('[data-lead-discipline]') || {}).href || null`);
const clicks = { leadCount, leadHref, listVisible: false, listItems: 0, ticketShown: false, ticketTitle: null };
if (leadCount > 0) {
  await clickNavigate(`document.querySelector('[data-lead-discipline]').click()`);
  await sleep(1200);
  clicks.urlAfterFirstClick = await safe('location.pathname + location.search');
  clicks.listItems = await safe(`[...document.querySelectorAll('#mobile-questions-list .ticket-nav-btn, #tickets-questions-col .question-nav-btn')].filter((b) => b.offsetParent !== null).length`, 0);
  clicks.listVisible = await safe(`(() => { const d = document.getElementById('mobile-questions-list'); return Boolean(d && getComputedStyle(d).display !== 'none' && d.querySelector('.ticket-nav-btn, summary')); })()`, false);
  if (clicks.listItems > 0) {
    await cdp.eval(`(() => { const b = document.querySelector('#mobile-questions-list .ticket-nav-btn, #tickets-questions-col .question-nav-btn'); b.click(); })()`);
    await sleep(900);
    clicks.ticketTitle = await safe(`(document.querySelector('.ticket-viewer h2') || {}).textContent || null`);
    clicks.ticketShown = await safe(`Boolean(document.querySelector('.ticket-viewer .content-text'))`, false);
  }
}
log('клики:', JSON.stringify(clicks));

// --- 5. Списки без внутренних окон: clientH = scrollH ----------------------
const lists = {};
const measureList = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const s = getComputedStyle(el);
  if (s.display === 'none' || el.getBoundingClientRect().height < 1) return { hidden: true };
  return { clientH: el.clientHeight, scrollH: el.scrollHeight, overflowY: s.overflowY, maxHeight: s.maxHeight, equal: Math.abs(el.clientHeight - el.scrollHeight) <= 1 };
}`;

// tickets: открыть дисциплину, затем билет → список вопросов раскрыт
await go('tickets.html');
await cdp.eval(`document.querySelector('#mobile-tickets-tiles .mobile-tile-btn').click()`);
await sleep(900);
lists.tickets = {
  tiles: await safe(`(${measureList})('#mobile-tickets-tiles')`),
  questions: await safe(`(${measureList})('#mobile-questions-list')`)
};
await cdp.eval(`document.querySelector('#mobile-questions-list .ticket-nav-btn').click()`);
await sleep(900);

// sections: открыть раздел → статьи
await go('sections.html');
await cdp.eval(`document.querySelector('#mobile-sections-tiles .mobile-tile-btn').click()`);
await sleep(900);
lists.sections = {
  tiles: await safe(`(${measureList})('#mobile-sections-tiles')`),
  articles: await safe(`(${measureList})('#mobile-articles-list')`)
};

// cards / tests: плитки дисциплин
for (const [page, id] of [['cards.html', '#cards-discipline-tiles'], ['tests.html', '#quiz-discipline-tiles']]) {
  await go(page);
  lists[page.replace('.html', '')] = { tiles: await safe(`(${measureList})('${id}')`) };
}
log('списки:', JSON.stringify(lists));

// --- 6. «Следующий» из конца билета и статьи -------------------------------
const NAV = `(() => {
  const next = document.querySelector('[data-content-next]');
  const prev = document.querySelector('[data-content-prev]');
  const pos = document.querySelector('[data-content-pos]');
  return {
    hasNext: Boolean(next), hasPrev: Boolean(prev),
    nextDisabled: next ? (next.disabled || next.getAttribute('aria-disabled') === 'true') : null,
    pos: pos ? pos.textContent.trim() : null,
    title: (document.querySelector('.ticket-viewer h2, .section-viewer h2') || {}).textContent || null
  };
})()`;

const nav = {};
// 390: билет
await vp(390, 844, true);
await go('tickets.html');
await cdp.eval(`document.querySelector('#mobile-tickets-tiles .mobile-tile-btn').click()`);
await sleep(700);
await cdp.eval(`document.querySelector('#mobile-questions-list .ticket-nav-btn').click()`);
await sleep(900);
const navBefore390 = await safe(NAV);
await safe(`(() => { const b = document.querySelector('[data-content-next]'); if (b) { b.scrollIntoView({ block: 'center' }); } })()`);
await sleep(400);
const scrollBefore390 = await safe('Math.round(scrollY)');
await safe(`document.querySelector('[data-content-next]').click()`);
await sleep(900);
nav.tickets390 = {
  before: navBefore390,
  scrollBefore: scrollBefore390,
  after: await safe(NAV),
  ...(await safe(`(() => { const r = document.querySelector('.ticket-viewer').getBoundingClientRect(); return { scrollY: Math.round(scrollY), viewerTop: Math.round(r.top), inFrame: r.top >= 0 && r.top <= 120 }; })()`, {}))
};
// 1440: билет
await vp(1440, 900, false);
await touch(false);
await go('tickets.html');
await safe(`(() => { const b = document.querySelector('[data-content-next]'); if (b) b.scrollIntoView({ block: 'center' }); })()`);
await sleep(400);
const scrollBefore1440 = await safe('Math.round(scrollY)');
await safe(`document.querySelector('[data-content-next]').click()`);
await sleep(900);
nav.tickets1440 = {
  scrollBefore: scrollBefore1440,
  after: await safe(NAV),
  ...(await safe(`(() => { const r = document.querySelector('.ticket-viewer').getBoundingClientRect(); return { scrollY: Math.round(scrollY), viewerTop: Math.round(r.top), inFrame: r.top >= 0 && r.top <= 120 }; })()`, {}))
};
// 390: статья
await vp(390, 844, true);
await go('sections.html');
await cdp.eval(`document.querySelector('#mobile-sections-tiles .mobile-tile-btn').click()`);
await sleep(700);
await cdp.eval(`document.querySelector('#mobile-articles-list .ticket-nav-btn').click()`);
await sleep(900);
const navBeforeArt = await safe(NAV);
await safe(`(() => { const b = document.querySelector('[data-content-next]'); if (b) b.scrollIntoView({ block: 'center' }); })()`);
await sleep(400);
const scrollBeforeArt = await safe('Math.round(scrollY)');
await safe(`document.querySelector('[data-content-next]').click()`);
await sleep(900);
nav.articles390 = {
  before: navBeforeArt,
  scrollBefore: scrollBeforeArt,
  after: await safe(NAV),
  ...(await safe(`(() => { const r = document.querySelector('.section-viewer').getBoundingClientRect(); return { scrollY: Math.round(scrollY), viewerTop: Math.round(r.top), inFrame: r.top >= 0 && r.top <= 120 }; })()`, {}))
};
log('переходы:', JSON.stringify(nav));

// --- 7. Дата «Что нового» против последней записи news ---------------------
const news = { home: pages.index.newsDate, latest: null, equal: null, source: null };
try {
  const cfg = fs.readFileSync(path.join(ROOT, 'js/supabase-config.js'), 'utf8');
  const url = (cfg.match(/const SUPABASE_URL = "([^"]+)"/) || [])[1];
  const key = (cfg.match(/const SUPABASE_ANON_KEY = "([^"]+)"/) || [])[1];
  const res = await fetch(`${url}/rest/v1/news?select=date,id&order=id.desc&limit=1`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  const rows = await res.json();
  news.latest = rows && rows[0] ? rows[0].date : null;
  news.source = 'rest:news?order=id.desc';
} catch (e) { news.error = e.message; }
news.equal = news.latest !== null && news.home === news.latest;
log('дата новостей:', JSON.stringify(news));

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  materials,
  pages,
  countDiffs: diffs,
  clicks,
  lists,
  nav,
  news
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
log('записано:', path.relative(ROOT, OUT));
// Гасим браузер через CDP: иначе он держит порт, и следующий прогон
// подключается к старому профилю с кэшем прошлой версии страниц
cdp.send('Browser.close').catch(() => {});
await sleep(300);
chrome.kill();
process.exit(0);
