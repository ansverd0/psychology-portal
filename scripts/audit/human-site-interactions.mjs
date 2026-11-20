// Запуск: сначала статический сервер (python -m http.server 8767 --bind 127.0.0.1),
// затем node scripts/audit/human-site-interactions.mjs. База — APP_BASE, Chrome — CHROME_PATH, снимки — .audit/.
﻿// РРЅС‚РµСЂР°РєС†РёРё РїРѕ РІСЃРµРјСѓ СЃР°Р№С‚Сѓ: Р±РёР»РµС‚С‹, РїРѕРёСЃРє, СЃС‚Р°С‚СЊРё, РєР°СЂС‚РѕС‡РєРё, С‚РµСЃС‚С‹, РѕС„Р»Р°Р№РЅ, 404.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:8767';
const OUT = path.join(ROOT, '.audit', 'human-site-2026-11-13');
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
const PORT = 9353;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'site-i-'));
spawn((process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const cdp = await CDP.connect(t.webSocketDebuggerUrl);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
const vp = (w, h, mobile = false) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: w, screenHeight: h });
const go = async (p, settle = 2400) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: `${BASE}/${p}` }); await l; await sleep(settle); };
const shot = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64')); };
const rect = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; })()`;

// --- 360: Р±РёР»РµС‚С‹, РіРґРµ РЅР°С‡РёРЅР°РµС‚СЃСЏ С‚РµРєСЃС‚ ---
await vp(360, 740, true);
await go('tickets.html', 2600);
const ticketsTel = await cdp.eval(`(() => ({ tiles: document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn').length, viewer: ${rect('.ticket-viewer')}, viewerTitle: document.querySelector('.ticket-viewer h2')?.innerText, listTilesBottom: Math.round(document.querySelector('#mobile-tickets-tiles').getBoundingClientRect().bottom), questionsDisplay: getComputedStyle(document.getElementById('mobile-questions-list')).display, scrollH: document.body.scrollHeight }))()`);
log('TICKETS 360', JSON.stringify(ticketsTel));
await shot('20-tickets-360-top.png');
await cdp.eval(`window.scrollTo({ top: document.querySelector('.ticket-viewer').getBoundingClientRect().top + scrollY - 60, behavior: 'auto' })`);
await sleep(400);
await shot('21-tickets-360-text.png');

// --- РїРѕРёСЃРє В«РїСЃРёС…РёРєР°В» ---
await cdp.eval(`window.scrollTo(0,0)`);
await sleep(200);
const search = await cdp.eval(`(async () => {
  const i = document.getElementById('mobile-tickets-search'); i.focus(); i.value = 'РїСЃРёС…РёРєР°'; i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const b = document.getElementById('mobile-tickets-search-results');
  return { hidden: b.hidden, text: b.innerText.trim().slice(0, 80) };
})()`);
log('SEARCH 360', JSON.stringify(search));
await shot('22-tickets-360-search.png');

// --- СЃС‚Р°С‚СЊРё: РѕС‚РєСЂС‹С‚СЊ РїРµСЂРІСѓСЋ Рё РєР»РёРєРЅСѓС‚СЊ С‚РµСЂРјРёРЅ ---
await vp(1366, 768, false);
await go('sections.html', 2600);
const artBefore = await cdp.eval(`(() => ({ tiles: document.querySelectorAll('.mobile-tile-btn').length, folders: document.querySelectorAll('#sections-folders-col button').length, viewer: ${rect('.section-viewer')}, firstTitle: document.querySelector('.section-viewer h2, .section-viewer h3')?.innerText }))()`);
log('SECTIONS before', JSON.stringify(artBefore));
if (!artBefore.firstTitle) {
  await cdp.eval(`document.querySelector('#sections-articles-col button, .article-nav-btn')?.click()`);
  await sleep(700);
}
const art = await cdp.eval(`(() => ({ title: document.querySelector('.section-viewer h2, .section-viewer h3')?.innerText, chars: document.querySelector('.section-viewer')?.innerText.length, h4: document.querySelectorAll('.section-viewer h4').length, wiki: document.querySelectorAll('.wiki-term').length, questions: /РљРѕРЅС‚СЂРѕР»СЊРЅС‹Рµ РІРѕРїСЂРѕСЃС‹/i.test(document.querySelector('.section-viewer')?.innerText || '') }))()`);
log('ARTICLE', JSON.stringify(art));
await shot('23-sections-1366-article.png');
// РєР»РёРє РїРѕ С‚РµСЂРјРёРЅСѓ
const tip = await cdp.eval(`(async () => {
  const w = document.querySelector('.wiki-term');
  if (!w) return { none: true };
  w.click();
  await new Promise((r) => setTimeout(r, 500));
  const tip = document.querySelector('.wiki-tooltip, [role="tooltip"], .term-tooltip');
  return { clicked: w.innerText, tip: tip ? tip.innerText.slice(0, 160) : null, visible: tip ? getComputedStyle(tip).display !== 'none' : false };
})()`);
log('WIKI', JSON.stringify(tip));
await shot('24-sections-1366-term.png');

// --- РєР°СЂС‚РѕС‡РєРё: РїРµСЂРµРІРµСЂРЅСѓС‚СЊ, РґР°Р»СЊС€Рµ, РїРµСЂРµР·Р°РіСЂСѓР·РєР° ---
await go('cards.html', 2200);
const card1 = await cdp.eval(`({ term: document.getElementById('term-text')?.innerText, counter: document.getElementById('counter-text')?.innerText, flipped: document.getElementById('myCard')?.classList.contains('flipped') })`);
await cdp.eval(`document.getElementById('myCard').click()`);
await sleep(300);
const card2 = await cdp.eval(`({ counter: document.getElementById('counter-text')?.innerText, flipped: document.getElementById('myCard')?.classList.contains('flipped'), definition: document.getElementById('definition-text')?.innerText?.slice(0, 80) })`);
await cdp.eval(`document.getElementById('next-btn').click()`);
await sleep(300);
const card3 = await cdp.eval(`({ counter: document.getElementById('counter-text')?.innerText, term: document.getElementById('term-text')?.innerText })`);
await shot('25-cards-1366.png');
const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload'); await l; await sleep(2000);
const card4 = await cdp.eval(`({ counter: document.getElementById('counter-text')?.innerText, term: document.getElementById('term-text')?.innerText, ls: Object.keys(localStorage).filter((k) => k.includes('card')) })`);
log('CARDS', JSON.stringify({ card1, card2, card3, afterReload: card4 }));

// --- С‚РµСЃС‚С‹: РѕС‚РІРµС‚ Рё СЂРµР·СѓР»СЊС‚Р°С‚ ---
await go('tests.html', 2200);
const test1 = await cdp.eval(`(async () => {
  const sel = document.getElementById('quiz-limit-select'); sel.value = '5'; sel.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 300));
  const q = document.getElementById('quiz-question').innerText;
  const opts = [...document.querySelectorAll('#quiz-options .option-btn')];
  opts[0].click();
  await new Promise((r) => setTimeout(r, 300));
  const review = document.querySelector('.review-theme-btn');
  return { question: q, options: opts.map((o) => o.innerText), classes: opts.map((o) => o.className), explanation: !!document.querySelector('.explanation'), review: review ? review.innerText : null };
})()`);
log('TEST after answer', JSON.stringify(test1));
await shot('26-tests-1366-answered.png');

// --- Р±РёР±Р»РёРѕС‚РµРєР° Рё РЅРѕРІРѕСЃС‚Рё ---
await go('library.html', 2200);
log('LIBRARY', JSON.stringify(await cdp.eval(`({ cards: document.querySelectorAll('#books-container .menu-item').length, search: !!document.querySelector('input'), buttons: document.querySelectorAll('button').length, scrollH: document.body.scrollHeight, first: document.querySelector('#books-container .menu-item h2')?.innerText })`)));
await shot('27-library-1366.png');
await go('news.html', 2200);
log('NEWS', JSON.stringify(await cdp.eval(`({ entries: document.querySelectorAll('#news-timeline > div').length, firstDate: document.querySelector('#news-timeline > div div')?.innerText, firstTitle: document.querySelector('#news-timeline h2')?.innerText, scrollH: document.body.scrollHeight })`)));
await shot('28-news-1366.png');

// --- 404 РЅР° Р¶РёРІРѕРј СЃР°Р№С‚Рµ ---
const live = cdp.once('Page.loadEventFired', 30000);
await cdp.send('Page.navigate', { url: 'https://ansverd0.github.io/psychology-portal/no-such-page-abc' });
await live; await sleep(1200);
log('LIVE404', JSON.stringify(await cdp.eval(`({ title: document.title, h1: document.querySelector('h1')?.innerText, link: document.querySelector('a')?.innerText, href: document.querySelector('a')?.href })`)));
await shot('29-404-live-1366.png');

// --- РѕС„Р»Р°Р№РЅ: РїСЂРѕРіСЂРµС‚СЊ РєСЌС€ Рё РѕС‚РєР»СЋС‡РёС‚СЊ СЃРµС‚СЊ ---
await go('tickets.html', 3000);
await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await sleep(500);
const offLoaded = cdp.once('Page.loadEventFired', 20000).catch(() => null);
await cdp.send('Page.navigate', { url: `${BASE}/tickets.html` });
await offLoaded; await sleep(3000);
const offline = await cdp.eval(`({ title: document.title, h1: document.querySelector('h1')?.innerText, banner: document.getElementById('offline-hub-notification')?.innerText || null, viewer: document.querySelector('.ticket-viewer h2')?.innerText || null, textLen: document.querySelector('.ticket-viewer')?.innerText.length || 0 })`);
log('OFFLINE', JSON.stringify(offline));
await shot('30-tickets-360-offline.png');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
process.exit(0);

