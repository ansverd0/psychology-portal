// UI-регрессия портала: headless Chrome + CDP, без внешних зависимостей.
//
//   node scripts/ui-probe.mjs                 — все сценарии
//   node scripts/ui-probe.mjs --only=layout   — один сценарий (можно через запятую)
//   node scripts/ui-probe.mjs --json          — только машинный вывод
//
// Нужен установленный Chrome/Edge и доступ к Supabase (сценарии грузят реальные данные).
// Код возврата: 0 — все проверки прошли, 1 — есть упавшие.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.audit', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome не найден. Задайте CHROME_PATH.');
  return found;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 60000);
    });
  }
  once(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('event timeout ' + method)), timeout);
      const fn = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn));
        resolve(params);
      };
      this.listeners.set(method, (this.listeners.get(method) || []).concat(fn));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (res.exceptionDetails) {
      throw new Error('eval: ' + (res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails)));
    }
    return res.result.value;
  }
  // Подписка на события CDP: несколько слушателей на один метод (console, Network…).
  on(method, fn) {
    this.listeners.set(method, (this.listeners.get(method) || []).concat(fn));
    return fn;
  }
}

/** Гасит браузер через CDP: child.kill() убивает только стартовый процесс
 *  Chrome, а сам браузер остаётся жить и держит папку профиля в %TEMP%. */
async function closeChromeViaCdp(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = await response.json();
    if (!version || !version.webSocketDebuggerUrl) return false;
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(600);
    try { ws.close(); } catch (e) { /* уже закрыт */ }
    return true;
  } catch (e) {
    return false;
  }
}

async function launchChrome(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-probe-'));
  const child = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { child, profile };
    } catch { /* ещё стартует */ }
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

const metrics = (cdp, width, height, mobile = false) =>
  cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile,
    screenWidth: width, screenHeight: height
  });

const touch = (cdp, on) =>
  cdp.send('Emulation.setTouchEmulationEnabled', on ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });

async function setViewport(cdp, width, height, mobile = width <= 768) {
  await metrics(cdp, width, height, mobile);
  await touch(cdp, mobile);
}

async function goto(cdp, base, page, settle = 1200) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${base}/${page}` });
  await loaded;
  await sleep(settle);
}

async function waitFor(cdp, cond, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await cdp.eval(`Boolean(${cond})`)) return true;
    } catch { /* страница перезагружается */ }
    await sleep(200);
  }
  throw new Error('waitFor: ' + cond);
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
}

// --- Проверки ---------------------------------------------------------------

class Checks {
  constructor(name) { this.name = name; this.list = []; }
  ok(cond, label, detail) {
    this.list.push({ label, pass: Boolean(cond), detail: detail === undefined ? null : detail });
    return Boolean(cond);
  }
  near(actual, expected, tolerance, label) {
    return this.ok(Math.abs(actual - expected) <= tolerance, label, { actual, expected, tolerance });
  }
  atLeast(actual, min, label) {
    return this.ok(actual >= min, label, { actual, min });
  }
  get failed() { return this.list.filter((c) => !c.pass); }
}

// --- Сценарии ---------------------------------------------------------------

const scenarios = {
  // Раскладка: ширина контента, панель/кнопка закладок, поиск, подвал.
  async layout(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'tickets.html');
    await waitFor(cdp, 'document.querySelectorAll(".question-nav-btn").length > 0');

    const rows = [];
    for (const w of [1024, 1280, 1440, 1600, 1920]) {
      await setViewport(cdp, w, 900, false);
      await sleep(350);
      rows.push(await cdp.eval(`(() => {
        const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); if (s.display === 'none') return 'none'; const r = el.getBoundingClientRect(); return Math.round(r.width); };
        return { vw: innerWidth, viewer: box('.ticket-viewer'), panel: box('.bookmarks-panel'), fab: box('#bookmarks-fab'), search: box('#mobile-tickets-search') };
      })()`));
    }

    const at = (w) => rows.find((r) => r.vw === w);
    c.atLeast(at(1024).viewer, 500, '1024: конспект ≥ 500px');
    c.atLeast(at(1280).viewer, 700, '1280: конспект ≥ 700px');
    c.atLeast(at(1440).viewer, 850, '1440: конспект ≥ 850px');
    c.atLeast(at(1920).viewer, 900, '1920: конспект ≥ 900px');
    c.ok(at(1440).panel === 'none' && at(1440).fab !== 'none', '1440: панель скрыта, кнопка закладок видна', at(1440));
    c.ok(at(1280).panel === 'none' && at(1280).fab !== 'none', '1280: панель скрыта, кнопка закладок видна', at(1280));
    c.ok(at(1920).panel !== 'none', '1920: панель закладок видна', at(1920));
    c.atLeast(at(1440).search, 300, '1440: поле поиска ≥ 300px');

    // Плитки на мобиле — три в ряд, равной ширины.
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'sections.html');
    await waitFor(cdp, 'document.querySelectorAll("#mobile-sections-tiles .mobile-tile-btn").length > 0');
    const tiles = await cdp.eval(`(() => {
      const el = document.getElementById('mobile-sections-tiles');
      return [...el.querySelectorAll('.mobile-tile-btn')].map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; });
    })()`);
    c.ok(tiles.length >= 3, '390: плитки разделов отрисованы', tiles.length);
    const firstRow = tiles.filter((t) => Math.abs(t.y - tiles[0].y) <= 2);
    c.ok(firstRow.length === 3, '390: три плитки в одном ряду', tiles);
    c.near(firstRow[0].w, firstRow[2].w, 2, '390: плитки равной ширины');
    const overflow = await cdp.eval('document.documentElement.scrollWidth - innerWidth');
    c.ok(overflow <= 1, '390: нет горизонтального переполнения', overflow);

    // Виджет и шапка на телефоне — одно выравнивание.
    await goto(cdp, base, 'index.html');
    const head = await cdp.eval(`(() => {
      const b = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return Math.round(r.left); };
      return { h1: b('header h1'), widget: b('#platform-user-widget') };
    })()`);
    c.near(head.h1, head.widget, 2, '390: заголовок и виджет ID выровнены по левому краю', head);

    // Седьмая плитка хаба занимает всю ширину сетки.
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'index.html');
    const wide = await cdp.eval(`(() => {
      const grid = document.querySelector('.menu-grid').getBoundingClientRect();
      const last = document.querySelector('.menu-item--full').getBoundingClientRect();
      return { grid: Math.round(grid.width), tile: Math.round(last.width), top: Math.round(last.top) };
    })()`);
    c.atLeast(wide.tile, wide.grid - 41, '1440: плитка «Опрос» во всю ширину сетки', wide);

    // sections: под названием страницы снова есть подпись и короткая инструкция (раунд 4)
    await goto(cdp, base, 'sections.html');
    await waitFor(cdp, 'document.querySelector(".section-viewer .content-text")');
    const secHead = await cdp.eval(`(() => {
      const p = document.querySelector('header p');
      const h2 = document.querySelector('header h2');
      return {
        caption: p ? p.innerText.trim() : null,
        instruction: h2 ? h2.innerText.trim() : null,
        viewerText: (document.querySelector('.section-viewer').innerText || '').slice(0, 40)
      };
    })()`);
    c.ok(secHead.caption && secHead.caption.length > 10, 'sections: под названием есть подпись', secHead);
    c.ok(secHead.instruction && secHead.instruction.length < 130, 'sections: короткая инструкция осталась', secHead);

    // Вторая колонка навигации шире: названия вопросов читаются без переносов (раунд 4)
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'tickets.html');
    await waitFor(cdp, 'document.querySelectorAll(".question-nav-btn").length > 0');
    const navCol = await cdp.eval(`(() => {
      const q = document.querySelector('.question-nav-btn');
      return { q: Math.round(q.getBoundingClientRect().width), cols: getComputedStyle(document.querySelector('.nav-left')).gridTemplateColumns };
    })()`);
    c.atLeast(navCol.q, 220, '1440: вторая колонка навигации ≥ 220 px', navCol);

    // Прокрутка к конспекту на телефоне оставляет зазор сверху (раунд 4)
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'tickets.html');
    await waitFor(cdp, 'document.querySelectorAll("#mobile-tickets-tiles .mobile-tile-btn").length > 0');
    await cdp.eval(`document.querySelector('#mobile-tickets-tiles .mobile-tile-btn').click()`);
    await sleep(500);
    await cdp.eval(`document.querySelector('#mobile-questions-list .ticket-nav-btn').click()`);
    await sleep(1200);
    const ceilGap = await cdp.eval(`Math.round(document.querySelector('.ticket-viewer').getBoundingClientRect().top)`);
    c.ok(ceilGap >= 8 && ceilGap <= 28, '390: верх конспекта не упирается в «потолок»', ceilGap);

    // Выключка по ширине на телефоне такая же, как на ПК (раунд 4)
    for (const [page, sel, label] of [
      ['tickets.html', '.ticket-viewer .content-text p', 'tickets'],
      ['sections.html', '.section-viewer .content-text p', 'sections']
    ]) {
      await goto(cdp, base, page);
      await waitFor(cdp, `document.querySelector('${sel}')`);
      const align = await cdp.eval(`getComputedStyle(document.querySelector('${sel}')).textAlign`);
      c.ok(align === 'justify', `390 ${label}: текст выровнен по ширине`, align);
    }

    // Ниже идут проверки для ПК — возвращаем широкий экран
    await setViewport(cdp, 1440, 900, false);

    // tests: верх сайдбара и карточки теста — на одной линии
    await goto(cdp, base, 'tests.html');
    await waitFor(cdp, 'document.querySelector("#quiz-question")?.textContent.length > 10');
    const tops = await cdp.eval(`(() => {
      const a = document.querySelector('.discipline-sidebar').getBoundingClientRect();
      const b = document.querySelector('.quiz-card').getBoundingClientRect();
      return { sidebar: Math.round(a.top), card: Math.round(b.top) };
    })()`);
    c.near(tops.card, tops.sidebar, 1, 'tests: сайдбар и тест начинаются на одной высоте', tops);

    // tests: после ответа и «Следующий вопрос» карточка не улетает под шапку
    await cdp.eval(`document.querySelector('#quiz-options button')?.click()`);
    await sleep(300);
    await cdp.eval(`document.querySelector('#quiz-next-btn')?.click()`);
    await sleep(900);
    const afterNext = await cdp.eval(`Math.round(document.querySelector('.quiz-card').getBoundingClientRect().top)`);
    c.near(afterNext, 90, 12, 'tests: прокрутка к следующему вопросу с запасом сверху', afterNext);

    // news: на телефоне текст выровнен по ширине
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'news.html');
    await waitFor(cdp, 'document.querySelector("#news-timeline li")');
    const newsAlign = await cdp.eval(`getComputedStyle(document.querySelector('#news-timeline li')).textAlign`);
    c.ok(newsAlign === 'justify', '390: новости выровнены по ширине', newsAlign);

    // Профиль на телефоне: подпись ID в одну линию с заголовком и подзаголовком
    const seedAuth = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('research_user_key', 'белый-кедр-73'); } catch (e) {}`
    });
    await goto(cdp, base, 'index.html');
    await waitFor(cdp, 'getComputedStyle(document.getElementById("auth-status-logged")).display !== "none"');
    const auth = await cdp.eval(`(() => {
      const left = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
      return { h1: left('header h1'), label: left('.auth-widget__label') };
    })()`);
    c.near(auth.label, auth.h1, 2, '390: подпись «Ваш ID» выровнена с заголовком', auth);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedAuth.identifier });
  },

  // Временная диагностика: состояние tickets после сценария layout
  // Закладки: единое состояние, дубль заголовка, счётчик.
  async bookmarks(cdp, base, c) {
    await setViewport(cdp, 390, 844, true);
    const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('hub_bookmarks', JSON.stringify([
        { id: '1', title: 'Проблема предмета психологии', type: 'ticket', timestamp: 1, number: '1', folder: 'general-exam' },
        { id: '2', title: 'Основные функции психики', type: 'ticket', timestamp: 2, number: '2', folder: 'general-exam' }
      ])); } catch (e) {}`
    });
    await goto(cdp, base, 'tickets.html', 2500);
    await waitFor(cdp, 'document.querySelectorAll(".mobile-tile-btn").length > 0 && document.getElementById("bookmarks-fab")');
    await sleep(600);
    // сид нужен только для первого открытия — иначе перезагрузка вернёт удалённую закладку
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });

    const starBefore = await cdp.eval(`document.getElementById('ticket-bookmark-star').className`);
    c.ok(starBefore.includes('active'), 'звезда открытого вопроса активна при старте', starBefore);

    await cdp.eval(`document.getElementById('bookmarks-fab').click()`);
    await sleep(300);
    const opened = await cdp.eval(`(() => ({
      headings: document.querySelectorAll('#bookmarks-modal h3').length,
      items: document.querySelectorAll('#bookmarks-modal .bookmark-item').length,
      counter: document.querySelector('.bookmarks-fab__count').textContent
    }))()`);
    c.ok(opened.headings === 1, 'модалка: один заголовок', opened);
    c.ok(opened.items === 2, 'модалка: две закладки', opened);
    c.ok(opened.counter === '2', 'счётчик на кнопке = 2', opened);

    // Удаляем закладку №1 (она же открыта в статье) — звезда должна погаснуть.
    await cdp.eval(`[...document.querySelectorAll('#bookmarks-modal .bookmark-item')]
      .find((el) => el.querySelector('.bookmark-title').textContent.startsWith('№1'))
      .querySelector('.bookmark-remove-btn').click()`);
    await sleep(300);
    const afterRemove = await cdp.eval(`(() => ({
      headings: document.querySelectorAll('#bookmarks-modal h3').length,
      items: document.querySelectorAll('#bookmarks-modal .bookmark-item').length,
      counter: document.querySelector('.bookmarks-fab__count').textContent
    }))()`);
    c.ok(afterRemove.headings === 1, 'после удаления заголовок не дублируется', afterRemove);
    c.ok(afterRemove.items === 1 && afterRemove.counter === '1', 'после удаления осталась 1 закладка и счётчик 1', afterRemove);

    await cdp.eval(`document.querySelector('.bookmarks-modal__close').click()`);
    await sleep(200);
    const starAfter = await cdp.eval(`(() => { const b = document.getElementById('ticket-bookmark-star'); return { cls: b.className, text: b.textContent }; })()`);
    c.ok(!starAfter.cls.includes('active') && starAfter.text === '☆', 'звезда погасла после удаления из модалки', starAfter);

    // Перезагрузка: состояние сохраняется.
    await cdp.send('Page.reload');
    await sleep(2500);
    await waitFor(cdp, 'document.querySelectorAll(".mobile-tile-btn").length > 0');
    await sleep(500);
    const reloaded = await cdp.eval(`(() => ({
      star: document.getElementById('ticket-bookmark-star').className,
      counter: document.querySelector('.bookmarks-fab__count').textContent
    }))()`);
    c.ok(reloaded.counter === '1', 'после перезагрузки счётчик = 1', reloaded);
  },

  // Поиск: ширина, результаты по названию, открытие, Esc.
  async search(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'tickets.html');
    await waitFor(cdp, 'document.querySelectorAll(".question-nav-btn").length > 0');
    await sleep(500);

    const result = await cdp.eval(`(async () => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; };
      const inp = document.getElementById('mobile-tickets-search');
      const dd = document.getElementById('mobile-tickets-search-results');
      inp.focus();
      inp.value = 'психолог';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const items = [...dd.querySelectorAll('.search-suggest-item')];
      const count = items.length;
      const ddBox = { x: Math.round(dd.getBoundingClientRect().x), w: Math.round(dd.getBoundingClientRect().width) };
      const firstText = items[0] ? items[0].innerText.replace(/\\s+/g, ' ').trim() : null;
      if (items[0]) items[0].click();
      await new Promise((r) => setTimeout(r, 500));
      const title = (document.querySelector('.ticket-viewer h2') || {}).textContent || '';
      inp.focus();
      inp.value = 'психика';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const hint = dd.innerText.trim().slice(0, 60);
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      return { input: box(inp), dropdown: ddBox, count, firstText, title, hint, closed: getComputedStyle(dd).display === 'none' };
    })()`);

    c.atLeast(result.input.w, 300, 'поиск: поле ≥ 300px', result.input);
    c.atLeast(result.dropdown.w, 300, 'поиск: выпадашка ≥ 300px', result.dropdown);
    c.ok(result.count > 0, 'поиск «психолог» находит вопросы', result.count);
    c.ok(result.title.includes('психолог'), 'клик по результату открывает вопрос', result.title.slice(0, 80));
    c.ok(result.closed, 'Esc закрывает выпадашку', result);
    c.ok(/Ничего не найдено/i.test(result.hint), 'пустая выдача объясняется', result.hint);
  },

  // Мобильная навигация: плитки → вопросы/статьи → контент.
  async mobileNav(cdp, base, c) {
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'tickets.html');
    await waitFor(cdp, 'document.querySelectorAll("#mobile-tickets-tiles .mobile-tile-btn").length > 0');
    await sleep(800);
    const state = await cdp.eval(`(() => {
      const tiles = [...document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn')];
      const rows = {};
      tiles.forEach((t) => {
        const r = t.getBoundingClientRect();
        const y = Math.round(r.y);
        (rows[y] = rows[y] || []).push(Math.round(r.width));
      });
      const first = rows[Object.keys(rows).map(Number).sort((a, b) => a - b)[0]] || [];
      return { tiles: tiles.length, firstRow: first.length, widths: first };
    })()`);
    // Дисциплин стало больше трёх — проверяем правило раскладки, а не число плиток
    c.ok(state.tiles >= 3 && state.firstRow === 3, '390 tickets: в первом ряду три плитки', state);
    c.ok(new Set(state.widths).size === 1, '390 tickets: плитки в ряду равной ширины', state);

    await cdp.eval(`document.querySelector('#mobile-tickets-tiles .mobile-tile-btn').click()`);
    await sleep(500);
    const after = await cdp.eval(`(() => ({
      listVisible: getComputedStyle(document.getElementById('mobile-questions-list')).display !== 'none',
      questions: document.querySelectorAll('#mobile-questions-list .ticket-nav-btn').length,
      viewerText: (document.querySelector('.ticket-viewer').innerText || '').slice(0, 90)
    }))()`);
    c.ok(after.listVisible && after.questions > 5, '390 tickets: после плитки виден список вопросов', after);
    c.ok(!/слева/i.test(after.viewerText), '390 tickets: нет подсказки «слева»', after.viewerText);

    await goto(cdp, base, 'sections.html');
    await waitFor(cdp, 'document.querySelectorAll("#mobile-sections-tiles .mobile-tile-btn").length > 0');
    await sleep(500);
    await cdp.eval(`document.querySelector('#mobile-sections-tiles .mobile-tile-btn').click()`);
    await sleep(500);
    const sec = await cdp.eval(`(() => ({
      listVisible: getComputedStyle(document.getElementById('mobile-articles-list')).display !== 'none',
      articles: document.querySelectorAll('#mobile-articles-list .ticket-nav-btn').length,
      viewer: (document.querySelector('.section-viewer').innerText || '').slice(0, 60)
    }))()`);
    c.ok(sec.listVisible && sec.articles > 0, '390 sections: после плитки виден список статей', sec);
    c.ok(sec.viewer.length > 20, '390 sections: статья открыта', sec.viewer);
  },

  // Диагностика опроса: журнал пишется, панель открывается программно
  async diag(cdp, base, c) {
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'survey.html', 3000);
    const state = await cdp.eval(`({
      api: typeof hubLog,
      toggle: Boolean(document.getElementById('diag-toggle')),
      entries: typeof hubLog === 'object' ? hubLog.dump().length : 0,
      dumpHead: typeof hubLog === 'object' ? hubLog.dump().split('\\n')[0] : ''
    })`);
    c.ok(state.api === 'object', 'опрос: API журнала доступен', state);
    c.ok(!state.toggle, 'опрос: кнопки «Диагностика» в интерфейсе нет', state.toggle);
    c.atLeast(state.entries, 200, 'опрос: журнал содержит окружение и события', state.entries);
    c.ok(/Диагностика портала/.test(state.dumpHead), 'опрос: заголовок журнала на месте', state.dumpHead);

    await cdp.eval(`hubLog.show()`);
    await sleep(300);
    const panel = await cdp.eval(`(() => {
      const p = document.getElementById('diag-panel');
      return { open: Boolean(p && !p.hidden), text: (p?.querySelector('.diag-panel__log')?.textContent || '').slice(0, 60) };
    })()`);
    c.ok(panel.open && panel.text.length > 40, 'опрос: панель журнала открывается программно', panel);
  },

  // Зависшая сеть на опросе: понятная ошибка за ~6 с, оживление после снятия блокировки
  async surveyHang(cdp, base, c) {
    await setViewport(cdp, 390, 844, true);
    const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('research_user_key', 'тестовый-ключ-11'); } catch (e) {}`
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*', requestStage: 'Request' }] });
    cdp.listeners.set('Fetch.requestPaused', (cdp.listeners.get('Fetch.requestPaused') || []).concat(() => { /* намеренно не продолжаем — сеть «висит» */ }));

    const t0 = Date.now();
    await goto(cdp, base, 'survey.html', 500);
    await waitFor(cdp, 'document.querySelector("[data-survey-offline]")', 15000);
    const elapsed = Date.now() - t0;
    const card = await cdp.eval(`document.querySelector('[data-survey-offline]').innerText`);

    c.ok(elapsed < 10000, 'опрос: ошибка зависшей сети появляется быстрее 10 с', elapsed);
    c.ok(/VPN/i.test(card) && /DNS/i.test(card) && /6 секунд/i.test(card), 'опрос: сообщение называет причину, DNS и VPN', card.slice(0, 160));

    // Снимаем блокировку и повторяем: страница должна ожить (для неизвестного ключа — экран ввода ключа)
    await cdp.send('Fetch.disable');
    await cdp.eval(`document.querySelector('[data-survey-offline] button').click()`);
    await waitFor(cdp, '!document.querySelector("[data-survey-offline]") && /ключ|Учебная мотивация|Спасибо/i.test(document.getElementById("survey-app").innerText || "")', 15000);
    const after = await cdp.eval(`({
      text: document.getElementById('survey-app').innerText.slice(0, 80),
      full: document.getElementById('survey-app').innerText,
      offline: Boolean(document.querySelector('[data-survey-offline]'))
    })`);
    c.ok(!after.offline && /ключ|Учебная мотивация|Спасибо/i.test(after.text), 'опрос: после снятия блокировки страница оживает', after.text);
    c.ok(/приватный DNS/i.test(after.full), 'опрос: на экране ключа есть подсказка про DNS', after.full.slice(-160));

    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });
  },

  // Сеть: ложный офлайн, тупик без данных, ретрай.
  async offline(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);

    // 1. Есть кэш, облако недоступно → контент есть, «автономного режима» нет.
    await goto(cdp, base, 'news.html', 2500);
    await waitFor(cdp, 'localStorage.getItem("hub_page_cache_news")');
    await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
    await cdp.send('Page.reload');
    await sleep(3000);
    const cached = await cdp.eval(`({
      offlineBanner: Boolean(document.getElementById('offline-hub-notification')),
      timeline: (document.getElementById('news-timeline')?.innerText || '').length,
      notice: document.querySelector('[data-cloud-notice]')?.innerText || null
    })`);
    c.ok(!cached.offlineBanner, 'кэш + блокировка: нет плашки «автономный режим»', cached);
    c.ok(cached.timeline > 0, 'кэш + блокировка: новости показаны', cached.timeline);

    // 2. Кэша нет, облако недоступно → карточка ошибки и ретрай, а не пустой экран.
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.reload');
    await sleep(9000);
    const broken = await cdp.eval(`({
      errorCard: Boolean(document.querySelector('[data-load-error]')),
      retry: Boolean(document.querySelector('[data-load-retry]')),
      offlineBanner: Boolean(document.getElementById('offline-hub-notification')),
      bodyText: document.body.innerText.slice(0, 200)
    })`);
    c.ok(broken.errorCard && broken.retry, 'нет кэша: карточка ошибки с «Повторить»', broken);
    c.ok(!broken.offlineBanner, 'нет кэша: не выдаём это за отсутствие интернета', broken.offlineBanner);

    // 3. Снимаем блокировку и жмём «Повторить» → данные приходят без перезагрузки.
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await cdp.eval(`document.querySelector('[data-load-retry]').click()`);
    await sleep(6000);
    const retried = await cdp.eval(`({
      items: document.querySelectorAll('#news-timeline li').length,
      errorCard: Boolean(document.querySelector('[data-load-error]'))
    })`);
    c.ok(retried.items > 0 && !retried.errorCard, 'повтор загрузил данные без перезагрузки', retried);

    // 4. Страница без «просмотрщика» (cards): ошибка не ломает вёрстку и уходит после ретрая.
    await setViewport(cdp, 390, 844, true);
    await cdp.eval('localStorage.clear()');
    await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
    await goto(cdp, base, 'cards.html', 3000);
    await waitFor(cdp, 'document.querySelector("[data-load-error]")', 15000);
    const cardsBroken = await cdp.eval(`({
      errorCard: Boolean(document.querySelector('[data-load-error]')),
      retry: Boolean(document.querySelector('[data-load-retry]')),
      card: Boolean(document.getElementById('myCard'))
    })`);
    c.ok(cardsBroken.errorCard && cardsBroken.retry && cardsBroken.card, 'cards: ошибка показана, карточка на месте', cardsBroken);

    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await cdp.eval(`document.querySelector('[data-load-retry]').click()`);
    await waitFor(cdp, 'document.querySelectorAll("#cards-discipline-tiles .mobile-tile-btn").length > 0', 20000);
    const cardsFixed = await cdp.eval(`({
      tiles: document.querySelectorAll('#cards-discipline-tiles .mobile-tile-btn').length,
      errorCard: Boolean(document.querySelector('[data-load-error]'))
    })`);
    c.ok(cardsFixed.tiles > 1 && !cardsFixed.errorCard, 'cards: ретрай вернул тренажёр и убрал ошибку', cardsFixed);
  },

  // Подвал: есть на всех страницах, во всю ширину.
  async footer(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);
    // Контент страницы догружается после load: без ожидания scrollTo уезжает
    // к старой высоте, страница вырастает, и подвал «не прижат» (плавающая проверка).
    const READY = {
      'survey.html': '(() => { const app = document.getElementById("survey-app"); return app && app.innerText.trim().length > 30; })()',
      'tickets.html': 'document.querySelectorAll(".question-nav-btn").length > 0'
    };
    for (const page of ['index.html', 'survey.html', 'tickets.html']) {
      await goto(cdp, base, page, 1500);
      if (READY[page]) {
        try { await waitFor(cdp, READY[page], 15000); } catch (e) { /* ниже проверка покажет пустой экран */ }
      }
      await cdp.eval('window.scrollTo(0, document.body.scrollHeight)');
      await sleep(300);
      const box = await cdp.eval(`(() => {
        const el = document.querySelector('.site-footer');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.x),
          w: Math.round(r.width),
          client: document.documentElement.clientWidth,
          bottom: Math.round(r.bottom),
          vh: innerHeight,
          bg: getComputedStyle(el).backgroundColor
        };
      })()`);
      c.ok(box && box.x <= 1 && Math.abs(box.w - box.client) <= 1, `${page}: подвал во всю ширину`, box);
      c.ok(box && box.bg === 'rgb(26, 32, 44)', `${page}: подвал тёмный`, box && box.bg);
      c.ok(box && Math.abs(box.bottom - box.vh) <= 1, `${page}: подвал прижат к низу, без светлой полосы`, box);
    }

    // Кнопка «Закладки» рядом с поиском открывает список без правой панели
    await goto(cdp, base, 'tickets.html', 2500);
    await waitFor(cdp, 'document.querySelectorAll(".question-nav-btn").length > 0');
    const navBtn = await cdp.eval(`(() => {
      const b = document.getElementById('nav-bookmarks-btn');
      return { exists: Boolean(b), display: b ? getComputedStyle(b).display : null };
    })()`);
    c.ok(navBtn.exists && navBtn.display !== 'none', '1440: кнопка «Закладки» рядом с поиском видна', navBtn);
    if (navBtn.exists) {
      await cdp.eval(`document.getElementById('nav-bookmarks-btn').click()`);
      await sleep(300);
      const modal = await cdp.eval(`(() => {
        const m = document.getElementById('bookmarks-modal');
        return { open: Boolean(m && !m.hidden) };
      })()`);
      c.ok(modal.open, '1440: кнопка «Закладки» открывает список', modal);
      await cdp.eval(`document.querySelector('.bookmarks-modal__close')?.click()`);
    }

    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'index.html', 1500);
    const mob = await cdp.eval(`(() => {
      const el = document.querySelector('.site-footer');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), client: document.documentElement.clientWidth, bg: getComputedStyle(el).backgroundColor };
    })()`);
    c.ok(mob.x <= 1 && Math.abs(mob.w - mob.client) <= 1, '390: подвал во всю ширину', mob);
    c.ok(mob.bg === 'rgb(26, 32, 44)', '390: подвал тёмный', mob.bg);

    const tap = await cdp.eval(`getComputedStyle(document.querySelector('.menu-item')).webkitTapHighlightColor`);
    c.ok(/^rgba?\(0, 0, 0, 0\)$/.test(tap), 'тап-хайлайт прозрачный', tap);

    // Зазор между контентом и подвалом: блоки не прилипают к тёмной плашке (раунд 4)
    for (const [page, sel] of [
      ['index.html', '.menu-item--full'],
      ['cards.html', '.controls'],
      ['tickets.html', '.ticket-viewer'],
      ['sections.html', '.section-viewer']
    ]) {
      await setViewport(cdp, 1440, 900, false);
      await goto(cdp, base, page, 2500);
      const gap = await cdp.eval(`(() => {
        const f = document.querySelector('.site-footer');
        const el = document.querySelector('${sel}');
        if (!f || !el) return null;
        const border = parseFloat(getComputedStyle(f).borderTopWidth) || 0;
        const darkTop = f.getBoundingClientRect().top + window.scrollY + border;
        const contentBottom = el.getBoundingClientRect().bottom + window.scrollY;
        return { gap: Math.round(darkTop - contentBottom), border };
      })()`);
      c.ok(gap && gap.gap >= 18, `${page}: контент не прилипает к подвалу (≥ 18 px)`, gap);
    }

    // «Главное меню» в подвале ближе к нижнему краю, но не на нём (раунд 4)
    await goto(cdp, base, 'index.html', 1500);
    await cdp.eval('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(400);
    const navGap = await cdp.eval(`(() => {
      const a = document.querySelector('.site-footer__nav a');
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      return Math.round(innerHeight - (r.bottom - (r.height - lh) / 2));
    })()`);
    c.ok(navGap >= 12 && navGap <= 30, '1440: «Главное меню» ближе к нижнему краю, но не на нём', navGap);

    // Кнопка закладок не ложится на подвал, «наверх» стоит на своём месте (раунд 4)
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'tickets.html', 3000);
    await waitFor(cdp, 'document.querySelectorAll(".mobile-tile-btn").length > 0');
    await cdp.eval('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(900);
    const aboveFooter = await cdp.eval(`(() => {
      const f = document.querySelector('.site-footer');
      const border = parseFloat(getComputedStyle(f).borderTopWidth) || 0;
      const darkTop = Math.round(f.getBoundingClientRect().top + border);
      const box = (sel) => { const el = document.querySelector(sel); if (!el || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
      const fab = box('#bookmarks-fab');
      const top = box('#scroll-top-btn');
      return {
        darkTop,
        vh: innerHeight,
        fab: fab && fab.bottom,
        fabTop: fab && fab.top,
        top: top && top.bottom,
        scrollTopGap: top ? Math.round(innerHeight - top.bottom) : null
      };
    })()`);
    c.ok(aboveFooter.fab !== null && aboveFooter.fab <= aboveFooter.darkTop, '390: закладки не лежат на подвале', aboveFooter);
    c.ok(aboveFooter.top !== null && Math.abs(aboveFooter.scrollTopGap - 80) <= 1, '390: «наверх» стоит над закладками (80 px)', aboveFooter);
    c.ok(aboveFooter.fab !== null && aboveFooter.top !== null && aboveFooter.fab < aboveFooter.top, '390: закладки выше «наверх», когда поднимаются', aboveFooter);

    // В обычном положении закладки занимают нижний слот (раунд 5)
    await cdp.eval('window.scrollTo(0, 700)');
    await sleep(500);
    const slots = await cdp.eval(`(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return { gap: Math.round(innerHeight - r.bottom) }; };
      return { fab: box('#bookmarks-fab'), top: box('#scroll-top-btn') };
    })()`);
    c.ok(slots.fab && Math.abs(slots.fab.gap - 16) <= 2, '390: закладки в нижнем слоте (16 px от края)', slots);
    c.ok(slots.top && Math.abs(slots.top.gap - 80) <= 2, '390: «наверх» на 80 px от края', slots);

    // Кнопки справа, навигация подвала слева — не пересекаются
    await cdp.eval(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(600);
    const bottom = await cdp.eval(`(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
      return { fab: r('#bookmarks-fab'), top: r('#scroll-top-btn'), nav: r('.site-footer__nav a') };
    })()`);
    c.ok(bottom.fab && bottom.top && Math.abs(bottom.fab.right - bottom.top.right) <= 1, '390: закладки и «наверх» прижаты вправо', bottom);
    c.ok(bottom.fab && bottom.top && bottom.fab.bottom < bottom.top.top, '390: закладки стоят над «наверх»', bottom);
    const intersects = bottom.fab && bottom.nav
      && bottom.fab.left < bottom.nav.right && bottom.fab.right > bottom.nav.left
      && bottom.fab.top < bottom.nav.bottom && bottom.fab.bottom > bottom.nav.top;
    c.ok(bottom.nav && !intersects, '390: кнопки не перекрывают навигацию подвала', bottom);
  },

  // Опрос: инструкция перед методикой, шкала и конец методики (раунд 5)
  async survey(cdp, base, c) {
    await setViewport(cdp, 390, 844, true);

    // Cеть подменяем: сценарий не должен зависеть от того, что уже лежит на сервере.
    // Заодно перехватываем PsyTracker, чтобы проверить вехи журнала без записи в базу
    const stub = (shamDone) => `(() => {
      const of = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/rest/v1/') !== -1) {
          let body = '{}';
          if (url.indexOf('survey_state') !== -1) body = JSON.stringify({ group_code: '821', course: 2, sham_done: ${shamDone}, sspm_done: false });
          return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return of.apply(this, arguments);
      };
      window.__surveyEvents = [];
      let tracker = null;
      Object.defineProperty(window, 'PsyTracker', {
        configurable: true,
        get: function () { return tracker; },
        set: function (value) {
          if (value && typeof value.event === 'function') {
            const orig = value.event;
            value.event = function (name, meta) {
              window.__surveyEvents.push(name);
              return orig.call(value, name, meta);
            };
          }
          tracker = value;
        }
      });
    })();
    try { localStorage.setItem('research_user_key', 'белый-кедр-73'); } catch (e) {}`;

    const pre1 = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub(false) });
    await goto(cdp, base, 'survey.html', 3000);
    await waitFor(cdp, 'document.querySelector(".sv-scale")', 20000);
    const intro = await cdp.eval(`(() => ({
      title: (document.querySelector('.sv-card h2') || {}).textContent || '',
      scale: (document.querySelector('.sv-scale') || {}).innerText.replace(/\\s+/g, ' ').trim(),
      button: (document.querySelector('.sv-nav button') || {}).textContent,
      notice: Boolean(document.querySelector('.sv-notice'))
    }))()`);
    c.ok(/Методика 1 из 2/.test(intro.title), 'опрос: перед методикой экран-инструкция', intro);
    c.ok(/не соответствует/i.test(intro.scale) && /соответствует/i.test(intro.scale), 'опрос: на инструкции подписаны оба конца шкалы', intro);
    c.ok(!intro.notice, 'опрос: у первой методики нет предупреждения о смене шкалы', intro);

    // Блок вопросов: карточки одной ширины, шкала закреплена
    await cdp.eval(`document.querySelector('.sv-nav button').click()`);
    await sleep(900);
    const block = await cdp.eval(`(() => {
      const items = [...document.querySelectorAll('.sv-item')];
      const widths = items.map((el) => Math.round(el.getBoundingClientRect().width));
      return {
        items: items.length,
        min: Math.min(...widths),
        max: Math.max(...widths),
        legend: items[0] ? getComputedStyle(items[0].querySelector('legend')).fontSize : null,
        sticky: Boolean(document.querySelector('.sv-scale--sticky'))
      };
    })()`);
    c.ok(block.items >= 10 && block.max - block.min <= 2, 'опрос: все карточки вопросов одной ширины', block);
    c.ok(block.legend === '16px', 'опрос: текст вопроса одного размера', block);
    c.ok(block.sticky, 'опрос: шкала закреплена над блоком', block);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre1.identifier });

    // Вторая методика: своя инструкция и предупреждение о смене шкалы
    const pre2 = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub(true) });
    await goto(cdp, base, 'survey.html', 3000);
    await waitFor(cdp, 'document.querySelector(".sv-notice")', 20000);
    const second = await cdp.eval(`(() => ({
      title: (document.querySelector('.sv-card h2') || {}).textContent || '',
      notice: (document.querySelector('.sv-notice') || {}).innerText.replace(/\\s+/g, ' ').trim(),
      scale: (document.querySelector('.sv-scale') || {}).innerText.replace(/\\s+/g, ' ').trim(),
      reversed: Boolean(document.querySelector('.sv-scale--reversed'))
    }))()`);
    c.ok(/Методика 2 из 2/.test(second.title), 'опрос: у второй методики своя инструкция', second);
    c.ok(second.reversed && /обратная/i.test(second.scale), 'опрос: обратная шкала подписана', second);
    c.ok(/шкала другая/i.test(second.notice), 'опрос: предупреждение о смене шкалы', second);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre2.identifier });

    // В конце методики — «Завершить и перейти к следующей»
    const pre3 = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stub(false) });
    await goto(cdp, base, 'survey.html', 3000);
    await waitFor(cdp, 'document.querySelector(".sv-nav button")', 20000);
    await cdp.eval(`document.querySelector('.sv-nav button').click()`);
    await sleep(800);
    const labels = await cdp.eval(`(async () => {
      const w = (ms) => new Promise((r) => setTimeout(r, ms));
      const answer = () => { document.querySelectorAll('.sv-item').forEach((el) => { const r = el.querySelector('.sv-opt input'); if (r && !el.querySelector('input:checked')) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } }); };
      const next = () => { const b = document.querySelector('[data-survey-next]'); if (b) b.click(); };
      answer(); await w(150); next(); await w(700);
      answer(); await w(150); next(); await w(700);
      answer(); await w(150);
      return { last: (document.querySelector('[data-survey-next]') || {}).textContent, progress: (document.querySelector('.sv-progress__row') || {}).innerText };
    })()`);
    c.ok(/Завершить и перейти к следующей/.test(labels.last || ''), 'опрос: в конце методики — «завершить и перейти к следующей»', labels);

    // Нажатие ведёт прямо к инструкции второй методики с предупреждением о шкале
    await cdp.eval(`document.querySelector('[data-survey-next]').click()`);
    await sleep(1200);
    const moved = await cdp.eval(`(() => ({
      title: (document.querySelector('.sv-card h2') || {}).textContent || '',
      notice: Boolean(document.querySelector('.sv-notice')),
      button: (document.querySelector('.sv-nav button') || {}).textContent
    }))()`);
    c.ok(/Методика 2 из 2/.test(moved.title) && moved.notice, 'опрос: после методики сразу её инструкция', moved);

    // Вехи журнала: без них не считается воронка «открыл → дошёл»
    const events = await cdp.eval(`window.__surveyEvents || []`);
    c.ok(events.includes('survey_open'), 'опрос: веха «открыл» пишется в журнал', events);
    c.ok(events.includes('instrument_started'), 'опрос: веха «начал методику» пишется', events);
    c.ok(events.includes('instrument_done'), 'опрос: веха «закончил методику» пишется', events);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre3.identifier });
  },

  // Вики-подсказка у края карточки не обрезается (раунд 4)
  async wiki(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'sections.html', 2500);
    await waitFor(cdp, 'document.querySelector(".wiki-term")');
    const pt = await cdp.eval(`(() => {
      const viewer = document.querySelector('.section-viewer').getBoundingClientRect();
      const t = [...document.querySelectorAll('.wiki-term')]
        .find((el) => el.getBoundingClientRect().left < viewer.left + 140);
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2) };
    })()`);
    c.ok(Boolean(pt), 'есть термин у левого края карточки', pt);
    if (pt) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
      await sleep(500);
    }
    const state = await cdp.eval(`(() => {
      const viewer = document.querySelector('.section-viewer');
      const el = document.elementFromPoint(${pt ? pt.x : 0}, ${pt ? pt.y : 0});
      const opacity = el ? getComputedStyle(el, '::after').opacity : null;
      const overflowX = getComputedStyle(viewer).overflowX;
      const noScrollbar = window.innerHeight === document.documentElement.clientHeight;
      return { overflowX, opacity, noScrollbar };
    })()`);
    c.ok(state.overflowX !== 'clip' && state.overflowX !== 'hidden', 'карточка не обрезает подсказку', state);
    c.ok(state.opacity === '1', 'подсказка раскрывается при наведении', state);
    c.ok(state.noScrollbar, 'подсказка не рождает горизонтальную прокрутку', state);
  },

  // Опрос: группы по направлениям, внутри — по курсу (раунд 4)
  async surveyGroups(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);
    // Список групп живёт на стартовом экране, а он показывается только пока группа
    // не выбрана. Сеть подменяем: сценарий не зависит от состояния тестового ключа
    const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const of = window.fetch;
        window.fetch = function (input, init) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.indexOf('/rest/v1/') !== -1) {
            const body = url.indexOf('survey_state') !== -1
              ? JSON.stringify({ group_code: null, course: null, sham_done: false, sspm_done: false })
              : '{}';
            return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return of.apply(this, arguments);
        };
        try { localStorage.setItem('research_user_key', 'белый-кедр-73'); } catch (e) {}
      })();`
    });
    await goto(cdp, base, 'survey.html', 3000);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });
    await waitFor(cdp, 'document.getElementById("sv-group")', 20000);
    const res = await cdp.eval(`(() => {
      const sel = document.getElementById('sv-group');
      const groups = [...sel.querySelectorAll('optgroup')].map((g) => ({
        label: g.label,
        codes: [...g.querySelectorAll('option')].map((o) => o.value)
      }));
      return { groups, options: sel.querySelectorAll('option').length, values: [...sel.querySelectorAll('option')].map((o) => o.value) };
    })()`);
    c.ok(res.groups.length === 3, 'опрос: три направления в списке групп', res.groups);
    const byProgram = res.groups.map((g) => g.codes.join(','));
    c.ok(byProgram.join('|') === '821,831,841|822,832,842|823,833,843', 'опрос: направления → курс (821, 831, 841…)', byProgram);
    c.ok(res.options === 10 && res.values[0] === '', 'опрос: 9 групп и пустой пункт', res);
  },

  async visual(cdp, base, c) {
    const pages = [
      ['index.html', 1440, 900, false, 'v-index-1440.png'],
      ['index.html', 390, 844, true, 'v-index-390.png'],
      ['tickets.html', 1440, 900, false, 'v-tickets-1440.png'],
      ['tickets.html', 390, 844, true, 'v-tickets-390.png'],
      ['sections.html', 1440, 900, false, 'v-sections-1440.png'],
      ['sections.html', 390, 844, true, 'v-sections-390.png'],
      ['news.html', 1440, 900, false, 'v-news-1440.png'],
      ['survey.html', 1440, 900, false, 'v-survey-1440.png'],
      ['cards.html', 390, 844, true, 'v-cards-390.png'],
      ['tests.html', 1440, 900, false, 'v-tests-1440.png'],
      ['practice.html', 1440, 900, false, 'v-practice-1440.png'],
      ['practice.html', 390, 844, true, 'v-practice-390.png'],
      ['library.html', 1440, 900, false, 'v-library-1440.png'],
      ['privacy.html', 1440, 900, false, 'v-privacy-1440.png']
    ];
    for (const [page, w, h, mobile, name] of pages) {
      await setViewport(cdp, w, h, mobile);
      await goto(cdp, base, page, 3000);
      await shot(cdp, name);
    }

    // Поиск на ПК: кнопка закладок рядом и список поверх колонок
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'tickets.html', 3000);
    await waitFor(cdp, 'document.querySelectorAll(".question-nav-btn").length > 0');
    await cdp.eval(`(() => {
      const inp = document.getElementById('mobile-tickets-search');
      inp.focus();
      inp.value = 'психо';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(600);
    await shot(cdp, 'v-search-1440.png');
    await cdp.eval(`document.getElementById('mobile-tickets-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

    // Подвал на ПК: тёмный и прижат к низу
    await goto(cdp, base, 'index.html', 1500);
    await cdp.eval('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(500);
    await shot(cdp, 'v-index-1440-bottom.png');

    // Низ мобильной страницы: кнопки не должны накрывать подвал
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'tickets.html', 3000);
    await cdp.eval(`document.querySelector('.consent-banner button.secondary')?.click()`);
    await cdp.eval('window.scrollTo(0, document.body.scrollHeight)');
    await sleep(700);
    await shot(cdp, 'v-tickets-390-bottom.png');

    // Ошибка без кэша и «облако недоступно» с кэшем
    await setViewport(cdp, 1440, 900, false);
    await cdp.eval('localStorage.clear()');
    await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
    await goto(cdp, base, 'news.html', 3000);
    await waitFor(cdp, 'document.querySelector("[data-load-error]")', 15000);
    await shot(cdp, 'v-error.png');

    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await goto(cdp, base, 'news.html', 3000);
    await waitFor(cdp, 'document.querySelectorAll("#news-timeline li").length > 0', 20000);
    await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
    await cdp.send('Page.reload');
    await sleep(4000);
    await shot(cdp, 'v-notice.png');

    // Снимаем блокировку supabase: сценарии делят одну вкладку, мусор после
    // visual иначе ломает следующий сценарий (аудит).
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    c.ok(true, 'скриншоты сняты');
  },

  // Практикум: список, фильтры, открытие задачи, возврат, мобильная вёрстка.
  // RPC не проверяем: сценарий смотрит рендер и навигацию, а не запись.
  async practice(cdp, base, c) {
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'practice.html', 1500);
    await waitFor(cdp, 'document.querySelectorAll("[data-practice-task]").length > 0', 20000);

    const list = await cdp.eval(`(() => {
      const cards = [...document.querySelectorAll('[data-practice-task]')];
      const levels = [...document.querySelectorAll('[data-practice-level]')].map((b) => (b.innerText || '').trim());
      const tiles = [...document.querySelectorAll('[data-practice-discipline]')].map((b) => (b.innerText || '').trim());
      const progress = (document.getElementById('practice-progress') || {}).textContent || '';
      return {
        tasks: cards.length,
        levels,
        tiles,
        progress,
        overflow: document.documentElement.scrollWidth - innerWidth
      };
    })()`);
    c.atLeast(list.tasks, 4, '1440: задач практикума не меньше четырёх', list.tasks);
    c.ok(list.levels.length >= 5, '1440: чипы уровней «Все» + уровни из данных', list.levels);
    c.ok(list.tiles.length >= 2, '1440: плитки дисциплин есть, «Все» первая', list.tiles);
    c.ok(/Пройдено\s+\d+\s+из\s+\d+/.test(list.progress), '1440: прогресс «Пройдено X из Y»', list.progress);
    c.ok(list.overflow <= 1, '1440: нет горизонтального переполнения', list.overflow);

    // Service Worker: страница и модуль практикума лежат в кэше текущей версии
    let swState = null;
    try {
      await waitFor(cdp, `(async () => { if (!('serviceWorker' in navigator)) return false; const reg = await navigator.serviceWorker.ready; return Boolean(reg && reg.active); })()`, 30000);
      swState = await cdp.eval(`(async () => {
        const names = await caches.keys();
        const name = names.filter((n) => n.indexOf('psy-hub-') === 0).sort().pop() || null;
        if (!name) return { names, name: null };
        const cache = await caches.open(name);
        const urls = (await cache.keys()).map((request) => request.url);
        return {
          name,
          page: urls.some((u) => u.endsWith('/practice.html')),
          script: urls.some((u) => u.endsWith('/js/practice.js'))
        };
      })()`);
    } catch (e) {
      swState = { error: String(e.message || e) };
    }
    c.ok(swState && swState.name === 'psy-hub-v35' && swState.page && swState.script, 'SW v35 кэширует practice.html и js/practice.js', swState);

    // Фильтр уровней: чип «Анализ» оставляет только задания этого уровня
    await cdp.eval(`document.querySelector('[data-practice-level="analyze"]').click()`);
    await sleep(300);
    const filtered = await cdp.eval(`(() => {
      const cards = [...document.querySelectorAll('[data-practice-task]')];
      const badges = cards.map((card) => ((card.querySelector('.practice-level') || {}).textContent || '').trim());
      const active = [...document.querySelectorAll('[data-practice-level]')].filter((b) => b.classList.contains('active')).map((b) => b.getAttribute('data-practice-level'));
      return { tasks: cards.length, badges, active, emptyVisible: !document.getElementById('practice-empty').hidden };
    })()`);
    c.ok(filtered.tasks > 0 && filtered.badges.every((b) => b === 'Анализ'), '1440: фильтр уровня «Анализ» оставляет только анализ', filtered);
    c.ok(filtered.active.length === 1 && filtered.active[0] === 'analyze', '1440: активен ровно один чип уровня', filtered);

    await cdp.eval(`document.querySelector('[data-practice-level="all"]').click()`);
    await sleep(300);
    const restored = await cdp.eval(`document.querySelectorAll('[data-practice-task]').length`);
    c.ok(restored >= 4, '1440: сброс фильтра возвращает все задания', restored);

    // Открытие первой задачи: карточка, фокус, кнопки
    await cdp.eval(`document.querySelector('[data-practice-open-task]').click()`);
    await waitFor(cdp, '(() => { const v = document.querySelector("[data-practice-task-view]"); return v && !v.hidden && v.innerText.length > 120; })()', 10000);
    const opened = await cdp.eval(`(() => {
      const v = document.querySelector('[data-practice-task-view]');
      const active = document.activeElement;
      return {
        title: (v.querySelector('.practice-task__title') || {}).textContent || '',
        blocks: v.querySelectorAll('.practice-task__block').length,
        back: Boolean(v.querySelector('[data-practice-back]')),
        next: Boolean(v.querySelector('[data-practice-next]')),
        answer: Boolean(v.querySelector('input[name="practice-choice"]') || v.querySelector('[data-practice-answer]')),
        focus: active ? String(active.className || active.tagName) : '',
        listHidden: Boolean(document.getElementById('practice-list').hidden)
      };
    })()`);
    c.ok(opened.title.length > 5 && opened.blocks >= 2, '1440: в карточке есть заголовок, ситуация и задание', opened);
    c.ok(opened.back && opened.next, '1440: кнопки «К списку» и «Следующее задание»', opened);
    c.ok(opened.answer, '1440: есть варианты ответа или поле открытого ответа', opened);
    c.ok(/practice-task__title/.test(opened.focus), '1440: фокус при открытии — на заголовке задачи', opened);
    c.ok(opened.listHidden, '1440: список скрыт, пока открыта задача', opened);

    await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
    await waitFor(cdp, '(() => { const l = document.getElementById("practice-list"); const v = document.querySelector("[data-practice-task-view]"); return l && !l.hidden && v && v.hidden; })()', 8000);
    const backState = await cdp.eval(`(() => ({
      cards: document.querySelectorAll('[data-practice-task]').length,
      focus: document.activeElement ? document.activeElement.getAttribute('data-practice-open-task') : null
    }))()`);
    c.ok(backState.cards >= 4, '1440: возврат к списку показывает карточки', backState);
    c.ok(backState.focus !== null, '1440: фокус вернулся на карточку, с которой ушли', backState);

    // Гостевой выбор: проверка идёт локально, без RPC и без записи
    await cdp.eval('localStorage.removeItem("research_user_key")');
    let choiceChecked = false;
    const total = await cdp.eval('document.querySelectorAll("[data-practice-open-task]").length');
    for (let i = 0; i < total && !choiceChecked; i++) {
      await cdp.eval(`document.querySelectorAll('[data-practice-open-task]')[${i}].click()`);
      await sleep(300);
      const hasChoice = await cdp.eval('Boolean(document.querySelector("#practice-task-view input[name=\\"practice-choice\\"]"))');
      if (!hasChoice) {
        await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
        await sleep(200);
        continue;
      }
      await cdp.eval(`document.querySelector('#practice-task-view input[name="practice-choice"]').click()`);
      await cdp.eval(`document.querySelector('[data-practice-check]').click()`);
      await sleep(400);
      const guest = await cdp.eval(`(() => {
        const result = document.querySelector('[data-practice-result]');
        const note = document.querySelector('[data-practice-guest-note]');
        const verdict = result ? (result.querySelector('.practice-result__verdict') || {}).textContent : '';
        return {
          resultVisible: Boolean(result && !result.hidden),
          verdict: (verdict || '').trim(),
          guestVisible: Boolean(note && !note.hidden),
          saved: localStorage.getItem('research_user_key')
        };
      })()`);
      c.ok(guest.resultVisible && /^(Верно|Неверно)$/.test(guest.verdict), '1440: choice показывает «Верно»/«Неверно» (гость)', guest);
      c.ok(guest.guestVisible && !guest.saved, '1440: гость видит «не сохранено» и предложение создать ID', guest);
      choiceChecked = true;
      await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
      await sleep(200);
    }
    c.ok(choiceChecked, '1440: найдено задание с вариантами ответа');

    // Открытый ответ: критерии и шкала 0/1/2 появляются по кнопке
    let rubricChecked = false;
    for (let i = 0; i < total && !rubricChecked; i++) {
      await cdp.eval(`document.querySelectorAll('[data-practice-open-task]')[${i}].click()`);
      await sleep(300);
      const hasOpen = await cdp.eval('Boolean(document.querySelector("#practice-task-view [data-practice-answer]"))');
      if (!hasOpen) {
        await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
        await sleep(200);
        continue;
      }
      const before = await cdp.eval(`(() => {
        const box = document.querySelector('[data-practice-criteria]');
        const privacy = document.querySelector('[data-practice-answer-area] .practice-note--privacy');
        return { hidden: Boolean(box && box.hidden), privacy: Boolean(privacy), textarea: Boolean(document.querySelector('[data-practice-answer]')) };
      })()`);
      c.ok(before.hidden && before.privacy && before.textarea, '1440: open: поле ответа закрыто, критерии скрыты, есть предупреждение о ФИО', before);

      await cdp.eval(`document.querySelector('[data-practice-show-criteria]').click()`);
      await sleep(300);
      const rubric = await cdp.eval(`(() => {
        const box = document.querySelector('[data-practice-criteria]');
        const rows = box ? box.querySelectorAll('.practice-rubric__row').length : 0;
        const radios = box ? box.querySelectorAll('input[type="radio"]').length : 0;
        const save = box ? box.querySelector('[data-practice-save]') : null;
        const total = box ? box.querySelector('[data-practice-self-total]') : null;
        return { visible: Boolean(box && !box.hidden), rows, radios, saveDisabled: Boolean(save && save.disabled), total: total ? total.textContent.trim() : null };
      })()`);
      c.ok(rubric.visible && rubric.rows >= 3 && rubric.radios === rubric.rows * 3, '1440: open: критерии открываются со шкалой 0/1/2', rubric);
      c.ok(rubric.saveDisabled && rubric.total === '0', '1440: «Сохранить попытку» недоступно, пока критерии не отмечены', rubric);

      // Отмечаем все критерии единицей и проверяем итог
      await cdp.eval(`(() => {
        const box = document.querySelector('[data-practice-criteria]');
        const rows = [...box.querySelectorAll('.practice-rubric__row')];
        rows.forEach((row) => { const r = row.querySelectorAll('input[type="radio"]')[1]; if (r) r.click(); });
      })()`);
      await sleep(300);
      const scored = await cdp.eval(`(() => {
        const box = document.querySelector('[data-practice-criteria]');
        const total = box.querySelector('[data-practice-self-total]');
        const save = box.querySelector('[data-practice-save]');
        return { total: total ? total.textContent.trim() : null, saveDisabled: Boolean(save && save.disabled) };
      })()`);
      c.ok(scored.total === String(5) && !scored.saveDisabled, '1440: рубрика считает итог и открывает сохранение', scored);

      rubricChecked = true;
      await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
      await sleep(200);
    }
    c.ok(rubricChecked, '1440: найдено задание с открытым ответом');

    // 390: нет переполнения, плитки и поля не вылезают
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'practice.html', 1200);
    await waitFor(cdp, 'document.querySelectorAll("[data-practice-task]").length > 0', 20000);
    const mobile = await cdp.eval(`(() => {
      const over = document.documentElement.scrollWidth - innerWidth;
      const tiles = [...document.querySelectorAll('#practice-discipline-tiles .mobile-tile-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right) };
      });
      const wide = [...document.querySelectorAll('#practice-app *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
      }).slice(0, 4).map((el) => String(el.className || el.tagName).slice(0, 40));
      return { over, tiles, wide };
    })()`);
    c.ok(mobile.over <= 1, '390: нет горизонтального переполнения', mobile);
    c.ok(mobile.tiles.length > 0 && mobile.tiles.every((t) => t.right <= 391 && t.left >= -1), '390: плитки дисциплин не вылезают', mobile.tiles);
    c.ok(mobile.wide.length === 0, '390: элементы практикума не выходят за экран', mobile.wide);

    await cdp.eval(`document.querySelector('[data-practice-open-task]').click()`);
    await waitFor(cdp, '(() => { const v = document.querySelector("[data-practice-task-view]"); return v && !v.hidden; })()', 8000);
    const mobileCard = await cdp.eval(`(() => {
      const v = document.querySelector('[data-practice-task-view]');
      const card = v.getBoundingClientRect();
      const outside = [...v.querySelectorAll('textarea, button, input, label')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > card.right + 1 || r.left < card.left - 1);
      }).map((el) => String(el.className || el.tagName).slice(0, 40));
      return { over: document.documentElement.scrollWidth - innerWidth, outside, width: Math.round(card.width) };
    })()`);
    c.ok(mobileCard.over <= 1, '390: карточка задачи без горизонтального скролла', mobileCard);
    c.ok(mobileCard.outside.length === 0, '390: поля и кнопки не выходят за карточку', mobileCard);

    // Ключ: RPC и события проверяем на заглушке — в базу ничего не пишем.
    await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'practice.html', 1200);
    await waitFor(cdp, 'document.querySelectorAll("[data-practice-task]").length > 0', 20000);

    const stub = `(() => {
      localStorage.setItem('research_user_key', 'test-key-11');
      window.__practiceCalls = [];
      window.PsyTracker = { event: function (name, meta) { window.__practiceCalls.push({ name: name, meta: meta }); } };
      const original = window.fetch;
      window.fetch = function (url, init) {
        const target = String(url);
        if (target.indexOf('/rpc/submit_practice_attempt') !== -1) {
          const body = JSON.parse((init && init.body) || '{}');
          window.__practiceCalls.push({ name: 'rpc_submit', task: body.p_task_id, answer: body.p_answer, self: body.p_self_score, duration: body.p_duration_ms });
          const answer = body.p_answer || {};
          const payload = answer.text
            ? { attempt_id: 99, is_correct: null, self_score: body.p_self_score, max_score: 10 }
            : { attempt_id: 99, is_correct: true, self_score: null, max_score: null };
          return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        if (target.indexOf('/rpc/practice_progress') !== -1) {
          return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return original.apply(this, arguments);
      };
      return true;
    })()`;
    await cdp.eval(stub);

    let savedChoice = false;
    for (let i = 0; i < total && !savedChoice; i++) {
      await cdp.eval(`document.querySelectorAll('[data-practice-open-task]')[${i}].click()`);
      await sleep(300);
      const hasChoice = await cdp.eval('Boolean(document.querySelector("#practice-task-view input[name=\\"practice-choice\\"]"))');
      if (!hasChoice) {
        await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
        await sleep(200);
        continue;
      }
      await cdp.eval(`document.querySelector('#practice-task-view input[name="practice-choice"]').click()`);
      await cdp.eval(`document.querySelector('[data-practice-check]').click()`);
      await sleep(600);
      const state = await cdp.eval(`(() => {
        const calls = window.__practiceCalls || [];
        const rpc = calls.filter((c) => c.name === 'rpc_submit').pop() || null;
        const submitEvent = calls.filter((c) => c.name === 'task_submit').pop() || null;
        const progress = JSON.parse(localStorage.getItem('hub_practice_progress_v1') || '{}');
        const keys = Object.keys(progress);
        const result = document.querySelector('[data-practice-result]');
        return {
          rpc,
          submitMeta: submitEvent ? submitEvent.meta : null,
          keys,
          entry: keys.length ? progress[keys[0]] : null,
          verdict: result ? String((result.querySelector('.practice-result__verdict') || {}).textContent || '').trim() : '',
          savedNote: Boolean(result && result.querySelector('.practice-result__saved'))
        };
      })()`);
      c.ok(Boolean(state.rpc) && typeof state.rpc.answer.choice === 'number' && state.rpc.self === null && state.rpc.duration >= 5000 && state.rpc.duration <= 7200000,
        'ключ: choice уходит в RPC с choice, без self_score и с duration', state.rpc);
      c.ok(state.verdict === 'Верно' && state.savedNote, 'ключ: choice показывает результат RPC и «попытка сохранена»', state);
      c.ok(state.keys.length === 1 && state.entry && state.entry.attempts === 1 && state.entry.lastCorrect === true,
        'ключ: локальный прогресс обновился (attempts, lastCorrect)', state.entry);
      c.ok(state.submitMeta && typeof state.submitMeta.level === 'string' && state.submitMeta.kind === 'choice',
        'ключ: событие task_submit с level и kind', state.submitMeta);
      savedChoice = true;
      await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
      await sleep(200);
    }
    c.ok(savedChoice, 'ключ: найдено задание с вариантами ответа');

    let savedOpen = false;
    for (let i = 0; i < total && !savedOpen; i++) {
      await cdp.eval(`document.querySelectorAll('[data-practice-open-task]')[${i}].click()`);
      await sleep(300);
      const hasOpen = await cdp.eval('Boolean(document.querySelector("#practice-task-view [data-practice-answer]"))');
      if (!hasOpen) {
        await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
        await sleep(200);
        continue;
      }
      await cdp.eval(`(() => {
        const area = document.querySelector('[data-practice-answer]');
        area.value = 'Развёрнутый ответ для проверки сохранения попытки: сравнение подходов, механизм и вывод о стратегии подготовки.';
        area.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-practice-show-criteria]').click();
      })()`);
      await sleep(300);
      const rows = await cdp.eval('document.querySelectorAll("#practice-task-view .practice-rubric__row").length');
      await cdp.eval(`(() => {
        const rows = [...document.querySelectorAll('#practice-task-view .practice-rubric__row')];
        rows.forEach((row) => { const r = row.querySelectorAll('input[type="radio"]')[2]; if (r) r.click(); });
      })()`);
      await sleep(200);
      await cdp.eval(`document.querySelector('[data-practice-save]').click()`);
      await sleep(600);
      const openState = await cdp.eval(`(() => {
        const calls = window.__practiceCalls || [];
        const rpc = calls.filter((c) => c.name === 'rpc_submit').pop() || null;
        const names = calls.filter((c) => c.name !== 'rpc_submit').map((c) => c.name);
        const result = document.querySelector('[data-practice-result]');
        return {
          rpc,
          names,
          hasModel: Boolean(result && result.querySelectorAll('.practice-result__block').length),
          verdict: result ? String((result.querySelector('.practice-result__verdict') || {}).textContent || '').trim() : '',
          draft: Object.keys(localStorage).filter((k) => k.indexOf('hub_practice_draft_v1_') === 0).length
        };
      })()`);
      c.ok(openState.rpc && openState.rpc.answer.text && openState.rpc.answer.text.length >= 30, 'ключ: open уходит в RPC с текстом ответа', openState.rpc && { len: (openState.rpc.answer.text || '').length, self: openState.rpc.self });
      c.ok(openState.rpc && openState.rpc.self === rows * 2, 'ключ: самооценка передана как сумма по критериям', openState.rpc && openState.rpc.self);
      c.ok(openState.names.indexOf('self_check') !== -1 && openState.names.indexOf('task_submit') !== -1, 'ключ: события self_check и task_submit', openState.names);
      c.ok(openState.hasModel && /сохранена/i.test(openState.verdict), 'ключ: open показывает эталон и «самопроверка сохранена»', openState);
      c.ok(openState.draft === 0, 'ключ: черновик ответа очищен после сохранения', openState.draft);
      savedOpen = true;
      await cdp.eval(`document.querySelector('[data-practice-back]').click()`);
      await sleep(200);
    }
    c.ok(savedOpen, 'ключ: найдено задание с открытым ответом');

    // Облако недоступно и кэша нет: карточка ошибки, а не белый экран
    await setViewport(cdp, 1440, 900, false);
    await cdp.eval('localStorage.removeItem("hub_page_cache_practice"); localStorage.removeItem("hub_page_version_practice");');
    await cdp.send('Network.setBlockedURLs', { urls: ['*supabase.co*'] });
    await goto(cdp, base, 'practice.html', 1200);
    let loadError = null;
    try {
      await waitFor(cdp, 'document.querySelector("[data-load-error]")', 25000);
      loadError = await cdp.eval(`(() => {
        const box = document.querySelector('[data-load-error]');
        return { visible: Boolean(box), text: box ? (box.innerText || '').trim().length : 0 };
      })()`);
    } catch (e) {
      loadError = { visible: false, text: 0 };
    }
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    c.ok(loadError.visible && loadError.text > 20, 'сеть: без кэша практикум показывает карточку ошибки, а не пустоту', loadError);

    // Тестовый ключ не должен переехать в следующие сценарии: иначе трекер
    // шлёт log_events с несуществующим пользователем и аудит видит 400.
    await cdp.eval(`(() => {
      ['research_user_key', 'hub_tracker_queue', 'hub_tracker_session', 'hub_practice_progress_v1', 'hub_practice_draft_v1_1'].forEach((k) => localStorage.removeItem(k));
      return true;
    })()`);
  },

  // Сквозной аудит интерфейса: 12 страниц × 3 ширины (390 / 768 / 1440).
  // Жёсткие проверки — только инварианты: переполнение, консоль и CSP, статика,
  // появление данных, наезд кнопок внизу, печать, клавиатура. Всё остальное
  // (кегль, цели нажатия, обрезка, CLS, мета, баннер согласия) — в .audit/ui-audit.json.
  async audit(cdp, base, c) {
    const ART = path.join(ROOT, '.audit', 'ui-audit.json');
    // Сценарии делят одну вкладку: снимаем то, что мог оставить предыдущий
    // (visual блокирует supabase и не разблокирует — иначе аудит увидит пустые страницы).
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    try { await cdp.send('Fetch.disable'); } catch { /* не был включён */ }
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    let bucket = null;
    const flush = () => { const b = bucket; bucket = null; return b || { console: [], http: [] }; };

    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (!bucket || (p.type !== 'error' && p.type !== 'assert')) return;
      bucket.console.push((p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
    });
    cdp.on('Log.entryAdded', (p) => {
      const e = p.entry || {};
      if (!bucket || e.level !== 'error') return;
      bucket.console.push('[' + e.source + '] ' + (e.text || '').slice(0, 300));
    });
    cdp.on('Network.responseReceived', (p) => {
      const r = p.response || {};
      if (!bucket || r.status < 400) return;
      bucket.http.push({ url: String(r.url || '').replace(base, ''), status: r.status });
    });
    cdp.on('Network.loadingFailed', (p) => {
      if (!bucket || p.canceled) return;
      const t = p.errorText || '';
      if (/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(t)) return;
      bucket.http.push({ failed: t, type: p.type });
    });

    // Накопительный CLS: наблюдатель ставится до навигации, чтобы поймать сдвиги
    const clsScript = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "window.__cls=0;window.__shifts=0;try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput){window.__cls+=e.value;window.__shifts++;}})}).observe({type:'layout-shift',buffered:true})}catch(e){}"
    });

    const PROBE = `(() => {
      const vw = innerWidth, vh = innerHeight;
      const shown = (el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return null;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        return r;
      };
      const name = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
      const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48);
      const wide = [], clipped = [], tiny = [], small = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = shown(el);
        if (!r) return;
        if (r.right > vw + 1 || r.left < -1) wide.push({ el: name(el), l: Math.round(r.left), r: Math.round(r.right), text: txt(el) });
        const s = getComputedStyle(el);
        const fs = parseFloat(s.fontSize);
        let own = '';
        for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
        own = own.trim().replace(/\\s+/g, ' ');
        if (fs < 12 && own.length > 1) tiny.push({ el: name(el), fs: Math.round(fs * 10) / 10, text: own.slice(0, 48) });
        if (!el.children.length && own.length >= 4 && /hidden|clip/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 2) {
          clipped.push({ el: name(el), text: own.slice(0, 48), client: el.clientWidth, scroll: el.scrollWidth });
        }
      });
      document.querySelectorAll('a, button, [role=button], input, select, textarea').forEach((el) => {
        const r = shown(el);
        if (!r) return;
        if (r.width < 44 || r.height < 44) small.push({ el: name(el), w: Math.round(r.width), h: Math.round(r.height), text: txt(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '' });
      });
      const nameless = [];
      document.querySelectorAll('a, button, [role=button]').forEach((el) => {
        const r = shown(el);
        if (!r) return;
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim();
        if (!label) nameless.push(name(el));
      });
      // Контраст: цвет текста против ближайшего непрозрачного фона (WCAG 2.1 AA)
      const parseRGB = (c) => {
        const m = String(c).match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const bgOf = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = parseRGB(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0.01) return c;
          n = n.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const lowContrast = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = shown(el);
        if (!r) return;
        let own = '';
        for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
        own = own.trim();
        if (own.length < 2) return;
        const s = getComputedStyle(el);
        const fg = parseRGB(s.color);
        if (!fg) return;
        const bg = bgOf(el);
        const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        const fs = parseFloat(s.fontSize);
        const bold = parseInt(s.fontWeight, 10) >= 700;
        const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5;
        if (ratio < need) lowContrast.push({ el: name(el), ratio: Math.round(ratio * 100) / 100, need, fs, color: s.color, bg: 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')', text: own.slice(0, 40) });
      });
      const meta = {
        title: document.title,
        desc: (document.querySelector('meta[name="description"]') || {}).content || null,
        canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
        robots: (document.querySelector('meta[name="robots"]') || {}).content || null,
        manifest: Boolean(document.querySelector('link[rel="manifest"]')),
        themeColor: Boolean(document.querySelector('meta[name="theme-color"]')),
        appleTouch: Boolean(document.querySelector('link[rel="apple-touch-icon"]')),
        h1: document.querySelectorAll('h1').length,
        imgsNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        lang: document.documentElement.lang
      };
      const banner = document.getElementById('consent-banner');
      const bRect = banner ? shown(banner) : null;
      const headEl = document.querySelector('header');
      const headRect = headEl ? headEl.getBoundingClientRect() : null;
      return {
        overflow: document.documentElement.scrollWidth - vw,
        scrollWidth: document.documentElement.scrollWidth,
        docHeight: document.documentElement.scrollHeight,
        bodyText: (document.body.innerText || '').length,
        wide: wide.slice(0, 6), wideCount: wide.length,
        clipped: clipped.slice(0, 6), clippedCount: clipped.length,
        tiny: tiny.slice(0, 8), tinyCount: tiny.length,
        small: small.slice(0, 8), smallCount: small.length,
        nameless: nameless.slice(0, 8), namelessCount: nameless.length,
        lowContrast: lowContrast.slice(0, 10), lowContrastCount: lowContrast.length,
        meta,
        consentBanner: bRect ? { h: Math.round(bRect.height), top: Math.round(bRect.top) } : null,
        headerBottom: headRect ? Math.round(headRect.bottom) : null,
        headerShare: headRect ? Math.round((headRect.bottom / (innerHeight || 1)) * 100) : null,
        cls: Math.round((window.__cls || 0) * 1000) / 1000,
        shifts: window.__shifts || 0
      };
    })()`;

    // Кнопки и подвал в самом низу страницы (видимость и наезд друг на друга)
    const BOTTOM = `(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return 'none';
        const r = el.getBoundingClientRect();
        return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) };
      };
      const footer = document.querySelector('.site-footer');
      return { fab: box('#bookmarks-fab'), top: box('#scroll-top-btn'), footer: footer ? Math.round(footer.getBoundingClientRect().top) : null, vh: innerHeight };
    })()`;

    const PAGES = [
      ['index.html', null],
      ['tickets.html', 'document.querySelector(".folder-nav-btn")'],
      ['sections.html', 'document.querySelector(".folder-nav-btn")'],
      ['cards.html', '(() => { const t = document.getElementById("term-text"); return t && !/Загрузка/.test(t.textContent); })()'],
      ['tests.html', '(() => { const q = document.getElementById("quiz-question"); return q && !/Загрузка/.test(q.textContent) && document.querySelectorAll("#quiz-options button").length > 0; })()'],
      ['practice.html', 'document.querySelectorAll("[data-practice-task]").length > 0'],
      ['library.html', 'document.querySelectorAll("#books-container .menu-item").length > 0'],
      ['news.html', 'document.querySelectorAll("#news-timeline > div").length > 0'],
      ['privacy.html', null],
      ['offline.html', null],
      ['404.html', null],
      ['survey.html', 'document.getElementById("survey-app") && document.getElementById("survey-app").innerText.trim().length > 30']
    ];
    const VIEWPORTS = [[390, 844, true], [768, 1024, true], [1440, 900, false]];

    const runs = [];
    for (const [w, h, mob] of VIEWPORTS) {
      for (const [page, waitCond] of PAGES) {
        bucket = { console: [], http: [] };
        await setViewport(cdp, w, h, mob);
        const t0 = Date.now();
        await goto(cdp, base, page, 400);
        let data = null;
        let dataMs = null;
        if (waitCond) {
          try { await waitFor(cdp, waitCond, 15000); data = true; dataMs = Date.now() - t0; } catch { data = false; }
        }
        await sleep(700);
        const m = await cdp.eval(PROBE);
        await shot(cdp, `audit-${w}-${page.replace('.html', '')}.png`);
        await cdp.eval('scrollTo(0, document.documentElement.scrollHeight)');
        await sleep(450);
        const bottom = await cdp.eval(BOTTOM);
        const ev = flush();
        const overlap = bottom.fab && bottom.fab !== 'none' && bottom.top && bottom.top !== 'none'
          ? Math.max(0, Math.min(bottom.fab.b, bottom.top.b) - Math.max(bottom.fab.t, bottom.top.t)) *
            Math.max(0, Math.min(bottom.fab.r, bottom.top.r) - Math.max(bottom.fab.l, bottom.top.l))
          : 0;
        runs.push({ page, w, ms: Date.now() - t0, dataMs, data, ...m, bottom, fabOverlap: overlap, console: ev.console, http: ev.http });
        if (Math.abs(m.overflow) > 1 || ev.console.length || ev.http.length) {
          await shot(cdp, `a-${page.replace('.html', '')}-${w}.png`);
        }
      }
    }

    const check = (pred, label, mapDetail) => {
      const bad = runs.filter(pred);
      c.ok(bad.length === 0, label, bad.map(mapDetail));
    };
    // scrollWidth сравнивается с clientWidth: полоса прокрутки (≈15 px) в innerWidth
    // даёт отрицательную разницу на ПК — это норма, ловим только реальный выход вправо.
    check((r) => r.overflow > 1, 'аудит: нет горизонтального переполнения на 12 страницах × 3 ширинах',
      (r) => ({ p: r.page, w: r.w, over: r.overflow, wide: r.wide.slice(0, 2) }));
    check((r) => r.console.length, 'аудит: консоль без ошибок и нарушений CSP',
      (r) => ({ p: r.page, w: r.w, err: r.console.slice(0, 3) }));
    check((r) => r.http.some((x) => !/^\/favicon\.ico$/.test(x.url || '')), 'аудит: все запросы страницы успешны (нет 4xx/5xx)',
      (r) => ({ p: r.page, w: r.w, http: r.http.slice(0, 3) }));
    check((r) => r.data === false, 'аудит: данные появляются быстрее 15 с на всех страницах с данными',
      (r) => ({ p: r.page, w: r.w, ms: r.ms }));
    check((r) => r.fabOverlap > 0, 'аудит: кнопки «закладки» и «наверх» не наезжают друг на друга',
      (r) => ({ p: r.page, w: r.w, fab: r.bottom.fab, top: r.bottom.top }));

    // Инвентарь дисциплин: сколько показано на странице и сколько заведено в реестре.
    // Это доказательство к N2 (пустые дисциплины) и N7 (первый экран), не проверка.
    const inventory = { disciplines: {} };
    for (const [page, sel] of [
      ['tickets.html', '.folder-nav-btn'],
      ['sections.html', '.folder-nav-btn'],
      ['cards.html', '#cards-discipline-tiles .mobile-tile-btn'],
      ['tests.html', '#quiz-discipline-tiles .mobile-tile-btn']
    ]) {
      await setViewport(cdp, 1440, 900, false);
      await goto(cdp, base, page, 900);
      try { await waitFor(cdp, `document.querySelectorAll("${sel}").length > 0`, 15000); } catch { /* пусто — это и есть находка */ }
      inventory.disciplines[page] = await cdp.eval(`(() => {
        const registry = Object.keys(window.PSY_DISCIPLINES || {});
        const titles = [...document.querySelectorAll('${sel}')].map((b) => (b.innerText || '').trim().replace(/\\s+/g, ' '));
        const body = document.body.innerText;
        const missing = registry
          .map((id) => window.PSY_DISCIPLINES[id])
          .filter((d) => !titles.some((t) => t.includes(d.short) || t.includes(d.title)) && !body.includes(d.title))
          .map((d) => d.title);
        const emptyMarkers = ['пока нет', 'нет материалов', 'билетов нет', 'Вопросов нет', 'Статей нет', 'В этой теме пока нет', 'Ничего не найдено']
          .filter((s) => body.includes(s));
        return { registry: registry.length, tiles: titles.length, missing: missing.length, missingTitles: missing, titles, emptyMarkers };
      })()`);
    }

    // Первый экран главной на телефоне: что видно без прокрутки
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'index.html', 900);
    inventory.firstScreen = await cdp.eval(`(() => {
      const vh = innerHeight;
      const tiles = [...document.querySelectorAll('.menu-item')].map((a) => {
        const r = a.getBoundingClientRect();
        return {
          title: ((a.querySelector('h2') || {}).innerText || '').trim(),
          href: a.getAttribute('href'),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom)
        };
      });
      const banner = document.getElementById('consent-banner');
      const br = banner ? banner.getBoundingClientRect() : null;
      return {
        vh,
        docHeight: document.documentElement.scrollHeight,
        tiles: tiles.length,
        allTiles: tiles,
        visibleTiles: tiles.filter((t) => t.top >= 0 && t.top < vh).map((t) => t.title),
        disciplineLinks: tiles.filter((t) => /psych|discipline/i.test(t.href || '')).length,
        banner: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom), h: Math.round(br.height) } : null,
        consentBannerHeight: br ? Math.round(br.height) : null
      };
    })()`);

    // Закладки: коллизия по номеру билета из разных дисциплин (N6)
    await goto(cdp, base, 'tickets.html', 900);
    inventory.bookmarkCollision = await cdp.eval(`(() => {
      localStorage.removeItem('hub_bookmarks');
      const first = typeof toggleBookmark === 'function'
        ? toggleBookmark(1, 'Билет 1 — общая', 'ticket', { folder: 'general-psych', discipline: 'general-psych' })
        : 'нет toggleBookmark';
      const second = typeof toggleBookmark === 'function'
        ? toggleBookmark(1, 'Билет 1 — возрастная', 'ticket', { folder: 'developmental-psych', discipline: 'developmental-psych' })
        : 'нет toggleBookmark';
      const left = JSON.parse(localStorage.getItem('hub_bookmarks') || '[]');
      localStorage.removeItem('hub_bookmarks');
      if (typeof refreshBookmarksUi === 'function') refreshBookmarksUi();
      return { first, second, left: left.length, saved: left.map((b) => ({ id: b.id, title: b.title, folder: b.folder })) };
    })()`);

    // Баннер согласия и кнопки внизу: что реально накрыто на первом визите.
    // elementFromPoint показывает, куда попадёт палец — это и есть доказательство.
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'tickets.html', 1200);
    await cdp.eval('localStorage.removeItem("analytics_consent")');
    await cdp.send('Page.reload');
    await sleep(2500);
    const hitProbe = `(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return 'none';
        const r = el.getBoundingClientRect();
        return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) };
      };
      const inter = (a, b) => a && a !== 'none' && b && b !== 'none'
        ? Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) * Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
        : 0;
      const who = (el) => (el ? (el.id || el.className || el.tagName || '').toString().slice(0, 40) : null);
      const banner = box('#consent-banner');
      const fab = box('#bookmarks-fab') || box('.bookmarks-fab');
      const top = box('#scroll-top-btn');
      return {
        banner, fab, top,
        fabArea: inter(banner, fab),
        topArea: inter(banner, top),
        fabHit: fab && fab !== 'none' ? who(document.elementFromPoint(fab.l + 20, fab.t + 20)) : null,
        topHit: top && top !== 'none' ? who(document.elementFromPoint(top.l + 20, top.t + 20)) : null
      };
    })()`;
    inventory.bannerCover = await cdp.eval(hitProbe);
    await cdp.eval('document.querySelector(".consent-banner button.secondary") && document.querySelector(".consent-banner button.secondary").click()');
    await sleep(600);
    inventory.bannerCoverAfterDismiss = await cdp.eval(hitProbe);

    // Плитки дисциплин на телефоне: не режется ли название и «скролл в скролле»
    inventory.mobileTiles390 = await cdp.eval(`(() => {
      const box = document.getElementById('mobile-tickets-tiles');
      const tiles = [...document.querySelectorAll('#mobile-tickets-tiles .mobile-tile-btn')].map((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return {
          text: (b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 70),
          w: Math.round(r.width), h: Math.round(r.height),
          scrollH: b.scrollHeight, clientH: b.clientHeight,
          clipped: b.scrollHeight > b.clientHeight + 2 || b.scrollWidth > b.clientWidth + 2,
          overflow: s.overflow
        };
      });
      return {
        container: box ? { h: Math.round(box.getBoundingClientRect().height), scrollH: box.scrollHeight, clientH: box.clientHeight, overflowY: getComputedStyle(box).overflowY } : null,
        tiles
      };
    })()`);

    // Печать билета: конспект виден, обвязка скрыта
    await setViewport(cdp, 1440, 900, false);
    await goto(cdp, base, 'tickets.html', 800);
    await waitFor(cdp, 'document.querySelector(".folder-nav-btn")');
    await cdp.eval('document.querySelector(".folder-nav-btn").click()');
    await sleep(500);
    await cdp.eval('document.querySelector(".question-nav-btn") && document.querySelector(".question-nav-btn").click()');
    await sleep(900);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(300);
    const printed = await cdp.eval(`(() => {
      const vis = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
      };
      return {
        header: vis('header'), nav: vis('.nav-left'), footer: vis('.site-footer'),
        fab: vis('#bookmarks-fab'), top: vis('#scroll-top-btn'), viewer: vis('.ticket-viewer'),
        viewerText: (document.querySelector('.ticket-viewer') ? document.querySelector('.ticket-viewer').innerText.length : 0)
      };
    })()`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });
    c.ok(
      printed.viewer && printed.viewerText > 500 && !printed.header && !printed.footer && !printed.fab && !printed.top,
      'печать: конспект виден, шапка/меню/кнопки/подвал скрыты',
      printed
    );

    // Клавиатура на главной (телефон): Tab обходит видимые элементы, кольцо фокуса есть
    await setViewport(cdp, 390, 844, true);
    await goto(cdp, base, 'index.html', 900);
    const order = [];
    for (let i = 0; i < 12; i++) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await sleep(70);
      order.push(await cdp.eval(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
          text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
          visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0,
          focusVisible: el.matches(':focus-visible')
        };
      })()`));
    }
    const focused = order.filter(Boolean);
    c.ok(focused.length >= 8 && focused.every((x) => x.visible), 'клавиатура: Tab обходит видимые элементы главной', { focused: focused.length, order });

    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clsScript.identifier });

    fs.mkdirSync(path.dirname(ART), { recursive: true });
    fs.writeFileSync(ART, JSON.stringify({
      generatedAt: new Date().toISOString(),
      base,
      viewports: VIEWPORTS.map(([w, h]) => `${w}x${h}`),
      pages: PAGES.map((p) => p[0]),
      runs,
      inventory,
      print: printed,
      keyboard: order
    }, null, 2));
  }
};

const argv = process.argv.slice(2);
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;
const baseArg = argv.find((a) => a.startsWith('--base='));
const externalBase = baseArg ? baseArg.slice(7).replace(/\/$/, '') : null;
const jsonOnly = argv.includes('--json');

// --base=https://... проверяет уже задеплоенную сборку, без локального сервера
const local = externalBase ? null : await startServer();
const base = externalBase || `http://127.0.0.1:${local.port}`;
const devtoolsPort = 9333 + (process.pid % 200);
const { child, profile } = await launchChrome(devtoolsPort);
let failed = 0;
const report = [];

try {
  const cdp = await openPage(devtoolsPort);
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    const c = new Checks(name);
    const t0 = Date.now();
    try {
      await run(cdp, base, c);
    } catch (e) {
      c.ok(false, 'сценарий упал: ' + e.message);
    }
    const ok = c.failed.length === 0;
    if (!ok) failed += 1;
    report.push({ scenario: name, ok, ms: Date.now() - t0, checks: c.list });
    if (!jsonOnly) {
      console.log(`\n${ok ? '✔' : '✘'} ${name} (${Date.now() - t0} мс)`);
      for (const ch of c.list) {
        if (!ch.pass) console.log(`   ✘ ${ch.label}${ch.detail ? ' — ' + JSON.stringify(ch.detail) : ''}`);
      }
    }
  }
} finally {
  // Chrome на Windows отпускает папку профиля не мгновенно, а child.kill()
  // убивает только стартовый процесс: гасим браузер через CDP, потом дерево.
  await closeChromeViaCdp(devtoolsPort);
  child.kill();
  if (local) local.server.close();
  let removed = false;
  for (let i = 0; i < 20 && !removed; i++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      removed = true;
    } catch (e) {
      await sleep(250);
    }
  }
  if (!removed) console.warn('⚠️ Временный профиль Chrome остался в %TEMP%:', profile);
}

if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  const total = report.reduce((n, r) => n + r.checks.length, 0);
  const passed = report.reduce((n, r) => n + r.checks.filter((c) => c.pass).length, 0);
  console.log(`\nИтог: ${passed}/${total} проверок, сценариев с ошибками: ${failed}`);
}
process.exit(failed ? 1 : 0);
