// Замеры приёмки спринта 2 «Практикум» (UI2-06…UI2-10). Только чтение проекта,
// пишет .audit/<METRICS_OUT>.json (по умолчанию practice-metrics.json).
//
//   python -m http.server 8767 --bind 127.0.0.1      # в отдельном окне
//   $env:METRICS_OUT='practice-s2-before'; node scripts/audit/practice-metrics.mjs
//   $env:METRICS_OUT='practice-s2-after';  node scripts/audit/practice-metrics.mjs
//
// Метрики (числа — не «на глаз»):
//   entry.firstCardTop       — верх первой карточки задания от верха документа, px;
//   task.checkInFrame        — «Проверить» в кадре сразу после открытия задания;
//   answer.nextTop           — верх видимой кнопки «Следующее» ПОСЛЕ ответа (≥ 0 и ≤ vh);
//   reload.progress          — текст прогресса после гостевого ответа и F5 («Решено 1 из 4»);
//   reload.statuses          — статусы карточек после F5;
//   history.backToList       — history.back() из задания возвращает к списку;
//   f5.taskSame/scrollDelta  — F5 сохраняет задание и прокрутку;
//   modal.forbidden          — нет слов «активация», «опросы», «эссе» в модалке с практикума.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', (process.env.METRICS_OUT || 'practice-metrics') + '.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

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

const PORT = 9342;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
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

const vp = (w, h, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: w, screenHeight: h });
const go = async (p, settle = 2200) => {
  const l = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/${p}` });
  await l; await sleep(settle);
};
const reload = async (settle = 2000) => {
  const l = cdp.once('Page.loadEventFired');
  await cdp.send('Page.reload', { ignoreCache: true });
  await l; await sleep(settle);
};
const waitFor = async (expr, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await cdp.eval(`Boolean(${expr})`)) return true; } catch { /* страница перезагружается */ }
    await sleep(150);
  }
  throw new Error('waitFor: ' + expr);
};
// Навигация во время замера (history.back) рвёт контекст — это не ошибка замера
const safe = async (expr, fallback = null) => {
  try { return await cdp.eval(expr); } catch { return fallback; }
};

const CLEAN_STORAGE = `(() => {
  ['research_user_key', 'hub_practice_progress_v1', 'hub_practice_scroll'].forEach((k) => localStorage.removeItem(k));
  Object.keys(localStorage).filter((k) => k.indexOf('hub_practice_draft_v1_') === 0).forEach((k) => localStorage.removeItem(k));
  sessionStorage.clear();
  return true;
})()`;

const LIST_STATE = `(() => {
  const card = document.querySelector('.practice-card');
  const r = card ? card.getBoundingClientRect() : null;
  const progress = document.getElementById('practice-progress');
  const tiles = document.getElementById('practice-discipline-tiles');
  const tilesBox = tiles ? tiles.getBoundingClientRect() : null;
  const filters = document.getElementById('practice-filters') || document.querySelector('.practice-filters');
  return {
    vh: innerHeight,
    scrollY: Math.round(window.scrollY),
    firstCardTop: r ? Math.round(r.top + window.scrollY) : null,
    firstCardViewportTop: r ? Math.round(r.top) : null,
    progress: progress ? (progress.textContent || '').trim() : null,
    statuses: [...document.querySelectorAll('.practice-card__status')].map((s) => (s.textContent || '').trim()),
    levelChips: [...document.querySelectorAll('[data-practice-level]')].map((b) => (b.textContent || '').trim()),
    disciplineTiles: [...document.querySelectorAll('[data-practice-discipline]')].map((b) => (b.textContent || '').trim()),
    disciplineTilesVisible: Boolean(tilesBox && tilesBox.width > 0 && tilesBox.height > 0),
    filters: filters ? { open: Boolean(filters.tagName === 'DETAILS' ? filters.open : true), summary: (filters.querySelector('summary') || {}).textContent?.trim() || null } : null,
    aiPlates: document.querySelectorAll('[data-practice-ai-plate], .practice-badge--ai, .practice-ai-note').length,
    pilot: (document.querySelector('.practice-pilot') || {}).textContent?.trim() || null,
    headerHeight: Math.round((document.querySelector('header') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
    url: location.pathname.split('/').pop() + location.search
  };
})()`;

const TASK_STATE = `(() => {
  const view = document.querySelector('[data-practice-task-view]');
  const docTop = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
  const vhRect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inFrame: r.top >= 0 && r.bottom <= innerHeight }; };
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const nexts = [...document.querySelectorAll('[data-practice-next]')].filter(vis).map(vhRect);
  const result = document.querySelector('[data-practice-result]');
  const note = document.querySelector('[data-practice-guest-note]');
  const answer = document.querySelector('[data-practice-answer-area]');
  return {
    vh: innerHeight,
    scrollY: Math.round(window.scrollY),
    url: location.pathname.split('/').pop() + location.search,
    taskTitle: (document.querySelector('.practice-task__title') || {}).textContent?.trim() || null,
    visible: Boolean(view && !view.hidden),
    checkTop: docTop(document.querySelector('[data-practice-check]')),
    checkRect: vhRect(document.querySelector('[data-practice-check]')),
    showCriteriaRect: vhRect(document.querySelector('[data-practice-show-criteria]')),
    optionsRect: vhRect(document.querySelector('.practice-options')),
    nexts,
    nextInFrame: nexts.some((n) => n.inFrame),
    result: vhRect(result),
    resultVisible: Boolean(result && !result.hidden),
    resultText: result ? (result.innerText || '').slice(0, 500) : '',
    verdict: result ? ((result.querySelector('.practice-result__verdict') || {}).textContent || '').trim() : '',
    hasYourAnswer: result ? /Ваш ответ/i.test(result.innerText || '') : false,
    guestNote: note && !note.hidden ? { text: (note.innerText || '').trim(), top: docTop(note) } : null,
    resultActions: vhRect(document.querySelector('[data-practice-result-actions]')),
    radiosDisabled: [...document.querySelectorAll('#practice-task-view input[type="radio"]')].every((i) => i.disabled),
    textareaReadonly: (() => { const t = document.querySelector('[data-practice-answer]'); return t ? t.readOnly : null; })(),
    saveVisible: vis(document.querySelector('[data-practice-save]')),
    saveLabel: (document.querySelector('[data-practice-save]') || {}).textContent?.trim() || null,
    answerAreaText: answer ? (answer.innerText || '').slice(0, 200) : ''
  };
})()`;

const result = { generatedAt: new Date().toISOString(), base: BASE, widths: {} };
log('Замеры практикума →', OUT);

for (const [width, height, mobile] of [[360, 740, true], [1366, 768, false]]) {
  const label = `${width}x${height}`;
  const bucket = {};
  log(`\n=== ${label} ===`);

  await vp(width, height, mobile);
  await go('practice.html', 1500);
  await waitFor('document.querySelectorAll("[data-practice-task]").length > 0', 30000);
  await cdp.eval(CLEAN_STORAGE);
  await reload(2400);
  await waitFor('document.querySelectorAll("[data-practice-task]").length > 0', 30000);
  await sleep(300);
  bucket.entry = await cdp.eval(LIST_STATE);
  log('entry', JSON.stringify(bucket.entry));

  // Открываем первое задание (оно choice) и меряем «Проверить» и «Следующее»
  bucket.taskIds = await cdp.eval(`[...document.querySelectorAll('[data-practice-task]')].map((c) => Number(c.getAttribute('data-practice-task')))`);
  await cdp.eval(`document.querySelector('[data-practice-open-task]').click()`);
  await waitFor('(() => { const v = document.querySelector("[data-practice-task-view]"); return v && !v.hidden && Boolean(document.querySelector("#practice-task-view input[name=\\"practice-choice\\"]")); })()', 8000);
  await sleep(600);
  bucket.taskOpen = await cdp.eval(TASK_STATE);
  log('taskOpen', JSON.stringify({ checkRect: bucket.taskOpen.checkRect, options: bucket.taskOpen.optionsRect, nexts: bucket.taskOpen.nexts, url: bucket.taskOpen.url }));

  // Гостевой ответ: первый вариант (неверный) → вердикт и кнопки
  await cdp.eval(`(() => {
    document.querySelector('#practice-task-view input[name="practice-choice"]').click();
    document.querySelector('[data-practice-check]').click();
    return true;
  })()`);
  await waitFor('(() => { const r = document.querySelector("[data-practice-result]"); return r && !r.hidden; })()', 8000);
  await sleep(700);
  bucket.afterAnswer = await cdp.eval(TASK_STATE);
  log('afterAnswer', JSON.stringify({
    verdict: bucket.afterAnswer.verdict,
    nexts: bucket.afterAnswer.nexts,
    nextInFrame: bucket.afterAnswer.nextInFrame,
    hasYourAnswer: bucket.afterAnswer.hasYourAnswer,
    guestNote: bucket.afterAnswer.guestNote && { top: bucket.afterAnswer.guestNote.top, text: bucket.afterAnswer.guestNote.text.slice(0, 80) },
    resultTop: bucket.afterAnswer.result && bucket.afterAnswer.result.top,
    radiosDisabled: bucket.afterAnswer.radiosDisabled,
    saveVisible: bucket.afterAnswer.saveVisible
  }));

  // «К списку» из результата: карточка в кадре
  await cdp.eval(`(() => {
    const act = document.querySelector('[data-practice-result-actions]');
    const btn = (act && act.querySelector('[data-practice-back]')) || document.querySelector('[data-practice-back]');
    if (btn) btn.click();
    return true;
  })()`);
  await waitFor('(() => { const l = document.getElementById("practice-list"); return l && !l.hidden; })()', 8000);
  await sleep(400);
  bucket.backFromResult = await cdp.eval(`(() => {
    const card = document.querySelector('.practice-card');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { url: location.pathname.split('/').pop() + location.search, top: Math.round(r.top), bottom: Math.round(r.bottom), inFrame: r.top >= 0 && r.bottom <= innerHeight, scrollY: Math.round(window.scrollY), progress: (document.getElementById('practice-progress') || {}).textContent?.trim() };
  })()`);
  log('backFromResult', JSON.stringify(bucket.backFromResult));

  // F5 после гостевого ответа: прогресс и статусы
  await reload(2600);
  await waitFor('document.querySelectorAll("[data-practice-task]").length > 0');
  await sleep(300);
  bucket.reload = await cdp.eval(LIST_STATE);
  log('reload', JSON.stringify({ progress: bucket.reload.progress, statuses: bucket.reload.statuses, url: bucket.reload.url }));

  // history.back() из открытого задания возвращает к списку
  await cdp.eval(`document.querySelector('[data-practice-open-task]').click()`);
  await waitFor('(() => { const v = document.querySelector("[data-practice-task-view]"); return v && !v.hidden; })()', 8000);
  await sleep(400);
  bucket.openedUrl = await cdp.eval('location.pathname.split("/").pop() + location.search');
  await safe('history.back()');
  await sleep(1200);
  bucket.historyBack = await safe(`(() => {
    const l = document.getElementById('practice-list');
    const v = document.querySelector('[data-practice-task-view]');
    return { url: location.pathname.split('/').pop() + location.search, listVisible: Boolean(l && !l.hidden), taskVisible: Boolean(v && !v.hidden) };
  })()`, { url: 'navigation', listVisible: false, taskVisible: false });
  log('historyBack', JSON.stringify({ openedUrl: bucket.openedUrl, ...bucket.historyBack }));

  // ?task=id открывается напрямую, F5 в открытом задании держит задание и прокрутку
  const taskId = bucket.taskIds[1] || bucket.taskIds[0];
  try {
    await go(`practice.html?task=${taskId}`, 2600);
    await waitFor('(() => { const v = document.querySelector("[data-practice-task-view]"); return v && !v.hidden; })()', 10000);
    await sleep(500);
    await cdp.eval('window.scrollTo({ top: 420, behavior: "auto" })');
    await sleep(400);
    bucket.deepLink = await cdp.eval(TASK_STATE);
    const beforeReload = await cdp.eval('({ y: Math.round(window.scrollY), title: (document.querySelector(".practice-task__title")||{}).textContent?.trim() || null, url: location.pathname.split("/").pop() + location.search })');
    await reload(2800);
    await waitFor('(() => { const v = document.querySelector("[data-practice-task-view]"); return v && !v.hidden; })()', 10000);
    await sleep(600);
    const afterReload = await cdp.eval('({ y: Math.round(window.scrollY), title: (document.querySelector(".practice-task__title")||{}).textContent?.trim() || null, url: location.pathname.split("/").pop() + location.search })');
    bucket.f5 = { before: beforeReload, after: afterReload, taskSame: beforeReload.title === afterReload.title, scrollDelta: Math.abs(beforeReload.y - afterReload.y) };
    log('f5', JSON.stringify(bucket.f5));
  } catch (e) {
    // До UI2-08 адрес задания не поддерживается — фиксируем это как факт замера
    bucket.deepLink = await safe(LIST_STATE, null);
    bucket.f5 = { error: String(e.message || e).slice(0, 120), taskSame: false, scrollDelta: null };
    log('f5', JSON.stringify(bucket.f5));
  }

  // Модалка ID: слова про исследование не должны читаться на практикуме
  await cdp.eval(`(() => { const b = document.getElementById('btn-open-auth-modal'); if (b) b.click(); return true; })()`);
  await sleep(500);
  bucket.modal = await cdp.eval(`(() => {
    const box = document.getElementById('research-auth-box');
    const text = box ? (box.innerText || '') : '';
    return {
      visible: Boolean(box && getComputedStyle(box).display !== 'none'),
      title: (document.getElementById('research-auth-title') || {}).textContent?.trim() || null,
      length: text.length,
      forbidden: {
        activaciya: /активаци/i.test(text),
        oprosy: /опрос/i.test(text),
        esse: /эссе/i.test(text)
      },
      hasSaveAttempts: /сохранить попытки/i.test(text),
      consentSeparateStep: /согласие/i.test(text)
    };
  })()`);
  log('modal', JSON.stringify(bucket.modal));

  result.widths[label] = bucket;
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
log('\nЗаписано:', OUT);
cdp.send('Browser.close').catch(() => {});
await sleep(300);
chrome.kill();
process.exit(0);
