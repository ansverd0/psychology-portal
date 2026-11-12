// Импорт контента из materials/<дисциплина>/content в Supabase.
// Запуск:
//   node scripts/content-import.mjs materials/general-psych            # проверка
//   node scripts/content-import.mjs materials/general-psych --apply    # запись
//   node scripts/content-import.mjs --export materials/general-psych/content
//   node scripts/content-import.mjs --export .audit/exam --discipline general-psych   # только одна дисциплина
// Идемпотентно: записи обновляются по естественному ключу, дублей не появляется.
// Поля статей: файл — источник истины; поле source пишется в БД как есть (нет в файле — в БД null).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const exportIdx = args.indexOf('--export');
const exportDir = exportIdx > -1 ? args[exportIdx + 1] : null;
const discIdx = args.indexOf('--discipline');
const exportDisciplineArg = discIdx > -1 ? args[discIdx + 1] : null;
const target = args.find((a, i) => !a.startsWith('--')
  && !(exportIdx > -1 && i === exportIdx + 1)
  && !(discIdx > -1 && i === discIdx + 1));

const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const URL_BASE = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE;
if (!URL_BASE || !SERVICE) {
  console.error('В .env нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(path.join(root, 'materials/disciplines.json'), 'utf8'));
const CANONICAL = registry.canonical || {};
const ALIASES = registry.aliases || {};

const TYPES = {
  articles: { table: 'articles', key: ['discipline_id', 'title'] },
  tickets: { table: 'tickets', key: ['discipline_id', 'number'] },
  flashcards: { table: 'flashcards', key: ['discipline_id', 'term'] },
  tests: { table: 'tests', key: ['discipline_id', 'question'] },
  library: { table: 'library', key: ['title', 'author'] },
  practice: { table: 'practice_tasks', key: ['discipline_id', 'slug'] }
};

const errors = [];
const warnings = [];

function fail(where, message) {
  errors.push(`${where}: ${message}`);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function checkLength(where, field, value, min, max) {
  if (typeof value !== 'string') {
    fail(where, `${field} должен быть строкой`);
    return false;
  }
  const length = value.trim().length;
  if (length < min) {
    fail(where, `${field} короче ${min} символов`);
    return false;
  }
  if (length > max) {
    fail(where, `${field} длиннее ${max} символов`);
    return false;
  }
  return true;
}

function checkHtml(where, value) {
  if (typeof value !== 'string') return;
  if (/<script/i.test(value) || /\son[a-z]+\s*=/i.test(value) || /javascript:/i.test(value)) {
    fail(where, 'в HTML есть script или inline-обработчик');
  }
}

function canonicalDiscipline(where, value) {
  const raw = text(value);
  if (!raw) {
    fail(where, 'не указана дисциплина');
    return null;
  }
  const id = ALIASES[raw] || raw;
  if (!CANONICAL[id]) {
    fail(where, `неизвестная дисциплина "${raw}" — добавь её в materials/disciplines.json`);
    return null;
  }
  return id;
}

function validateArticle(row, where) {
  if (!checkLength(where, 'title', row.title, 3, 200)) return null;
  if (!checkLength(where, 'content', row.content, 50, 100000)) return null;
  if (row.source != null && typeof row.source !== 'string') {
    fail(where, 'source должен быть строкой');
    return null;
  }
  if (typeof row.source === 'string' && row.source.trim().length > 500) {
    fail(where, 'source длиннее 500 символов');
    return null;
  }
  checkHtml(where, row.content);
  return {
    discipline_id: canonicalDiscipline(where, row.discipline_id),
    title: text(row.title),
    content: text(row.content),
    source: row.source ? text(row.source) : null,
    ai_generated: Boolean(row.ai_generated)
  };
}

function validateTicket(row, where) {
  if (!checkLength(where, 'title', row.title, 3, 600)) return null;
  if (!checkLength(where, 'content', row.content, 50, 100000)) return null;
  checkHtml(where, row.content);
  const number = String(text(row.number) ?? '');
  if (!number) {
    fail(where, 'не указан номер билета');
    return null;
  }
  const books = Array.isArray(row.books) ? row.books.map(text).filter(Boolean) : [];
  return {
    discipline_id: canonicalDiscipline(where, row.discipline_id),
    number,
    title: text(row.title),
    recommend_time: row.recommend_time ? text(row.recommend_time) : null,
    plan: row.plan ? text(row.plan) : null,
    content: text(row.content),
    books,
    ai_generated: Boolean(row.ai_generated)
  };
}

function validateFlashcard(row, where) {
  if (!checkLength(where, 'term', row.term, 2, 150)) return null;
  if (!checkLength(where, 'definition', row.definition, 10, 1000)) return null;
  return { discipline_id: canonicalDiscipline(where, row.discipline_id), term: text(row.term), definition: text(row.definition) };
}

function validateTest(row, where) {
  if (!checkLength(where, 'question', row.question, 5, 500)) return null;
  if (!Array.isArray(row.options) || row.options.length < 2 || row.options.length > 6) {
    fail(where, 'options: нужно от 2 до 6 вариантов');
    return null;
  }
  const options = row.options.map((o) => text(o));
  if (options.some((o) => typeof o !== 'string' || !o.length || o.length > 300)) {
    fail(where, 'options: пустой или слишком длинный вариант');
    return null;
  }
  if (new Set(options).size !== options.length) {
    fail(where, 'options: повторяющиеся варианты');
    return null;
  }
  if (!Number.isInteger(row.correct_index) || row.correct_index < 0 || row.correct_index >= options.length) {
    fail(where, 'correct_index вне диапазона вариантов');
    return null;
  }
  const link = row.link_url ? text(row.link_url) : null;
  if (link && !/^(https?:\/\/|\.?\/?[a-z0-9-]+\.html)/i.test(link)) {
    fail(where, 'link_url: только относительная ссылка или http(s)');
    return null;
  }
  return {
    discipline_id: canonicalDiscipline(where, row.discipline_id),
    question: text(row.question),
    options,
    correct_index: row.correct_index,
    link_url: link
  };
}

function validateBook(row, where) {
  if (!checkLength(where, 'title', row.title, 2, 300)) return null;
  if (!checkLength(where, 'author', row.author, 2, 200)) return null;
  if (!checkLength(where, 'annotation', row.annotation, 10, 2000)) return null;
  return { title: text(row.title), author: text(row.author), annotation: text(row.annotation) };
}

const PRACTICE_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

function validatePractice(row, where) {
  if (typeof row.slug !== 'string' || !/^[a-z0-9-]{3,64}$/.test(row.slug)) {
    fail(where, 'slug: только a-z, 0-9 и дефис, 3–64 символа');
    return null;
  }
  if (!PRACTICE_LEVELS.includes(row.level)) {
    fail(where, `level: один из ${PRACTICE_LEVELS.join(', ')}`);
    return null;
  }
  if (!['choice', 'open'].includes(row.kind)) {
    fail(where, 'kind: choice или open');
    return null;
  }
  if (!checkLength(where, 'title', row.title, 5, 200)) return null;
  if (!checkLength(where, 'situation', row.situation, 50, 5000)) return null;
  if (!checkLength(where, 'task', row.task, 20, 2000)) return null;

  if (!Array.isArray(row.criteria) || row.criteria.length < 3 || row.criteria.length > 5) {
    fail(where, 'criteria: массив из 3–5 строк');
    return null;
  }
  const criteria = row.criteria.map((item) => text(item));
  if (criteria.some((item) => typeof item !== 'string' || item.length < 10 || item.length > 300)) {
    fail(where, 'criteria: каждая строка 10–300 символов');
    return null;
  }

  const modelAnswer = row.model_answer == null ? null : text(row.model_answer);
  const explanation = row.explanation == null ? null : text(row.explanation);
  if (modelAnswer != null && typeof modelAnswer !== 'string') {
    fail(where, 'model_answer должен быть строкой или null');
    return null;
  }
  if (explanation != null && typeof explanation !== 'string') {
    fail(where, 'explanation должен быть строкой или null');
    return null;
  }
  let options = null;
  let correctIndex = null;

  if (row.kind === 'choice') {
    if (!Array.isArray(row.options) || row.options.length < 2 || row.options.length > 6) {
      fail(where, 'options: нужно от 2 до 6 вариантов');
      return null;
    }
    options = row.options.map((item) => text(item));
    if (options.some((item) => typeof item !== 'string' || !item.length || item.length > 300)) {
      fail(where, 'options: пустой или слишком длинный вариант');
      return null;
    }
    if (new Set(options).size !== options.length) {
      fail(where, 'options: повторяющиеся варианты');
      return null;
    }
    if (!Number.isInteger(row.correct_index) || row.correct_index < 0 || row.correct_index >= options.length) {
      fail(where, 'correct_index вне диапазона вариантов');
      return null;
    }
    correctIndex = row.correct_index;
    if (!checkLength(where, 'explanation', explanation, 20, 2000)) return null;
    if (modelAnswer != null && modelAnswer.length > 8000) {
      fail(where, 'model_answer длиннее 8000 символов');
      return null;
    }
  } else {
    if (row.options != null || row.correct_index != null) {
      fail(where, 'open: options и correct_index должны быть null');
      return null;
    }
    if (!checkLength(where, 'model_answer', modelAnswer, 50, 8000)) return null;
    if (explanation != null && explanation.length > 2000) {
      fail(where, 'explanation длиннее 2000 символов');
      return null;
    }
  }

  if (row.source != null && typeof row.source !== 'string') {
    fail(where, 'source должен быть строкой');
    return null;
  }
  if (typeof row.source === 'string' && row.source.trim().length > 500) {
    fail(where, 'source длиннее 500 символов');
    return null;
  }
  ['situation', 'task', 'model_answer', 'explanation'].forEach((field) => checkHtml(where, row[field]));

  const aiGenerated = row.ai_generated === undefined ? false : row.ai_generated;
  if (typeof aiGenerated !== 'boolean') {
    fail(where, 'ai_generated должен быть boolean');
    return null;
  }
  const active = row.active === undefined ? true : row.active;
  if (typeof active !== 'boolean') {
    fail(where, 'active должен быть boolean');
    return null;
  }
  const sortOrder = row.sort_order === undefined ? 0 : row.sort_order;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    fail(where, 'sort_order: целое 0–10000');
    return null;
  }
  if (row.competence != null && typeof row.competence !== 'string') {
    fail(where, 'competence должен быть строкой или null');
    return null;
  }

  return {
    discipline_id: canonicalDiscipline(where, row.discipline_id),
    slug: text(row.slug),
    level: row.level,
    competence: row.competence == null ? null : text(row.competence),
    title: text(row.title),
    situation: text(row.situation),
    task: text(row.task),
    kind: row.kind,
    options,
    correct_index: correctIndex,
    criteria,
    model_answer: modelAnswer,
    explanation,
    source: row.source == null ? null : text(row.source),
    ai_generated: aiGenerated,
    active,
    sort_order: sortOrder
  };
}

const VALIDATORS = {
  articles: validateArticle,
  tickets: validateTicket,
  flashcards: validateFlashcard,
  tests: validateTest,
  library: validateBook,
  practice: validatePractice
};

async function rest(endpoint, options = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

function keyOf(type, row) {
  return TYPES[type].key.map((k) => String(row[k] ?? '').trim().toLowerCase()).join('||');
}

function readSource(dirOrFile) {
  if (!fs.existsSync(dirOrFile)) {
    console.error(`Нет такого пути: ${dirOrFile}`);
    process.exit(1);
  }
  const files = {};
  if (fs.statSync(dirOrFile).isDirectory()) {
    const dir = fs.existsSync(path.join(dirOrFile, 'content')) ? path.join(dirOrFile, 'content') : dirOrFile;
    for (const type of Object.keys(TYPES)) {
      const file = path.join(dir, `${type}.json`);
      if (fs.existsSync(file)) files[type] = file;
    }
    if (!Object.keys(files).length) {
      console.error(`В папке ${dir} нет ни одного из файлов: ${Object.keys(TYPES).join(', ')}.json`);
      process.exit(1);
    }
  } else {
    const base = path.basename(dirOrFile, '.json');
    if (!TYPES[base]) {
      const names = Object.keys(TYPES).map((type) => `${type}.json`).join(', ');
      console.error(`По имени файла не понять тип. Назови файл одним из: ${names}`);
      process.exit(1);
    }
    files[base] = dirOrFile;
  }
  return files;
}

function loadRows(files) {
  const rows = {};
  for (const [type, file] of Object.entries(files)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      fail(path.basename(file), `не читается JSON: ${e.message}`);
      continue;
    }
    if (!Array.isArray(data)) {
      fail(path.basename(file), 'ожидается массив объектов');
      continue;
    }
    const list = [];
    const seen = new Set();
    data.forEach((item, index) => {
      const where = `${path.basename(file)}[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        fail(where, 'ожидается объект');
        return;
      }
      const allowed = TYPES[type].key.slice();
      if (type === 'articles') allowed.push('content', 'source', 'ai_generated');
      if (type === 'tickets') allowed.push('title', 'recommend_time', 'plan', 'content', 'books', 'ai_generated');
      if (type === 'tests') allowed.push('options', 'correct_index', 'link_url');
      if (type === 'library') allowed.push('annotation');
      if (type === 'flashcards') allowed.push('definition');
      if (type === 'practice') {
        allowed.push('level', 'competence', 'title', 'situation', 'task', 'kind', 'options', 'correct_index',
          'criteria', 'model_answer', 'explanation', 'source', 'ai_generated', 'active', 'sort_order');
      }
      Object.keys(item).forEach((k) => {
        if (!allowed.includes(k)) warnings.push(`${where}: лишнее поле "${k}" проигнорировано`);
      });

      const normalized = VALIDATORS[type](item, where);
      if (!normalized) return;
      if (TYPES[type].key.includes('discipline_id') && !normalized.discipline_id) return;
      const key = keyOf(type, normalized);
      if (seen.has(key)) {
        fail(where, `повтор внутри файла: ${key}`);
        return;
      }
      seen.add(key);
      list.push(normalized);
    });
    rows[type] = list;
  }
  return rows;
}

async function fetchExistingKeys(type) {
  const cols = TYPES[type].key.join(',');
  const data = await rest(`${TYPES[type].table}?select=${cols}`);
  return new Set((data || []).map((row) => keyOf(type, row)));
}

const DB_FIELDS = {
  articles: ['discipline_id', 'title', 'content', 'source', 'ai_generated'],
  tickets: ['discipline_id', 'number', 'title', 'recommend_time', 'plan', 'content', 'ai_generated'],
  flashcards: ['discipline_id', 'term', 'definition'],
  tests: ['discipline_id', 'question', 'options', 'correct_index', 'link_url'],
  library: ['title', 'author', 'annotation'],
  practice: ['discipline_id', 'slug', 'level', 'competence', 'title', 'situation', 'task', 'kind',
    'options', 'correct_index', 'criteria', 'model_answer', 'explanation', 'source',
    'ai_generated', 'active', 'sort_order']
};

function toDb(type, row) {
  const out = {};
  DB_FIELDS[type].forEach((field) => {
    out[field] = row[field] ?? (field === 'ai_generated' ? false : null);
  });
  return out;
}

async function upsert(type, rows) {
  const { table, key } = TYPES[type];
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50).map((row) => toDb(type, row));
    await rest(`${table}?on_conflict=${key.join(',')}`, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: chunk
    });
  }
}

async function validateBookRefs(tickets) {
  const withBooks = tickets.filter((t) => t.books.length);
  if (!withBooks.length) return;
  const books = await rest('library?select=id,title,author');
  const known = new Set();
  (books || []).forEach((b) => {
    known.add(`${b.author} — ${b.title}`.toLowerCase());
    known.add(b.title.toLowerCase());
  });
  withBooks.forEach((ticket) => {
    ticket.books.forEach((ref) => {
      if (!known.has(ref.toLowerCase())) {
        fail(`tickets/${ticket.number}`, `книги "${ref}" нет в library.json`);
      }
    });
  });
}

async function applyTicketsBooks(tickets) {
  const withBooks = tickets.filter((t) => t.books.length);
  if (!withBooks.length) return 0;

  const books = await rest('library?select=id,title,author');
  const byPair = new Map();
  const byTitle = new Map();
  (books || []).forEach((b) => {
    byPair.set(`${b.author} — ${b.title}`.toLowerCase(), b.id);
    byTitle.set(b.title.toLowerCase(), b.id);
  });

  const saved = await rest('tickets?select=id,number,discipline_id');
  const idByKey = new Map((saved || []).map((t) => [`${t.discipline_id}||${t.number}`, t.id]));

  const pairs = [];
  for (const ticket of withBooks) {
    const ticketId = idByKey.get(`${ticket.discipline_id}||${ticket.number}`);
    if (!ticketId) {
      fail(`tickets/${ticket.number}`, 'не найден id билета после записи');
      continue;
    }
    for (const ref of ticket.books) {
      const id = byPair.get(ref.toLowerCase()) || byTitle.get(ref.toLowerCase());
      if (!id) {
        fail(`tickets/${ticket.number}`, `книги "${ref}" нет в library.json`);
        continue;
      }
      pairs.push({ ticket_id: ticketId, book_id: id });
    }
  }

  if (pairs.length) {
    await rest('ticket_library?on_conflict=ticket_id,book_id', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: pairs
    });
  }
  return pairs.length;
}

async function exportContent(dir, discipline = null) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [type, cfg] of Object.entries(TYPES)) {
    const scoped = discipline && TYPES[type].key.includes('discipline_id');
    const filter = scoped ? `&discipline_id=eq.${encodeURIComponent(discipline)}` : '';
    let rows = await rest(`${cfg.table}?select=*${filter}`);
    if (type === 'tickets') {
      const links = await rest('ticket_library?select=ticket_id,book_id');
      const books = await rest('library?select=id,title,author');
      const bookById = new Map((books || []).map((b) => [b.id, b]));
      (rows || []).forEach((row) => {
        row.books = (links || [])
          .filter((l) => l.ticket_id === row.id)
          .map((l) => bookById.get(l.book_id))
          .filter(Boolean)
          .map((b) => `${b.author} — ${b.title}`);
      });
    }
    (rows || []).forEach((row) => delete row.id);
    if (type === 'practice') {
      (rows || []).forEach((row) => {
        delete row.created_at;
        delete row.updated_at;
      });
    }
    fs.writeFileSync(path.join(dir, `${type}.json`), JSON.stringify(rows, null, 2), 'utf8');
    console.log(`${type}: ${(rows || []).length} строк → ${path.join(dir, `${type}.json`)}${discipline && !scoped ? ' (таблица без дисциплины, выгружена целиком)' : ''}`);
  }
}

async function main() {
  if (exportDir) {
    let discipline = null;
    if (exportDisciplineArg) {
      const raw = text(exportDisciplineArg);
      discipline = ALIASES[raw] || raw;
      if (!CANONICAL[discipline]) {
        console.error(`Неизвестная дисциплина "${raw}" — сверься с materials/disciplines.json`);
        process.exit(1);
      }
      console.log(`Экспорт только по дисциплине: ${discipline}`);
    } else if (discIdx > -1) {
      console.error('После --discipline нужен id дисциплины');
      process.exit(1);
    }
    await exportContent(path.resolve(root, exportDir), discipline);
    return;
  }
  if (!target) {
    console.error('Укажи папку: node scripts/content-import.mjs materials/general-psych [--apply]');
    process.exit(1);
  }

  const files = readSource(path.resolve(root, target));
  const rows = loadRows(files);

  const existing = {};
  for (const type of Object.keys(rows)) {
    existing[type] = await fetchExistingKeys(type);
  }
  if (rows.tickets) await validateBookRefs(rows.tickets);

  for (const [type, list] of Object.entries(rows)) {
    const fresh = list.filter((r) => !existing[type].has(keyOf(type, r))).length;
    const updated = list.length - fresh;
    console.log(`${type}: ${list.length} строк — новых ${fresh}, обновлений ${updated}`);
  }

  if (errors.length) {
    console.error('\nОшибки:');
    errors.forEach((e) => console.error('  ' + e));
    process.exit(1);
  }
  if (warnings.length) {
    console.warn('\nПредупреждения:');
    warnings.forEach((w) => console.warn('  ' + w));
  }

  if (!apply) {
    console.log('\nПроверка пройдена. Запись не выполнялась (добавь --apply).');
    return;
  }

  for (const [type, list] of Object.entries(rows)) {
    if (!list.length) continue;
    await upsert(type, list);
    console.log(`записано: ${type} — ${list.length}`);
  }
  if (rows.tickets) {
    const links = await applyTicketsBooks(rows.tickets);
    if (links) console.log(`связей билет — книга: ${links}`);
  }
  console.log('Готово.');
}

main().catch((e) => {
  console.error('Импорт упал:', e.message);
  process.exit(1);
});
