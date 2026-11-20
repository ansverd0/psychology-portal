// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-wiki-touch.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Тап по термину и мобильные высоты страниц.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', 'human-site-2026-11-13');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
      else if (m.method) (this.listeners.get(m.method) || []).forEach((fn) => fn(m.params)); }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + m)); } }, 60000); }); }
  once(m, t = 40000) { return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('event ' + m)), t); const fn = (p) => { clearTimeout(timer); this.listeners.set(m, (this.listeners.get(m) || []).filter((x) => x !== fn)); res(p); }; this.listeners.set(m, (this.listeners.get(m) || []).concat(fn)); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }
}
const PORT = 9354;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-t-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true, screenWidth: 360, screenHeight: 740 });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const go = async (p, settle = 2400) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };

await go('sections.html', 2600);
const term = await cdp.eval(`(() => { const e = document.querySelector('.wiki-term'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: e.innerText, content: getComputedStyle(e, '::after').content, hover: e.matches(':hover'), tabindex: e.getAttribute('tabindex') }; })()`);
console.log('TERM before', JSON.stringify(term));
if (term) {
  await cdp.eval(`window.scrollTo({ top: ${term.y} + scrollY - 300, behavior: 'auto' })`);
  await sleep(300);
  const pos = await cdp.eval(`(() => { const e = document.querySelector('.wiki-term'); const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  console.log('TERM after tap', JSON.stringify(await cdp.eval(`(() => { const e = document.querySelector('.wiki-term'); const s = getComputedStyle(e, '::after'); return { hover: e.matches(':hover'), opacity: s.opacity, visibility: s.visibility, content: s.content, display: s.display }; })()`)));
  await shot('31-sections-360-term-tap.png');
  // наведение мышью (как на ПК)
  const pos2 = await cdp.eval(`(() => { const e = document.querySelector('.wiki-term'); const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos2.x, y: pos2.y });
  await sleep(500);
  console.log('TERM after hover', JSON.stringify(await cdp.eval(`(() => { const e = document.querySelector('.wiki-term'); const s = getComputedStyle(e, '::after'); return { hover: e.matches(':hover'), opacity: s.opacity, visibility: s.visibility, content: s.content }; })()`)));
  await shot('32-sections-360-term-hover.png');
}

// мобильные высоты и первые экраны
for (const p of ['tickets.html', 'sections.html', 'library.html', 'news.html', 'privacy.html', 'survey.html']) {
  await go(p, 2200);
  console.log(p, JSON.stringify(await cdp.eval(`(() => ({ scrollH: document.body.scrollHeight, screens: Math.round(document.body.scrollHeight / innerHeight * 10) / 10, textLen: document.body.innerText.length }))()`)));
}
process.exit(0);
