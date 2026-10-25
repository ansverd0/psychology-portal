// Проверка локальных библиотек: версия, размер и sha256 совпадают с manifest.json.
// Запуск: node scripts/check-vendor.mjs
// Обновить хэши после осознанной замены файла: node scripts/check-vendor.mjs --update
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const vendorDir = path.resolve(import.meta.dirname, '..', 'js', 'vendor');
const manifestPath = path.join(vendorDir, 'manifest.json');
const update = process.argv.includes('--update');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let failed = 0;

for (const entry of manifest.files) {
  const filePath = path.join(vendorDir, entry.file);
  if (!fs.existsSync(filePath)) {
    console.error(`✗ ${entry.file}: файл не найден`);
    failed++;
    continue;
  }

  const bytes = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  if (update) {
    entry.bytes = bytes.length;
    entry.sha256 = sha256;
    console.log(`↻ ${entry.file}: обновлён (${bytes.length} Б, ${sha256.slice(0, 12)}…)`);
    continue;
  }

  const problems = [];
  if (sha256 !== entry.sha256) problems.push(`sha256 ${sha256} ≠ ${entry.sha256}`);
  if (bytes.length !== entry.bytes) problems.push(`размер ${bytes.length} ≠ ${entry.bytes}`);

  if (problems.length) {
    console.error(`✗ ${entry.file} (${entry.version}): ${problems.join('; ')}`);
    failed++;
  } else {
    console.log(`✓ ${entry.file} ${entry.version} — sha256 совпадает`);
  }
}

if (update) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('manifest.json обновлён. Не забудьте поднять CACHE_NAME в sw.js.');
  process.exit(0);
}

console.log(failed ? `\n${failed} файл(ов) не прошли проверку.` : '\nВсе библиотеки совпадают с manifest.json.');
process.exit(failed ? 1 : 0);
