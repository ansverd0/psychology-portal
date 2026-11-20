// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-site-desktop.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
// Человеческий проход по всему сайту, 1366×768.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', 'human-site-2026-11-13');
fs.mkdirSync(OUT, { recursive: true });
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
const PORT = 9351;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
const go = async (p, settle = 2300) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };
const full = async (name) => { const m = await cdp.send('Page.getLayoutMetrics'); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(m.cssContentSize.width), height: Math.ceil(m.cssContentSize.height), scale: 1 } }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };

const probe = async () => cdp.eval(`(() => {
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0) ? { top: Math.round(r.top), h: Math.round(r.height) } : null; };
  const texts = (sel, n = 6) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).slice(0, n).map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean);
  const banner = document.getElementById('consent-banner');
  return {
    title: document.title, h1: texts('h1', 1)[0] || null,
    h2s: texts('header h2, header p', 3),
    bodyTop: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 260),
    scrollH: document.body.scrollHeight, vh: innerHeight,
    banner: banner ? vis(banner) : null,
    buttons: texts('button', 8), links: [...document.querySelectorAll('a[href]')].filter((a) => a.offsetParent !== null).length,
    firstCard: vis(document.querySelector('.menu-item, .practice-card, .quiz-card, #books-container .menu-item, .news-card, .article-content, .ticket-viewer')),
    search: !!document.querySelector('input[type="search"], input[type="text"][placeholder*="Поиск"], #mobile-tickets-search, #mobile-search-input'),
    tiles: document.querySelectorAll('.mobile-tile-btn').length,
    vocab: document.querySelectorAll('h4').length
  };
})()`);

const pages = [
  ['index.html', 'home', 'home'],
  ['tickets.html', 'tickets', 'tickets'],
  ['sections.html', 'sections', 'sections'],
  ['cards.html', 'cards', 'cards'],
  ['tests.html', 'tests', 'tests'],
  ['library.html', 'library', 'library'],
  ['news.html', 'news', 'news'],
  ['practice.html', 'practice', 'practice'],
  ['survey.html', 'survey', 'survey'],
  ['privacy.html', 'privacy', 'privacy'],
  ['offline.html', 'offline', 'offline'],
  ['404.html', '404', '404']
];

// главная: первый визит с баннером
await go('index.html', 2600);
log('HOME first', JSON.stringify(await probe()));
await shot('01-home-1366-with-banner.png');
await full('01-home-1366-full.png');
// закрываем баннер как человек
await cdp.eval(`document.getElementById('consent-decline')?.click()`);
await sleep(400);

const results = {};
for (const [p, file, key] of pages) {
  if (p === 'index.html') { await shot('02-home-1366-clean.png'); results[key] = await probe(); continue; }
  await go(p, 2400);
  results[key] = await probe();
  await shot(`03-${file}-1366.png`);
  if (['tickets', 'sections', 'library', 'news', 'privacy'].includes(key)) await full(`03-${file}-1366-full.png`);
  log(p, JSON.stringify(results[key]));
}
fs.writeFileSync(path.join(OUT, 'desktop.json'), JSON.stringify(results, null, 1));
process.exit(0);
