// Снимки главной «по действиям» (UI2-30): 390×844 чистый профиль и 1440×900.
// Запуск: сначала python -m http.server 8767 --bind 127.0.0.1,
// затем node scripts/audit/home-actions-shots.mjs.
// База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/ui2-s3-actions-shots/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', 'ui2-s3-actions-shots');
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
const PORT = 9349;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'home-actions-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { /* ждём Chrome */ } await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
fs.mkdirSync(OUT, { recursive: true });
const vp = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: w, screenHeight: h });
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };
const go = async (settle = 2200) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/index.html` }); await l; await sleep(settle); };

for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  await vp(w, h, mobile);
  await go();
  await shot(`home-actions-${w}.png`);
  console.log(`${w}x${h}`, JSON.stringify(await cdp.eval(`(() => {
    const a = [...document.querySelectorAll('[data-home-action]')];
    const l = document.querySelector('[data-lead-discipline]');
    return {
      actions: a.map((x) => ({ type: x.getAttribute('data-home-action'), href: x.getAttribute('href'), top: Math.round(x.getBoundingClientRect().top + scrollY), bottom: Math.round(x.getBoundingClientRect().bottom + scrollY) })),
      firstLeadTop: l ? Math.round(l.getBoundingClientRect().top + scrollY) : null,
      scrollH: document.body.scrollHeight
    };
  })()`)));
}
process.exit(0);
