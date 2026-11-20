// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-open-save.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Открытый ответ целиком: текст → критерии → оценки → «Сохранить попытку» (гость).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', 'human-review-2026-11-13');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
      else if (m.method) (this.listeners.get(m.method) || []).forEach((fn) => fn(m.params)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout')); } }, 60000); }); }
  once(m, t = 40000) { return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('event')), t); const fn = (p) => { clearTimeout(timer); this.listeners.set(m, (this.listeners.get(m) || []).filter((x) => x !== fn)); res(p); }; this.listeners.set(m, (this.listeners.get(m) || []).concat(fn)); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }
}
const PORT = 9346;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'human6-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
const l = cdp.once('Page.loadEventFired');
await cdp.send('Page.navigate', { url: `${BASE}/practice.html` }); await l; await sleep(2400);

await cdp.eval(`(() => { const cards = [...document.querySelectorAll('[data-practice-task]')]; const t = cards.find((c) => c.innerText.includes('Две трактовки')); t.click(); })()`);
await sleep(700);
await cdp.eval(`(() => {
  const ta = document.querySelector('[data-practice-answer]');
  ta.value = 'Ассоцианизм объясняет память связями по смежности, сходству и контрасту: следы связываются механически. Деятельностный подход рассматривает запоминание как мнемическое действие, опосредованное знаками и включённое в цель деятельности. Различие единиц анализа: ассоциация против действия. Для подготовки это значит, что зубрёжка работает хуже, чем организация материала в структуру и его использование в деятельности.';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1200);
await cdp.eval(`document.querySelector('[data-practice-show-criteria]').click()`);
await sleep(500);
await cdp.eval(`(() => {
  const rows = [...document.querySelectorAll('[data-practice-criterion]')];
  const values = [2, 1, 2, 1, 1];
  rows.forEach((row, i) => { const r = row.querySelector('input[type="radio"][value="' + values[i] + '"]'); if (r) r.click(); });
})()`);
await sleep(500);
console.log('BEFORE SAVE', JSON.stringify(await cdp.eval(`(() => ({ total: document.querySelector('[data-practice-self-total]')?.innerText, saveDisabled: document.querySelector('[data-practice-save]')?.disabled, hintHidden: document.querySelector('[data-practice-complete-hint]')?.hidden }))()`)));
await cdp.eval(`document.querySelector('[data-practice-save]').click()`);
await sleep(900);
const res = await cdp.eval(`(() => {
  const r = (s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {top:Math.round(b.top),bottom:Math.round(b.bottom)}};
  return {
    resultText: document.querySelector('[data-practice-result]')?.innerText.slice(0, 900),
    guest: document.querySelector('[data-practice-guest-note]')?.innerText,
    resultRect: r('[data-practice-result]'), next: r('[data-practice-next]'), save: r('[data-practice-save]'),
    scrollY: Math.round(scrollY), posted: false
  };
})()`);
console.log('AFTER SAVE', JSON.stringify(res, null, 1));
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'practice-1366-11-open-result.png'), Buffer.from(data, 'base64'));
console.log('LS', JSON.stringify(await cdp.eval(`Object.keys(localStorage).filter((k) => k.includes('practice'))`)));
process.exit(0);
