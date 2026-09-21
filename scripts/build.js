// 정적 사이트라 번들링이 필요 없다. 배포 전에 필수 파일과 데이터가 제자리에 있는지만 확인한다.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/data/inquiries.json',
  'public/data/rates.json',
  'public/data/sources.json',
];

let failed = 0;
for (const rel of required) {
  const full = join(root, rel);
  if (!existsSync(full)) {
    console.error(`[build] 없음: ${rel}`);
    failed++;
    continue;
  }
  if (rel.endsWith('.json')) {
    try {
      JSON.parse(readFileSync(full, 'utf8'));
    } catch (err) {
      console.error(`[build] JSON 오류: ${rel} — ${err.message}`);
      failed++;
      continue;
    }
  }
  console.log(`[build] 확인: ${rel}`);
}

if (failed > 0) {
  console.error(`\n[build] 실패 ${failed}건`);
  process.exit(1);
}
console.log('\n[build] 성공');
