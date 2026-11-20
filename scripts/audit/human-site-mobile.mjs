// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-site-mobile.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Человеческий проход по всему сайту, 360×740.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', process.env.HUMAN_OUT || 'human-site-2026-11-13');
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
const PORT = 9352;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-m-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true, screenWidth: 360, screenHeight: 740 });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const go = async (p, settle = 2300) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };
const probe = async () => cdp.eval(`(() => {
  const vh = innerHeight;
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || !r.width || !r.height) return null; return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  const first = vis(document.querySelector('.lead, .menu-item, .practice-card, .quiz-card, #books-container .menu-item, .news-timeline > div, .ticket-viewer, .section-viewer, .mobile-tile-btn'));
  const banner = vis(document.getElementById('consent-banner'));
  const h1 = document.querySelector('h1')?.innerText;
  const leads = [...document.querySelectorAll('[data-lead-discipline]')];
  return {
    h1, vh, scrollH: document.body.scrollHeight, first, banner,
    tiles: document.querySelectorAll('.mobile-tile-btn').length,
    search: !!document.querySelector('#mobile-tickets-search, #mobile-search-input'),
    leads: leads.length,
    leadsInScreen: leads.filter((l) => l.getBoundingClientRect().bottom <= vh).length,
    disciplines: document.querySelectorAll('[data-discipline]').length,
    emptyDisciplines: document.querySelectorAll('[data-discipline][data-empty="1"]').length
  };
})()`);

const pages = [
  ['index.html', 'home'],
  ['tickets.html', 'tickets'],
  ['sections.html', 'sections'],
  ['cards.html', 'cards'],
  ['tests.html', 'tests'],
  ['library.html', 'library'],
  ['news.html', 'news'],
  ['practice.html', 'practice'],
  ['survey.html', 'survey'],
  ['privacy.html', 'privacy'],
  ['offline.html', 'offline'],
  ['404.html', '404']
];
const results = {};
for (const [p, key] of pages) {
  await go(p, 2200);
  results[key] = await probe();
  await shot(`10-${key}-360-top.png`);
  log(key, JSON.stringify(results[key]));
  // если контент ниже сгиба — проматываем к нему и снимаем
  if (results[key].first && results[key].first.top >= 740) {
    await cdp.eval(`(() => { const e = document.querySelector('.menu-item, .practice-card, .quiz-card, #books-container .menu-item, .ticket-viewer, .section-viewer, .mobile-tile-btn'); if (e) window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 60, behavior: 'auto' }); })()`);
    await sleep(350);
    await shot(`11-${key}-360-content.png`);
  }
  if (p === 'index.html') { await cdp.eval(`document.getElementById('consent-decline')?.click()`); await sleep(300); await shot('10-home-360-after-consent.png'); }
}
fs.writeFileSync(path.join(OUT, 'mobile.json'), JSON.stringify(results, null, 1));
// Гасим браузер через CDP: иначе он держит порт и следующий прогон подключается
// к старому профилю с кэшем прошлой версии страниц
cdp.send('Browser.close').catch(() => {});
await sleep(400);
process.exit(0);
