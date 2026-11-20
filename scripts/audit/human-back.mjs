// Запуск: сначала python -m http.server 8767 --bind 127.0.0.1, затем node scripts/audit/human-back.mjs.
// Кнопка «Назад» браузера и F5 внутри практикума.
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
const PORT = 9343;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'human3-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
const go = async (p, settle = 1800) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const url = () => cdp.eval(`location.pathname + location.search`);

await go('index.html');
await cdp.eval(`document.querySelector('a[href="practice.html"]').click()`);
await cdp.once('Page.loadEventFired'); await sleep(2200);
console.log('after click practice:', await url());
await cdp.eval(`document.querySelector('[data-practice-task]').click()`);
await sleep(600);
console.log('after open task:', await url(), 'taskVisible=', await cdp.eval(`!document.getElementById('practice-task-view').hidden`));
// F5
const l = cdp.once('Page.loadEventFired');
await cdp.send('Page.reload');
await l; await sleep(2000);
console.log('after F5:', await url(), 'taskVisible=', await cdp.eval(`(() => { const v = document.getElementById('practice-task-view'); return v && !v.hidden; })()`), 'scrollY=', await cdp.eval('Math.round(scrollY)'));
// снова открыть и Back
await cdp.eval(`document.querySelector('[data-practice-task]').click()`);
await sleep(500);
const hist = await cdp.eval('history.length');
await cdp.eval('history.back()');
await sleep(1800);
console.log('after history.back:', await url(), 'page=', await cdp.eval('document.title'), 'historyLen=', hist);
process.exit(0);
