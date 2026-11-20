// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-practice2.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Второй человеческий проход: 360 с закрытым баннером, модалка ID, результат.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', 'human-review-2026-11-13');
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
}
const PORT = 9342;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'human2-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
const vp = (w, h, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: w, screenHeight: h });
const go = async (p, settle = 2300) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };

await vp(360, 740, true);
await go('practice.html', 2400);
await cdp.eval(`document.getElementById('consent-decline')?.click()`);
await sleep(400);
await shot('practice-360-05-entry-after-consent.png');
log('360 after consent', JSON.stringify(await cdp.eval(`(() => ({ banner: !!document.getElementById('consent-banner'), firstCardTop: Math.round(document.querySelector('.practice-card').getBoundingClientRect().top), progress: document.getElementById('practice-progress').innerText, levelsTop: Math.round(document.getElementById('practice-level-chips').getBoundingClientRect().top), levels: [...document.querySelectorAll('.practice-levels__chip')].map(c=>c.innerText.replace(/\\n/g,' ')), tiles: [...document.querySelectorAll('.practice-tile')].map(b=>b.innerText.replace(/\\n/g,' ')) }))()`)));

// модалка ID
await cdp.eval(`document.getElementById('btn-open-auth-modal').click()`);
await sleep(400);
await shot('practice-360-06-auth-modal.png');
log('AUTH 360', JSON.stringify(await cdp.eval(`(() => { const b = document.getElementById('research-auth-box'); const p = document.getElementById('research-auth-panel'); const r = p.getBoundingClientRect(); return { visible: getComputedStyle(b).display !== 'none', panelTop: Math.round(r.top), panelBottom: Math.round(r.bottom), vh: innerHeight, title: document.getElementById('research-auth-title').innerText, desc: p.querySelector('p').innerText, buttons: [...p.querySelectorAll('button')].map(x=>x.innerText), consentText: p.querySelector('label span').innerText.slice(0,160) }; })()`)));
await cdp.eval(`document.getElementById('btn-close-auth').click()`);
await sleep(300);

// к первому заданию
await cdp.eval(`document.querySelector('[data-practice-task]').click()`);
await sleep(700);
log('360 task after consent', JSON.stringify(await cdp.eval(`(() => { const r = (s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {top:Math.round(b.top),bottom:Math.round(b.bottom)}}; return { nav:r('[data-practice-back]'), next:r('[data-practice-next]'), title:r('.practice-task__title'), situation:r('.practice-task__block'), options:r('.practice-options'), check:r('[data-practice-check]'), scrollY:Math.round(scrollY) }; })()`)));
await shot('practice-360-07-task-top.png');
await cdp.eval(`document.querySelector('[data-practice-check]').scrollIntoView({ block: 'center' })`);
await sleep(300);
await shot('practice-360-08-task-check.png');
// отвечаем
await cdp.eval(`document.querySelector('#practice-task-view input[name="practice-choice"]').click(); document.querySelector('[data-practice-check]').click();`);
await sleep(800);
await shot('practice-360-09-result.png');
log('360 result', JSON.stringify(await cdp.eval(`(() => { const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {top:Math.round(b.top),bottom:Math.round(b.bottom)}}; return { next:r('[data-practice-next]'), back:r('[data-practice-back]'), result:r('[data-practice-result]'), guest: document.querySelector('[data-practice-guest-note]')?.innerText, scrollY:Math.round(scrollY) }; })()`)));

// 1366 модалка
await vp(1366, 768);
await go('practice.html', 2000);
await cdp.eval(`document.getElementById('btn-open-auth-modal').click()`);
await sleep(300);
await shot('practice-1366-10-auth-modal.png');
process.exit(0);
