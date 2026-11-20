// UI-аудит: скриншоты 12 страниц × 4 ширины + замеры дизайн-системы.
// Только чтение проекта. Пишет в .audit/<AUDIT_OUT>/ (по умолчанию ui-audit-latest).
//
//   node scripts/audit/ui-audit.mjs
//   node scripts/audit/ui-audit.mjs --only=index,tickets --widths=390,1440
//   $env:AUDIT_OUT='ui2-s1-after'; node scripts/audit/ui-audit.mjs
//
// Chrome ищется в CHROME_PATH, затем в стандартных путях Chrome/Edge.
// Сервер поднимается сам на свободном порту — внешний не нужен.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.audit', process.env.AUDIT_OUT || 'ui-audit-latest');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['index.html', 'index', null],
  ['tickets.html', 'tickets', 'document.querySelector(".folder-nav-btn")'],
  ['sections.html', 'sections', 'document.querySelector(".folder-nav-btn")'],
  ['cards.html', 'cards', '(() => { const t = document.getElementById("term-text"); return t && !/Загрузка/.test(t.textContent); })()'],
  ['tests.html', 'tests', '(() => { const q = document.getElementById("quiz-question"); return q && !/Загрузка/.test(q.textContent) && document.querySelectorAll("#quiz-options button").length > 0; })()'],
  ['library.html', 'library', 'document.querySelectorAll("#books-container .menu-item").length > 0'],
  ['news.html', 'news', 'document.querySelectorAll("#news-timeline > div").length > 0'],
  ['privacy.html', 'privacy', null],
  ['survey.html', 'survey', 'document.getElementById("survey-app") && document.getElementById("survey-app").innerText.trim().length > 30'],
  ['practice.html', 'practice', 'document.querySelectorAll("[data-practice-task]").length > 0'],
  ['offline.html', 'offline', null],
  ['404.html', '404', null]
];

const WIDTHS = [[390, 844, true], [768, 1024, true], [1024, 768, false], [1440, 900, false]];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function findChrome() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
  const f = c.find((p) => fs.existsSync(p));
  if (!f) throw new Error('Chrome не найден');
  return f;
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); } }, 90000);
    });
  }
  once(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('event timeout ' + method)), timeout);
      const fn = (params) => { clearTimeout(timer); this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn)); resolve(params); };
      this.listeners.set(method, (this.listeners.get(method) || []).concat(fn));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.exceptionDetails) throw new Error('eval: ' + (res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails)));
    return res.result.value;
  }
}

async function closeChromeViaCdp(port) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(600);
    try { ws.close(); } catch { /* уже закрыт */ }
    return true;
  } catch { return false; }
}

async function launchChrome(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-'));
  const child = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return { child, profile }; } catch { /* ещё стартует */ }
    await sleep(250);
  }
  child.kill();
  throw new Error('Chrome не стартовал на порту ' + port);
}

async function openPage(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await r.json();
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  return cdp;
}

const setViewport = (cdp, width, height, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: mobile ? 2 : 1, mobile, screenWidth: width, screenHeight: height
});

async function goto(cdp, base, page, settle = 1200) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${base}/${page}` });
  await loaded;
  await sleep(settle);
}

async function waitFor(cdp, cond, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await cdp.eval(`Boolean(${cond})`)) return true; } catch { /* перезагрузка */ }
    await sleep(250);
  }
  return false;
}

async function shot(cdp, name, full = false) {
  const params = { format: 'png' };
  if (full) {
    const { contentSize } = await cdp.send('Page.getLayoutMetrics');
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: Math.ceil(contentSize.width), height: Math.min(Math.ceil(contentSize.height), 14000), scale: 1 };
  }
  const { data } = await cdp.send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
}

// --- Замер страницы (выполняется в браузере) --------------------------------
function measure() {
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.getClientRects().length > 0;
  };
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) }; };
  const nameOf = (el) => {
    const t = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return (el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (t ? ' «' + t + '»' : '')).slice(0, 80);
  };
  const parseColor = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2); };
  const bgOf = (el) => {
    let e = el;
    while (e && e !== document.documentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') return { c: { r: 255, g: 255, b: 255, a: 1 }, src: 'gradient', gradient: true };
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0.95) return { c, src: e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(/\s+/)[0] : ''), gradient: false };
      e = e.parentElement;
    }
    return { c: { r: 255, g: 255, b: 255, a: 1 }, src: 'default-white', gradient: false };
  };

  const out = { vw: innerWidth, vh: innerHeight };
  out.docH = Math.round(document.documentElement.scrollHeight);
  out.scrollW = Math.round(document.documentElement.scrollWidth);
  out.overflowX = out.scrollW - innerWidth;

  const header = document.querySelector('header');
  const main = document.querySelector('main');
  out.header = header ? Object.assign(R(header), { share: null, html: header.innerHTML.replace(/\s+/g, ' ').slice(0, 400) }) : null;
  if (header) {
    const hs = getComputedStyle(header);
    out.header.share = +(R(header).h / innerHeight).toFixed(3);
    out.header.textAlign = hs.textAlign;
    out.header.cssWidth = Math.round(header.clientWidth);
    out.header.parts = ['a.capsule-back-btn', 'h1', 'p', 'h2'].map((s) => {
      const el = header.querySelector(s);
      if (!el || !vis(el)) return null;
      const cs = getComputedStyle(el);
      return { s, size: cs.fontSize, lh: cs.lineHeight, weight: cs.fontWeight, margin: cs.margin, h: Math.round(R(el).h), w: Math.round(R(el).w), x: Math.round(R(el).x) };
    }).filter(Boolean);
  }
  out.main = main ? R(main) : null;
  const stage = document.querySelector('.tri-column-layout, .content-with-sidebar, .menu-grid, main');
  out.contentStart = stage ? R(stage).y : null;

  // Что торчит за правый край (body{overflow-x:clip} прячет, но режет)
  out.overflowers = [...document.querySelectorAll('body *')].filter((el) => {
    if (!vis(el)) return false;
    const r = el.getBoundingClientRect();
    return r.right > innerWidth + 1 && r.width > 4;
  }).slice(0, 10).map((el) => ({ sel: nameOf(el), right: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width) }));

  // Первый экран: что реально видно
  if (document.body.dataset.page === 'index') {
    const tiles = [...document.querySelectorAll('.menu-item')].filter(vis).map((el) => {
      const r = R(el);
      return { t: (el.querySelector('h2') || el).innerText.trim().slice(0, 40), top: r.y, bottom: r.b, visible: r.y < innerHeight };
    });
    out.firstScreen = { tiles, visibleTiles: tiles.filter((t) => t.visible).length, docH: out.docH };
  }
  const banner = document.getElementById('consent-banner');
  if (banner && vis(banner)) {
    const br = R(banner);
    const fab = document.getElementById('bookmarks-fab');
    const fr = fab && vis(fab) ? R(fab) : null;
    const overlap = fr ? Math.max(0, Math.min(br.b, fr.b) - Math.max(br.y, fr.y)) * Math.max(0, Math.min(br.r, fr.r) - Math.max(br.x, fr.x)) : 0;
    out.consent = { y: br.y, b: br.b, h: br.h, share: +(br.h / innerHeight).toFixed(3), fabOverlap: overlap };
  }

  const h1 = document.querySelector('h1');
  if (h1) { const s = getComputedStyle(h1); out.h1 = { text: h1.innerText.trim().slice(0, 80), size: s.fontSize, lh: s.lineHeight, weight: s.fontWeight, ls: s.letterSpacing, color: s.color, rect: R(h1) }; }

  out.headings = [...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map((h) => {
    const s = getComputedStyle(h);
    return { tag: h.tagName, size: s.fontSize, lh: s.lineHeight, weight: s.fontWeight, color: s.color, text: h.innerText.trim().replace(/\s+/g, ' ').slice(0, 48), x: Math.round(R(h).x) };
  });

  // Шкала кеглей по фактически видимому тексту
  const scale = new Map();
  [...document.querySelectorAll('body *')].filter(vis).forEach((el) => {
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!direct) return;
    const s = getComputedStyle(el);
    const size = s.fontSize;
    if (!scale.has(size)) scale.set(size, { count: 0, sample: [] });
    const e = scale.get(size); e.count += 1;
    if (e.sample.length < 3) e.sample.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''));
  });
  out.fontScale = [...scale.entries()].map(([size, v]) => ({ size, count: v.count, sample: v.sample })).sort((a, b) => parseFloat(b.size) - parseFloat(a.size));

  // Текст конспекта: ширина строки и знаков в строке
  const pick = document.querySelector('.ticket-viewer .content-text, .section-viewer .content-text, .content-text')
    || document.querySelector('#news-timeline ul li')
    || document.querySelector('.privacy-content p')
    || document.querySelector('.menu-item p')
    || document.querySelector('#term-text');
  if (pick && vis(pick)) {
    const s = getComputedStyle(pick);
    const p = pick.querySelector('p') || pick;
    const cs = getComputedStyle(p);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600) || 'пример текста конспекта';
    const avg = ctx.measureText(text).width / text.length;
    out.contentText = {
      sel: nameOf(pick), width: Math.round(p.clientWidth), fontSize: cs.fontSize, lh: cs.lineHeight,
      align: cs.textAlign, hyphens: cs.hyphens, chars: text.length,
      charsPerLine: Math.round(p.clientWidth / avg), avgCharW: +avg.toFixed(2),
      insideFrame: pick.closest('.ticket-viewer') ? Math.round(pick.closest('.ticket-viewer').clientWidth) : null
    };
  }

  // Внутренние скроллы (scroll в scroll)
  out.innerScrollers = [...document.querySelectorAll('body *')].filter((el) => {
    if (!vis(el)) return false;
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 6 && el.clientHeight > 0 && el.clientHeight < innerHeight * 0.9;
  }).slice(0, 8).map((el) => ({ sel: nameOf(el), clientH: el.clientHeight, scrollH: el.scrollHeight, w: Math.round(R(el).w) }));

  // Кегль < 12 px
  out.tiny = [...document.querySelectorAll('body *')].filter((el) => {
    if (!vis(el)) return false;
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    return direct && parseFloat(getComputedStyle(el).fontSize) < 12;
  }).slice(0, 12).map((el) => ({ sel: nameOf(el), size: getComputedStyle(el).fontSize }));

  // Цели нажатия
  const targets = [];
  [...document.querySelectorAll('a, button, [role="button"], input, select, textarea, label.bookmark-star-btn')].filter(vis).forEach((el) => {
    const r = R(el);
    if (r.w === 0 || r.h === 0) return;
    const s = getComputedStyle(el);
    const inlineLink = el.tagName === 'A' && s.display === 'inline' && (s.lineHeight === 'normal' || parseFloat(s.lineHeight) < 30);
    if (r.w < 44 || r.h < 44) targets.push({ sel: nameOf(el), w: r.w, h: r.h, inline: inlineLink });
  });
  out.smallTargets = targets.slice(0, 20);
  out.smallCount = targets.length;

  // Панель кнопок: варианты оформления
  const btnSel = 'button, .mobile-tile-btn, .capsule-back-btn, .menu-item, .practice-btn, .option-btn, .ticket-nav-btn, .folder-nav-btn, .bookmarks-fab, .nav-bookmarks-btn';
  const variants = new Map();
  [...document.querySelectorAll(btnSel)].filter(vis).forEach((el) => {
    const s = getComputedStyle(el);
    const key = [s.backgroundColor, s.color, s.borderRadius, s.padding, s.fontSize, s.fontWeight, s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor, s.minHeight, s.boxShadow === 'none' ? '-' : 'shadow'].join(' | ');
    if (!variants.has(key)) variants.set(key, { count: 0, sample: [] });
    const v = variants.get(key); v.count += 1;
    if (v.sample.length < 2) v.sample.push(nameOf(el));
  });
  out.buttonVariants = [...variants.entries()].map(([k, v]) => ({ key: k, count: v.count, sample: v.sample })).sort((a, b) => b.count - a.count);

  // Контраст: худшие пары
  const contrasts = [];
  [...document.querySelectorAll('body *')].filter(vis).forEach((el) => {
    const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!direct) return;
    const s = getComputedStyle(el);
    const fg = parseColor(s.color);
    if (!fg || fg.a < 0.5) return;
    const bg = bgOf(el);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
    const cr = ratio(fg, bg.c);
    const need = large ? 3 : 4.5;
    contrasts.push({
      sel: nameOf(el), size: s.fontSize, weight: s.fontWeight,
      fg: s.color, bg: bg.src, bgColor: `rgb(${bg.c.r}, ${bg.c.g}, ${bg.c.b})`,
      ratio: cr, need, pass: cr >= need, gradient: bg.gradient,
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    });
  });
  out.contrastFails = contrasts.filter((c) => !c.pass).sort((a, b) => a.ratio - b.ratio).slice(0, 14);
  out.contrastTotal = contrasts.length;
  out.contrastFailCount = contrasts.filter((c) => !c.pass).length;

  // Интерактив: сколько и в каком порядке
  const focusables = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(vis);
  out.focusables = focusables.length;
  out.focusFirst10 = focusables.slice(0, 10).map(nameOf);

  // Фокусное кольцо
  const ring = [];
  for (const el of focusables.slice(0, 24)) {
    try {
      el.focus({ preventScroll: true });
      const s = getComputedStyle(el);
      const focused = document.activeElement === el;
      ring.push({
        sel: nameOf(el), focused, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        boxShadow: s.boxShadow === 'none' ? '-' : 'shadow',
        visible: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
      });
    } catch (e) { /* не фокусируется */ }
  }
  out.focusRings = ring;
  out.focusNoRing = ring.filter((r) => r.focused && !r.visible).slice(0, 10);
  document.activeElement && document.activeElement.blur && document.activeElement.blur();

  return out;
}

// --- Спец-замеры -------------------------------------------------------------
const MEASURE_EXTRA = {
  // Панель закладок: открыть на телефоне
  async bookmarks(cdp) {
    const open = await cdp.eval(`(() => { const b = document.getElementById('bookmarks-fab'); if (!b || getComputedStyle(b).display === 'none') return false; b.click(); return true; })()`);
    await sleep(400);
    const state = await cdp.eval(`(() => {
      const m = document.querySelector('.bookmarks-modal');
      const bodyOv = getComputedStyle(document.body).overflow;
      const panel = document.querySelector('.bookmarks-modal__panel');
      const close = document.querySelector('.bookmarks-modal__close');
      return { open: m ? !m.hidden : false, hidden: m ? m.hidden : null, bodyOverflow: bodyOv,
        panel: panel ? { w: Math.round(panel.getBoundingClientRect().width), h: Math.round(panel.getBoundingClientRect().height) } : null,
        closeSize: close ? { w: Math.round(close.getBoundingClientRect().width), h: Math.round(close.getBoundingClientRect().height) } : null,
        role: m ? m.getAttribute('role') : null, ariaModal: m ? m.getAttribute('aria-modal') : null };
    })()`);
    const focusedInside = await cdp.eval(`(() => { const m = document.querySelector('.bookmarks-modal'); return m ? m.contains(document.activeElement) : false; })()`);
    return Object.assign(state, { opened: open, focusInside: focusedInside });
  },
  async authModal(cdp) {
    const open = await cdp.eval(`(() => { const b = document.getElementById('btn-open-auth-modal'); if (!b) return false; b.click(); return true; })()`);
    await sleep(500);
    const state = await cdp.eval(`(() => {
      const m = document.getElementById('research-auth-box');
      if (!m) return { open: false };
      const p = document.getElementById('research-auth-panel');
      const close = document.getElementById('btn-close-auth');
      const bodyOv = getComputedStyle(document.body).overflow;
      return { open: getComputedStyle(m).display !== 'none', panel: p ? { w: Math.round(p.getBoundingClientRect().width), h: Math.round(p.getBoundingClientRect().height) } : null,
        bodyOverflow: bodyOv, focusInside: m.contains(document.activeElement),
        closeSize: close ? { w: Math.round(close.getBoundingClientRect().width), h: Math.round(close.getBoundingClientRect().height) } : null,
        role: m.getAttribute('role'), ariaModal: m.getAttribute('aria-modal'), labelled: m.getAttribute('aria-labelledby') };
    })()`);
    // Esc
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
    const afterEsc = await cdp.eval(`(() => { const m = document.getElementById('research-auth-box'); return { display: getComputedStyle(m).display, active: document.activeElement ? document.activeElement.id || document.activeElement.className : null }; })()`);
    return Object.assign(state, { opened: open, afterEsc });
  },
  // Таб-порядок
  async tabOrder(cdp, base) {
    const order = [];
    await cdp.eval(`document.body.focus(); document.activeElement && document.activeElement.blur(); window.scrollTo(0,0);`);
    for (let i = 0; i < 14; i++) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await sleep(90);
      order.push(await cdp.eval(`(() => {
        const el = document.activeElement; if (!el || el === document.body) return 'BODY';
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const cls = typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean).slice(0,2).join('.') : '';
        return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' | outline=' + s.outlineStyle + ' ' + s.outlineWidth + ' | y=' + Math.round(r.y) + ' h=' + Math.round(r.height) + ' | ' + (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g,' ').slice(0,28);
      })()`));
    }
    return order;
  },
  async reducedMotion(cdp) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(300);
    const r = await cdp.eval(`(() => ({ animations: document.getAnimations().filter(a => a.playState === 'running').length, scroll: getComputedStyle(document.documentElement).scrollBehavior, bodyScroll: getComputedStyle(document.body).scrollBehavior }))()`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    return r;
  },
  async forcedColors(cdp) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await sleep(300);
    const r = await cdp.eval(`(() => { const h = document.querySelector('h1'); const b = document.querySelector('.menu-item, .ticket-nav-btn, button'); return { h1: h ? getComputedStyle(h).color : null, btn: b ? getComputedStyle(b).backgroundColor + ' / ' + getComputedStyle(b).color : null, forced: matchMedia('(forced-colors: active)').matches }; })()`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    return r;
  }
};

// --- Прогон ------------------------------------------------------------------
const argv = process.argv.slice(2);
const onlyArg = (argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const widthsArg = (argv.find((a) => a.startsWith('--widths=')) || '').slice(9);
const onlyPages = onlyArg ? onlyArg.split(',').map((s) => s.trim()) : null;
const onlyWidths = widthsArg ? widthsArg.split(',').map((s) => Number(s.trim())) : null;

fs.mkdirSync(OUT, { recursive: true });

const local = await startServer();
const base = `http://127.0.0.1:${local.port}`;
const devtoolsPort = 9400 + (process.pid % 300);
const { child, profile } = await launchChrome(devtoolsPort);
const report = { base, startedAt: new Date().toISOString(), runs: [], states: {}, keyboard: {}, special: {} };

try {
  const cdp = await openPage(devtoolsPort);
  for (const [page, key, waitCond] of PAGES) {
    if (onlyPages && !onlyPages.includes(key)) continue;
    for (const [w, h, mob] of WIDTHS) {
      if (onlyWidths && !onlyWidths.includes(w)) continue;
      await setViewport(cdp, w, h, mob);
      await goto(cdp, base, page, 900);
      if (waitCond) await waitFor(cdp, waitCond, 15000);
      await sleep(600);
      await shot(cdp, `${key}-${w}-top.png`);
      await shot(cdp, `${key}-${w}-full.png`, true);
      let m = null;
      try { m = await cdp.eval(`(${measure.toString()})()`); } catch (e) { m = { error: e.message }; }
      report.runs.push({ page: key, w, h, mobile: mob, m });
      process.stdout.write(`. ${key} ${w}  docH=${m.docH} ovf=${m.overflowX} hdr=${m.header ? m.header.h : '-'} chars=${m.contentText ? m.contentText.charsPerLine : '-'}\n`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(report, null, 2));

  const openFirstTicket = async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await waitFor(cdp, 'document.querySelector(".folder-nav-btn")', 20000);
      if (!ok) { await sleep(1500); continue; }
      await cdp.eval(`document.querySelector('.folder-nav-btn').click()`);
      const ok2 = await waitFor(cdp, 'document.querySelector(".ticket-nav-btn")', 15000);
      if (!ok2) { await sleep(1500); continue; }
      await cdp.eval(`document.querySelector('.ticket-nav-btn').click()`);
      await sleep(1200);
      return true;
    }
    return false;
  };

  // Состояния интерфейса
  const states = {};
  try {
  await setViewport(cdp, 390, 844, true);
  await goto(cdp, base, 'index.html', 1500);
  await shot(cdp, 'state-index-390-consent.png');
  states.consent = await cdp.eval(`(() => { const b = document.getElementById('consent-banner'); if (!b || getComputedStyle(b).display === 'none') return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), share: +(r.height / innerHeight).toFixed(3), text: b.innerText.replace(/\\s+/g,' ').slice(0, 120) }; })()`);
  states.auth390 = await MEASURE_EXTRA.authModal(cdp);
  await shot(cdp, 'state-index-390-auth.png');
  await goto(cdp, base, 'index.html', 800);
  await setViewport(cdp, 1440, 900, false);
  await goto(cdp, base, 'index.html', 1200);
  states.auth1440 = await MEASURE_EXTRA.authModal(cdp);
  await shot(cdp, 'state-index-1440-auth.png');
  await goto(cdp, base, 'index.html', 800);
  await cdp.eval(`window.showToast && window.showToast('Сохранено: билет №12', { type: 'success' })`);
  await cdp.eval(`window.showToast && window.showToast('Не удалось загрузить материалы. Проверьте соединение.', { type: 'error', timeout: 20000 })`);
  await sleep(500);
  await shot(cdp, 'state-index-1440-toast.png');

  await setViewport(cdp, 390, 844, true);
  await goto(cdp, base, 'tickets.html', 1200);
  states.opened390 = await openFirstTicket();
  states.bookmarks390 = await MEASURE_EXTRA.bookmarks(cdp);
  await shot(cdp, 'state-tickets-390-bookmarks.png');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  states.bookmarksAfterEsc = await cdp.eval(`(() => { const m = document.querySelector('.bookmarks-modal'); return { hidden: m ? m.hidden : null, bodyOverflow: getComputedStyle(document.body).overflow, focus: document.activeElement ? (document.activeElement.id || document.activeElement.className) : null }; })()`);
  await shot(cdp, 'state-tickets-390-text.png');
  states.tickets390 = await cdp.eval(`(() => {
    const v = document.querySelector('.ticket-viewer'); const h = document.querySelector('header');
    const q = document.querySelector('.tickets-questions-column');
    return { headerH: Math.round(h.getBoundingClientRect().height), viewerTop: Math.round(v.getBoundingClientRect().top),
      viewerH: Math.round(v.getBoundingClientRect().height), docH: Math.round(document.documentElement.scrollHeight),
      questionList: q ? { clientH: q.clientHeight, scrollH: q.scrollHeight, w: Math.round(q.getBoundingClientRect().width) } : null,
      nextButton: !!document.querySelector('#next-question-btn, .next-ticket-btn, [data-next-ticket]') };
  })()`);

  // Поиск с результатами
  await goto(cdp, base, 'tickets.html', 700);
  await cdp.eval(`(() => { const s = document.querySelector('#mobile-tickets-search'); if (!s) return; s.focus(); s.value = 'психика'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(900);
  states.search = await cdp.eval(`(() => { const d = document.querySelector('#mobile-tickets-search + .search-results-dropdown, .search-results-dropdown'); if (!d) return null; const r = d.getBoundingClientRect(); return { hidden: d.hidden, h: Math.round(r.height), text: d.innerText.replace(/\\s+/g,' ').slice(0, 160) }; })()`);
  await shot(cdp, 'state-tickets-390-search.png');

  // Ошибка сети: блокируем Supabase
  await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
  await goto(cdp, base, 'tickets.html', 800);
  await sleep(9000);
  states.netError = await cdp.eval(`(() => { const e = document.querySelector('.load-error, .cloud-notice'); if (!e) return null; const r = e.getBoundingClientRect(); return { cls: e.className, h: Math.round(r.height), text: e.innerText.replace(/\\s+/g,' ').slice(0, 180) }; })()`);
  await shot(cdp, 'state-tickets-390-error.png');
  await cdp.send('Network.setBlockedURLs', { urls: [] });

  // Печать билета
  await setViewport(cdp, 1024, 1200, false);
  await goto(cdp, base, 'tickets.html', 1200);
  states.openedPrint = await openFirstTicket();
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(500);
  report.special.print = await cdp.eval(`(() => {
    const vis = (el) => el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    return { header: vis(document.querySelector('header')), nav: vis(document.querySelector('.nav-left')), footer: vis(document.querySelector('.site-footer')),
      fab: vis(document.querySelector('#bookmarks-fab')), viewer: vis(document.querySelector('.ticket-viewer')),
      textLen: (document.querySelector('.ticket-viewer .content-text') || {}).innerText ? document.querySelector('.ticket-viewer .content-text').innerText.length : 0,
      bodyBg: getComputedStyle(document.body).backgroundColor };
  })()`);
  await shot(cdp, 'state-tickets-print.png', true);
  await cdp.send('Emulation.setEmulatedMedia', { media: '' });

  // 200% zoom = ширина 720 на 1440 экране
  await setViewport(cdp, 720, 450, false);
  await goto(cdp, base, 'tickets.html', 900);
  await waitFor(cdp, 'document.querySelector(".folder-nav-btn")', 10000);
  report.special.zoom200 = await cdp.eval(`(() => ({ vw: innerWidth, overflowX: document.documentElement.scrollWidth - innerWidth, docH: document.documentElement.scrollHeight,
    h1: getComputedStyle(document.querySelector('h1')).fontSize, h1Rect: Math.round(document.querySelector('h1').getBoundingClientRect().height),
    headerH: Math.round(document.querySelector('header').getBoundingClientRect().height) }))()`);
  await shot(cdp, 'state-tickets-720-zoom200.png');

  // Клавиатура
  for (const [page, key] of [['index.html', 'index'], ['tickets.html', 'tickets']]) {
    for (const [w, h, mob] of [[390, 844, true], [1440, 900, false]]) {
      await setViewport(cdp, w, h, mob);
      await goto(cdp, base, page, 1200);
      if (page === 'tickets.html') await waitFor(cdp, 'document.querySelector(".folder-nav-btn")', 10000);
      report.keyboard[`${key}-${w}`] = await MEASURE_EXTRA.tabOrder(cdp, base);
      report.keyboard[`${key}-${w}-reduced`] = await MEASURE_EXTRA.reducedMotion(cdp);
      report.keyboard[`${key}-${w}-forced`] = await MEASURE_EXTRA.forcedColors(cdp);
    }
  }
  } catch (e) {
    report.statesError = e.message;
    console.warn('⚠️ состояния не сняты:', e.message);
  }
  report.states = states;
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(report, null, 2));
  console.log('\nГотово:', path.join(OUT, 'measure.json'), 'прогонов:', report.runs.length);
} finally {
  try { fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(report, null, 2)); } catch (e) { console.warn('не записался measure.json:', e.message); }
  await closeChromeViaCdp(devtoolsPort);
  child.kill();
  local.server.close();
  for (let i = 0; i < 20; i++) {
    try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(250); }
  }
}
