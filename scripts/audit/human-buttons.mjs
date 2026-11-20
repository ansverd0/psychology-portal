// Запуск: сначала python -m http.server 8767 --bind 127.0.0.1, затем node scripts/audit/human-buttons.mjs.
// Проверка: скрываются ли «Проверить» и «Сохранить попытку» после действия.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
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
const PORT = 9347;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'human7-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
const l = cdp.once('Page.loadEventFired');
await cdp.send('Page.navigate', { url: `${BASE}/practice.html` }); await l; await sleep(2400);

// choice
await cdp.eval(`document.querySelector('[data-practice-task]').click()`);
await sleep(500);
await cdp.eval(`document.querySelector('#practice-task-view input[name="practice-choice"]').click(); document.querySelector('[data-practice-check]').click();`);
await sleep(700);
console.log('CHOICE after answer', JSON.stringify(await cdp.eval(`(() => { const b = document.querySelector('[data-practice-check]'); const s = getComputedStyle(b); return { hidden: b.hidden, display: s.display, visibility: s.visibility, rect: (() => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; })() }; })()`)));

// open
await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
await sleep(400);
await cdp.eval(`(() => { const c = [...document.querySelectorAll('[data-practice-task]')].find((x) => x.innerText.includes('Две трактовки')); c.click(); })()`);
await sleep(600);
await cdp.eval(`(() => { const ta = document.querySelector('[data-practice-answer]'); ta.value = 'Ответ достаточной длины для проверки сохранения и снятия кнопки после действия.'; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(1200);
await cdp.eval(`document.querySelector('[data-practice-show-criteria]').click()`);
await sleep(300);
await cdp.eval(`document.querySelectorAll('[data-practice-criterion]').forEach((row) => row.querySelector('input[value="1"]').click())`);
await sleep(400);
console.log('SAVE before', JSON.stringify(await cdp.eval(`(() => { const b = document.querySelector('[data-practice-save]'); return { hidden: b.hidden, display: getComputedStyle(b).display, disabled: b.disabled }; })()`)));
await cdp.eval(`document.querySelector('[data-practice-save]').click()`);
await sleep(800);
console.log('SAVE after', JSON.stringify(await cdp.eval(`(() => { const b = document.querySelector('[data-practice-save]'); const s = getComputedStyle(b); return { hidden: b.hidden, display: s.display, disabled: b.disabled, rect: (() => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; })() }; })()`)));
console.log('click again ->', JSON.stringify(await cdp.eval(`(() => { const b = document.querySelector('[data-practice-save]'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`)));
await sleep(600);
console.log('result blocks', await cdp.eval(`document.querySelectorAll('[data-practice-result] [data-practice-result]').length`));
process.exit(0);
