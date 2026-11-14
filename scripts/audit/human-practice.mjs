// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-practice.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Папка снимков — HUMAN_OUT (по умолчанию human-review-2026-11-13): «до/после» не затирают друг друга.
// Человеческий проход по практикуму: реальные разрешения, шаги, скриншоты, тексты.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', process.env.HUMAN_OUT || 'human-review-2026-11-13');
fs.mkdirSync(OUT, { recursive: true });
console.log('Снимки:', OUT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
      else if (m.method) (this.listeners.get(m.method) || []).forEach((fn) => fn(m.params)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + m)); } }, 60000); }); }
  once(m, t = 40000) { return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('event ' + m)), t); const fn = (p) => { clearTimeout(timer); this.listeners.set(m, (this.listeners.get(m) || []).filter((x) => x !== fn)); res(p); }; this.listeners.set(m, (this.listeners.get(m) || []).concat(fn)); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }
  on(m, f) { this.listeners.set(m, (this.listeners.get(m) || []).concat(f)); return f; }
}
const PORT = 9341;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'human-'));
// Свой порт на каждый запуск: иначе второй прогон подключится к Chrome от
// первого и покажет старую страницу из его кэша
const portInUse = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true).catch(() => false);
if (portInUse) { console.error(`Порт ${PORT} занят другим Chrome — закройте его перед запуском`); process.exit(1); }
const chrome = spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');

const vp = (w, h, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: w, screenHeight: h });
const go = async (p, settle = 2200) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };
const full = async (name) => {
  const m = await cdp.send('Page.getLayoutMetrics');
  const w = Math.ceil(m.cssContentSize.width), h = Math.ceil(m.cssContentSize.height);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  return { w, h };
};
const state = async () => cdp.eval(`(() => {
  const $ = (s) => document.querySelector(s);
  const rect = (s) => { const e = $(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  return {
    scrollY: Math.round(window.scrollY), vh: innerHeight,
    h1: $('h1')?.innerText, h2: $('header h2')?.innerText,
    progress: $('#practice-progress')?.innerText,
    firstCard: rect('.practice-card'), firstCardTitle: $('.practice-card__title')?.innerText,
    consent: rect('#consent-banner'),
    nav: { back: rect('[data-practice-back]'), next: rect('[data-practice-next]') },
    title: rect('.practice-task__title'), situation: rect('.practice-task__block'), options: rect('.practice-options'), check: rect('[data-practice-check]'),
    result: rect('[data-practice-result]'), resultText: $('[data-practice-result]')?.innerText?.slice(0, 300),
    save: rect('[data-practice-save]'), guestNote: $('[data-practice-guest-note]')?.innerText
  };
})()`);

// ---------------- 1366×768 ----------------
await vp(1366, 768);
await go('practice.html', 2500);
log('1366 ENTRY state', JSON.stringify(await state()));
await shot('practice-1366-01-entry.png');
log('1366 ENTRY full', JSON.stringify(await full('practice-1366-00-full.png')));

// человек докручивает до первого задания
await cdp.eval(`window.scrollTo({ top: document.querySelector('.practice-card').getBoundingClientRect().top + window.scrollY - 80, behavior: 'auto' })`);
await sleep(400);
await shot('practice-1366-02-list.png');
log('1366 LIST', JSON.stringify(await state()));

// открываем первое задание
await cdp.eval(`document.querySelector('[data-practice-task]').click()`);
await sleep(700);
log('1366 TASK TOP', JSON.stringify(await state()));
await shot('practice-1366-03-task-top.png');
// докручиваем до вариантов
await cdp.eval(`window.scrollTo({ top: document.querySelector('.practice-options').getBoundingClientRect().top + window.scrollY - 120, behavior: 'auto' })`);
await sleep(400);
await shot('practice-1366-04-task-options.png');
log('1366 OPTIONS', JSON.stringify(await state()));
// выбираем и проверяем
await cdp.eval(`document.querySelector('#practice-task-view input[name="practice-choice"]').click(); document.querySelector('[data-practice-check]').click();`);
await sleep(800);
log('1366 RESULT', JSON.stringify(await state()));
await shot('practice-1366-05-result.png');
// что видно сразу после ответа: где кнопка «следующее»
log('1366 AFTER RESULT expect next visible?', JSON.stringify(await cdp.eval(`(() => { const n = document.querySelector('[data-practice-next]'); const r = n.getBoundingClientRect(); const res = document.querySelector('[data-practice-result]').getBoundingClientRect(); return { nextTop: Math.round(r.top), nextBottom: Math.round(r.bottom), resultTop: Math.round(res.top), resultBottom: Math.round(res.bottom), vh: innerHeight }; })()`)));

// возвращаемся к списку: изменился ли прогресс/статус
await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
await sleep(500);
log('1366 BACK TO LIST', JSON.stringify(await cdp.eval(`(() => ({ progress: document.getElementById('practice-progress').innerText, statuses: [...document.querySelectorAll('.practice-card__status')].map((s) => s.innerText), ls: Object.keys(localStorage).filter((k) => k.includes('practice')) }))()`)));
await shot('practice-1366-06-back-to-list.png');

// открытое задание
await cdp.eval(`(() => { const cards = [...document.querySelectorAll('[data-practice-task]')]; const t = cards.find((c) => c.innerText.includes('Две трактовки')); (t || cards[1]).click(); })()`);
await sleep(700);
log('1366 OPEN TOP', JSON.stringify(await state()));
await shot('practice-1366-07-open-top.png');
// критерии до ответа
await cdp.eval(`window.scrollTo({ top: document.querySelector('[data-practice-show-criteria]').getBoundingClientRect().top + window.scrollY - 150, behavior: 'auto' })`);
await sleep(300);
await shot('practice-1366-08-open-before-criteria.png');
await cdp.eval(`document.querySelector('[data-practice-show-criteria]').click()`);
await sleep(400);
log('1366 CRITERIA first rows', JSON.stringify(await cdp.eval(`(() => ({ rubricTop: Math.round(document.querySelector('[data-practice-criteria]').getBoundingClientRect().top), rows: [...document.querySelectorAll('.practice-rubric__row')].map((r) => r.innerText.replace(/\\n/g, ' | ')).slice(0, 2), saveDisabled: document.querySelector('[data-practice-save]').disabled, hint: document.querySelector('[data-practice-complete-hint]')?.innerText, intro: document.querySelector('.practice-rubric__intro')?.innerText }))()`)));
await shot('practice-1366-09-criteria.png');

// мобилка 360×740
await vp(360, 740, true);
await go('practice.html', 2500);
log('360 ENTRY', JSON.stringify(await state()));
await shot('practice-360-01-entry.png');
await cdp.eval(`window.scrollTo({ top: document.querySelector('.practice-card').getBoundingClientRect().top + window.scrollY - 60, behavior: 'auto' })`);
await sleep(300);
await shot('practice-360-02-list.png');
await cdp.eval(`document.querySelector('[data-practice-task]').click()`);
await sleep(700);
log('360 TASK TOP', JSON.stringify(await state()));
await shot('practice-360-03-task-top.png');
await cdp.eval(`window.scrollTo({ top: 0, behavior: 'auto' })`);
await sleep(300);
await shot('practice-360-04-task-very-top.png');
const clientInfo = await cdp.eval(`({ ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight })`);
log('360 INFO', JSON.stringify(clientInfo));
// Закрываем браузер, иначе следующий запуск подключится к нему и покажет старый кэш
try { await cdp.send('Browser.close'); } catch { /* уже закрыт */ }
await sleep(400);
try { chrome.kill(); } catch { /* уже закрыт */ }
process.exit(0);
