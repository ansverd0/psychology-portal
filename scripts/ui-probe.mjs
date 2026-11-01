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
      return { tiles: tiles.length, sameRow: tiles.every((t) => Math.abs(t.getBoundingClientRect().y - tiles[0].getBoundingClientRect().y) <= 2) };
    })()`);
    c.ok(state.tiles === 3 && state.sameRow, '390 tickets: три плитки в одном ряду', state);

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
    for (const page of ['index.html', 'survey.html', 'tickets.html']) {
      await goto(cdp, base, page, 1500);
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
    c.ok(aboveFooter.top !== null && Math.abs(aboveFooter.scrollTopGap - 16) <= 1, '390: «наверх» остаётся у нижнего края (подъём только у закладок)', aboveFooter);
    c.ok(aboveFooter.fab !== null && aboveFooter.top !== null && aboveFooter.fab < aboveFooter.top, '390: закладки выше «наверх»', aboveFooter);

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
    // Без ключа страница показывает экран ввода ключа — сеем известный ключ,
    // иначе списка групп на странице нет
    const seed = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('research_user_key', 'белый-кедр-73'); } catch (e) {}`
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

    c.ok(true, 'скриншоты сняты');
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
  child.kill();
  if (local) local.server.close();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  const total = report.reduce((n, r) => n + r.checks.length, 0);
  const passed = report.reduce((n, r) => n + r.checks.filter((c) => c.pass).length, 0);
  console.log(`\nИтог: ${passed}/${total} проверок, сценариев с ошибками: ${failed}`);
}
process.exit(failed ? 1 : 0);
