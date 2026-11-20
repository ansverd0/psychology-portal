// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-tiles-nav.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Мобильные контейнеры плиток и навигация по билетам.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', process.env.HUMAN_OUT || 'human-site-2026-11-13');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
      else if (m.method) (this.listeners.get(m.method) || []).forEach((fn) => fn(m.params)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 60000); }); }
  once(m, t = 40000) { return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('event')), t); const fn = (p) => { clearTimeout(timer); this.listeners.set(m, (this.listeners.get(m) || []).filter((x) => x !== fn)); res(p); }; this.listeners.set(m, (this.listeners.get(m) || []).concat(fn)); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error('eval'); return r.result.value; }
}
const PORT = 9355;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-c-'));
fs.mkdirSync(OUT, { recursive: true });
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true, screenWidth: 360, screenHeight: 740 });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const go = async (p, settle = 2300) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };

for (const [p, id] of [['sections.html', 'mobile-sections-tiles'], ['cards.html', 'cards-discipline-tiles'], ['tests.html', 'quiz-discipline-tiles'], ['tickets.html', 'mobile-tickets-tiles']]) {
  await go(p, 2200);
  console.log(p, JSON.stringify(await cdp.eval(`(() => { const c = document.getElementById(${JSON.stringify(id)}); if (!c) return null; const s = getComputedStyle(c); const r = c.getBoundingClientRect(); return { clientH: c.clientHeight, scrollH: c.scrollHeight, overflowY: s.overflowY, visible: r.height > 0, tiles: c.querySelectorAll('.mobile-tile-btn').length, rectTop: Math.round(r.top) }; })()`)));
}

// билеты: тап по плитке -> список вопросов, где он и куда уходит вьюер
await go('tickets.html', 2400);
const before = await cdp.eval(`({ viewerTop: Math.round(document.querySelector('.ticket-viewer').getBoundingClientRect().top), qList: getComputedStyle(document.getElementById('mobile-questions-list')).display })`);
await cdp.eval(`document.querySelector('#mobile-tickets-tiles .mobile-tile-btn').click()`);
await sleep(500);
const after = await cdp.eval(`(() => { const q = document.getElementById('mobile-questions-list'); const v = document.querySelector('.ticket-viewer'); return { qDisplay: getComputedStyle(q).display, qTop: Math.round(q.getBoundingClientRect().top), qBottom: Math.round(q.getBoundingClientRect().bottom), qCount: q.querySelectorAll('.ticket-nav-btn').length, viewerTop: Math.round(v.getBoundingClientRect().top), scrollH: document.body.scrollHeight }; })()`);
console.log('TICKETS tap tile', JSON.stringify({ before, after }));
await shot('33-tickets-360-questions-open.png');

// сколько до конца билета и есть ли кнопка «следующий» внизу
console.log('TICKETS end', JSON.stringify(await cdp.eval(`(() => { const v = document.querySelector('.ticket-viewer'); const r = v.getBoundingClientRect(); const last = [...document.querySelectorAll('.ticket-viewer *')].filter((e) => e.innerText && e.offsetParent).pop(); return { viewerHeight: Math.round(r.height), scrollH: document.body.scrollHeight, nextButtons: [...document.querySelectorAll('button, a')].filter((b) => /следующ|дальше/i.test(b.innerText)).map((b) => b.innerText), bottomControls: [...document.querySelectorAll('.ticket-viewer button, .ticket-viewer a')].map((b) => b.innerText).slice(0, 5) }; })()`)));
// Гасим браузер через CDP: иначе он держит порт и следующий прогон подключается
// к старому профилю с кэшем прошлой версии страниц
cdp.send('Browser.close').catch(() => {});
await sleep(400);
process.exit(0);
