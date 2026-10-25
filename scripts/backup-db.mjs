// Дамп данных и security-состояния Supabase через Management API.
// Запуск: node scripts/backup-db.mjs [--out <папка>]
// Токен берётся из .env (SUPABASE_PAT, SUPABASE_PROJECT_REF), в файлы не пишется.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

if (!fs.existsSync(envPath)) {
  console.error(`.env не найден: ${envPath}`);
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const pat = env.SUPABASE_PAT;
const ref = env.SUPABASE_PROJECT_REF;
if (!pat || !ref) {
  console.error('В .env должны быть SUPABASE_PAT и SUPABASE_PROJECT_REF');
  process.exit(1);
}

const outArgIndex = process.argv.indexOf('--out');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = outArgIndex > -1
  ? path.resolve(process.argv[outArgIndex + 1])
  : path.join(root, 'backups', `${stamp}_db`);

fs.mkdirSync(outDir, { recursive: true });

const api = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function query(sql) {
  const res = await fetch(api, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const tables = (await query(
  "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"
)).map((r) => r.table_name);

const summary = [];
for (const table of tables) {
  const result = await query(
    `select coalesce(json_agg(t), '[]'::json) as data from public."${table}" t`
  );
  const rows = Array.isArray(result?.[0]?.data) ? result[0].data : [];
  const file = path.join(outDir, `${table}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
  summary.push({ table, rows: rows.length, bytes: fs.statSync(file).size });
}

const security = {
  exported_at: new Date().toISOString(),
  tables: await query(
    "select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1"
  ),
  policies: await query('select * from pg_policies where schemaname=\'public\' order by tablename, policyname'),
  grants: await query(
    "select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by 1,2 order by 2,1"
  ),
};
fs.writeFileSync(path.join(outDir, '_security_before.json'), JSON.stringify(security, null, 2), 'utf8');

console.table(summary);
console.log(`Backup: ${outDir}`);
console.log(`Total rows: ${summary.reduce((s, r) => s + r.rows, 0)}`);
