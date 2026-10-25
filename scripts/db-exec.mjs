// Выполнение SQL-миграции через Management API Supabase.
// Запуск: node scripts/db-exec.mjs db/migration.sql [--dry-run]
// --dry-run подменяет финальный COMMIT на ROLLBACK (PostgreSQL DDL транзакционен).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const sqlFile = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');

if (!sqlFile) {
  console.error('Укажите файл миграции: node scripts/db-exec.mjs db/file.sql [--dry-run]');
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

if (!env.SUPABASE_PAT || !env.SUPABASE_PROJECT_REF) {
  console.error('В .env нужны SUPABASE_PAT и SUPABASE_PROJECT_REF');
  process.exit(1);
}

let sql = fs.readFileSync(path.resolve(sqlFile), 'utf8');
if (dryRun) {
  if (!/\bcommit;\s*$/i.test(sql)) {
    console.error('Для --dry-run файл должен заканчиваться COMMIT;');
    process.exit(1);
  }
  sql = sql.replace(/\bcommit;\s*$/i, 'rollback;');
  console.log('DRY RUN: COMMIT заменён на ROLLBACK');
}

const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.SUPABASE_PAT}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 2000));
if (!res.ok) process.exit(1);
