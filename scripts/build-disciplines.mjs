// Генерирует js/disciplines.js из materials/disciplines.json.
// Запуск: node scripts/build-disciplines.mjs
// После правки реестра: пересобрать, поднять CACHE_NAME в sw.js, закоммитить.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'materials/disciplines.json'), 'utf8'));

const canonical = registry.canonical || {};
const aliases = registry.aliases || {};

const lines = [
  '// Сгенерировано из materials/disciplines.json — не править вручную.',
  '// Пересборка: node scripts/build-disciplines.mjs',
  '',
  'window.PSY_DISCIPLINES = ' + JSON.stringify(canonical, null, 4) + ';',
  '',
  'window.PSY_ALIASES = ' + JSON.stringify(aliases, null, 4) + ';',
  '',
  'window.psyDiscipline = function (id) {',
  '    var key = window.PSY_ALIASES[id] || id;',
  '    var d = window.PSY_DISCIPLINES[key];',
  '    if (d) {',
  '        return { id: key, title: d.title, short: d.short, icon: d.icon, course: d.course, order: d.order };',
  '    }',
  '    return { id: id, title: id, short: id, icon: \'📁\', course: 0, order: 999 };',
  '};',
  ''
];

fs.writeFileSync(path.join(root, 'js/disciplines.js'), lines.join('\n'), 'utf8');
console.log(`js/disciplines.js: ${Object.keys(canonical).length} дисциплин, ${Object.keys(aliases).length} псевдонимов`);
