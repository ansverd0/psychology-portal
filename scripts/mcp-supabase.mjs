// Запуск Supabase MCP-сервера с PAT из .env.
// Нужен, чтобы токен не лежал в .mcp.json / настройках IDE.
// Запуск: node scripts/mcp-supabase.mjs

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) throw new Error(`.env не найден: ${file}`);
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

let env;
try {
  env = readEnv();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

if (!env.SUPABASE_PAT || !env.SUPABASE_PROJECT_REF) {
  console.error('В .env нужны SUPABASE_PAT и SUPABASE_PROJECT_REF');
  process.exit(1);
}

const cli = path.join(root, 'node_modules', '@supabase', 'mcp-server-supabase', 'dist', 'cli.js');
if (!fs.existsSync(cli)) {
  console.error(`MCP-сервер не установлен: ${cli}\nВыполните: npm install`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [cli, '--project-ref', env.SUPABASE_PROJECT_REF, '--access-token', env.SUPABASE_PAT],
  { stdio: 'inherit' }
);

child.on('error', (err) => {
  console.error('Не удалось запустить MCP-сервер:', err.message);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
