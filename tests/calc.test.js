// 계산 규칙 자동 테스트. npm test 로 실행한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculate, subtotalMapOf, normalizePort, parseDate } from '../public/calc.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rates = JSON.parse(readFileSync(join(root, 'public/data/rates.json'), 'utf8'));
const sources = JSON.parse(readFileSync(join(root, 'public/data/sources.json'), 'utf8'));

/** 정상 문의(① 정보 충분)를 사람이 확인한 뒤의 입력값 */
const NORMAL = {
  requester: '홍길동',
  origin: 'KRPUS',
  destination: 'VNHPH',
  containerType: 'GP',
  containerSize: '20',
  quantity: 2,
  weightPerContainer: 8000,
  blCount: 1,
  commodity: '플라스틱 수납용기',
  readyDate: '2026-09-22',
  departureDate: '2026-09-25',
  hazardous: 'no',
  serviceScope: 'CY-CY',
};

const withInput = (patch) => ({ ...NORMAL, ...patch });
const run = (patch) => calculate(withInput(patch), rates, sources);
const heldIds = (result) => result.held.map((h) => h.id).sort();

describe('① 정상 — 20GP 2대, B/L 1건, 출항 2026-09-25', () => {
  const result = calculate(NORMAL, rates, sources);

  test('통화별 소계가 USD 1280 · KRW 340290 · VND 950000', () => {
    assert.deepEqual(subtotalMapOf(result), { USD: 1280, KRW: 340290, VND: 950000 });
  });

  test('보류 항목이 없다', () => {
    assert.deepEqual(result.held, []);
  });

  test('요율 7줄이 모두 계산된다', () => {
    assert.equal(result.lines.length, 7);
  });

  test('컨테이너당 비용은 수량 2를, B/L당 비용은 건수 1을 곱한다', () => {
    const ocean = result.lines.find((l) => l.id === 'ocean');
    const odoc = result.lines.find((l) => l.id === 'odoc');
    assert.equal(ocean.multiplier, 2);
    assert.equal(ocean.amount, 600);
    assert.equal(odoc.multiplier, 1);
    assert.equal(odoc.amount, 40000);
  });

  test('통화를 서로 더하지 않는다 — 소계가 통화마다 따로 나온다', () => {
    assert.equal(result.subtotals.length, 3);
    assert.deepEqual(result.subtotals.map((s) => s.currency), ['USD', 'KRW', 'VND']);
    assert.ok(result.subtotals.every((s) => s.partial === false));
  });

  test('출처와 공개/추정 구분이 각 줄에 붙는다', () => {
    const lsf = result.lines.find((l) => l.id === 'lsf');
    const ocean = result.lines.find((l) => l.id === 'ocean');
    assert.equal(lsf.provenance, 'public');
    assert.equal(lsf.sourceId, 'SK-LSF-Q3');
    assert.equal(ocean.provenance, 'estimate');
    assert.ok(ocean.assumption.length > 0);
  });
});

describe('수량 2 → 3 — 컨테이너당만 늘고 B/L당은 그대로', () => {
  const result = run({ quantity: 3 });

  test('소계가 USD 1920 · KRW 490435 · VND 950000', () => {
    assert.deepEqual(subtotalMapOf(result), { USD: 1920, KRW: 490435, VND: 950000 });
  });

  test('B/L 비용은 수량이 늘어도 그대로', () => {
    const odoc = result.lines.find((l) => l.id === 'odoc');
    const ddoc = result.lines.find((l) => l.id === 'ddoc');
    assert.equal(odoc.amount, 40000);
    assert.equal(ddoc.amount, 950000);
  });

  test('화면 고정값이 아니라 원본 단가 × 수량으로 계산된다', () => {
    const ocean = result.lines.find((l) => l.id === 'ocean');
    const rate = rates.find((r) => r.id === 'ocean');
    assert.equal(ocean.unit, rate.amounts['20']);
    assert.equal(ocean.amount, rate.amounts['20'] * 3);
  });
});

describe('② 수량 누락 — 컨테이너당 비용을 계산하지 않는다', () => {
  const result = run({ quantity: null });

  test('컨테이너당 요율 5줄이 모두 보류된다', () => {
    assert.deepEqual(heldIds(result), ['dthc', 'lsf', 'ocean', 'othc', 'tsf']);
  });

  test('보류 사유에 수량 확인이 들어간다', () => {
    assert.ok(result.held.every((h) => h.reason.includes('수량')));
  });

  test('수량을 1로 지어내지 않는다 — 계산된 줄에 컨테이너당 항목이 없다', () => {
    assert.ok(result.lines.every((l) => l.basis === 'bl'));
  });

  test('보류가 섞인 통화는 부분 소계로 표시된다', () => {
    const usd = result.subtotals.find((s) => s.currency === 'USD');
    const krw = result.subtotals.find((s) => s.currency === 'KRW');
    assert.equal(usd.partial, true);
    assert.equal(krw.partial, true);
  });

  test('사람이 수량을 넣으면 그때 계산된다', () => {
    assert.deepEqual(subtotalMapOf(run({ quantity: 2 })), { USD: 1280, KRW: 340290, VND: 950000 });
  });
});

describe('③ HC 요율 없음 — GP 요율을 대신 쓰지 않는다', () => {
  const result = run({ containerType: 'HC', containerSize: '40' });

  test('모든 줄이 보류된다', () => {
    assert.equal(result.lines.length, 0);
    assert.equal(result.held.length, 7);
  });

  test('보류 사유에 GP 대체 적용 불가가 들어간다', () => {
    assert.ok(result.held.some((h) => h.reason.includes('GP 요율을 대신 적용할 수 없습니다')));
  });

  test('계산된 금액이 하나도 없다', () => {
    assert.deepEqual(subtotalMapOf(result), {});
  });

  test('RF도 마찬가지로 보류된다', () => {
    const rf = run({ containerType: 'RF' });
    assert.equal(rf.lines.length, 0);
  });
});

describe('④ 적용기간 밖 — 출항 2026-10-08, 3분기 LSF 종료', () => {
  const result = run({ readyDate: '2026-10-05', departureDate: '2026-10-08' });

  test('LSF만 보류된다', () => {
    assert.deepEqual(heldIds(result), ['lsf']);
  });

  test('보류 사유에 적용기간이 적힌다', () => {
    const lsf = result.held.find((h) => h.id === 'lsf');
    assert.ok(lsf.reason.includes('2026-07-01 ~ 2026-09-30'));
  });

  test('USD는 부분 소계 880', () => {
    const usd = result.subtotals.find((s) => s.currency === 'USD');
    assert.equal(usd.amount, 880);
    assert.equal(usd.partial, true);
  });

  test('KRW·VND는 영향 없이 그대로', () => {
    const map = subtotalMapOf(result);
    assert.equal(map.KRW, 340290);
    assert.equal(map.VND, 950000);
    assert.equal(result.subtotals.find((s) => s.currency === 'KRW').partial, false);
  });

  test('종료일이 null인 요율(TSF·THC)은 기간 제한이 없다', () => {
    assert.ok(result.lines.some((l) => l.id === 'tsf'));
    assert.ok(result.lines.some((l) => l.id === 'othc'));
  });
});

describe('날짜 검사', () => {
  test('형식은 맞지만 달력에 없는 날짜는 보류된다', () => {
    const result = run({ departureDate: '2026-02-30' });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'departure-invalid'));
  });

  test('2026-11-31은 없는 날짜다', () => {
    assert.equal(parseDate('2026-11-31'), null);
  });

  test('윤년이 아닌 해의 2월 29일은 없는 날짜다', () => {
    assert.equal(parseDate('2026-02-29'), null);
    assert.notEqual(parseDate('2028-02-29'), null);
  });

  test('준비일이 출항일보다 늦으면 보류된다', () => {
    const result = run({ readyDate: '2026-09-26', departureDate: '2026-09-25' });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'date-order'));
  });

  test('출항일이 비면 적용기간을 확인할 수 없어 보류된다', () => {
    const result = run({ departureDate: null });
    assert.equal(result.lines.length, 0);
  });
});

describe('수량 유효성', () => {
  test('음수는 보류된다', () => {
    const result = run({ quantity: -1 });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'quantity-negative'));
  });

  test('소수는 보류된다', () => {
    const result = run({ quantity: 2.5 });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'quantity-fraction'));
  });

  test('0은 보류된다', () => {
    const result = run({ quantity: 0 });
    assert.equal(result.lines.length, 0);
  });
});

describe('지원 범위 — GP · 비위험물 · CY-CY', () => {
  test('위험물이면 일반 요율을 적용하지 않는다', () => {
    const result = run({ hazardous: 'yes' });
    assert.equal(result.lines.length, 0);
  });

  test('위험물 여부가 비면 일반 요율을 적용하지 않는다', () => {
    const result = run({ hazardous: null });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'hazardous-missing'));
  });

  test('CY-CY가 아니면 보류된다', () => {
    const result = run({ serviceScope: 'DOOR-DOOR' });
    assert.equal(result.lines.length, 0);
  });

  test('운송 범위가 비면 보류된다', () => {
    const result = run({ serviceScope: null });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'scope-missing'));
  });
});

describe('항구 코드 — 정확한 코드와 등록된 별칭만', () => {
  test('정확한 코드를 인정한다', () => {
    assert.equal(normalizePort('KRPUS'), 'KRPUS');
    assert.equal(normalizePort('VNHPH'), 'VNHPH');
  });

  test('등록된 별칭을 인정한다', () => {
    assert.equal(normalizePort('부산'), 'KRPUS');
    assert.equal(normalizePort('부산항'), 'KRPUS');
    assert.equal(normalizePort('하이퐁'), 'VNHPH');
  });

  test('일부 글자가 포함됐다는 이유로 맞다고 보지 않는다', () => {
    assert.equal(normalizePort('KRPUSAN'), null);
    assert.equal(normalizePort('부산광역시 신항'), null);
    assert.equal(normalizePort('KRP'), null);
    assert.equal(normalizePort('VNHPHX'), null);
  });

  test('인식하지 못한 항구는 보류된다', () => {
    const result = run({ origin: 'KRPUSAN' });
    assert.equal(result.lines.length, 0);
    assert.ok(result.blockers.some((b) => b.code === 'origin-unknown'));
  });
});

describe('통화 분리', () => {
  test('서로 다른 통화가 하나로 합쳐지지 않는다', () => {
    const result = calculate(NORMAL, rates, sources);
    const sum = result.subtotals.reduce((acc, s) => acc + s.amount, 0);
    // 1280 + 340290 + 950000 = 1291570 — 이 값이 "총합"으로 쓰이면 안 된다
    assert.equal(result.subtotals.length, 3, '통화가 합쳐지지 않고 3줄로 남아야 한다');
    assert.notEqual(sum, subtotalMapOf(result).USD);
  });

  test('환산 결과를 만들지 않는다 — 소계에 KRW 환산 필드가 없다', () => {
    const result = calculate(NORMAL, rates, sources);
    assert.ok(result.subtotals.every((s) => !('converted' in s)));
  });
});
