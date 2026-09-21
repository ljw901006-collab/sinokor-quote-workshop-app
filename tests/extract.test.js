// AI가 뽑은 값을 서버가 검증하는 규칙 테스트.
// AI를 실제로 부르지 않는다 — 서버 가드만 확인한다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitize, countsIn, toNumber } from '../api/ai.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inquiries = JSON.parse(readFileSync(join(root, 'public/data/inquiries.json'), 'utf8'));
const textOf = (id) => inquiries.find((q) => q.id === id).text;

describe('수량 가드 — 원문에 "N대"가 있어야만 받는다', () => {
  test('정상 문의: AI가 2를 주면 받는다', () => {
    const { fields } = sanitize({ quantity: 2 }, textOf('normal'));
    assert.equal(fields.quantity, 2);
  });

  test('수량 누락 문의: AI가 1을 지어내도 서버가 비운다', () => {
    const { fields, dropped } = sanitize({ quantity: 1 }, textOf('missing'));
    assert.equal(fields.quantity, null);
    assert.ok(dropped.includes('quantity'));
  });

  test('수량 누락 문의: AI가 20(피트)을 수량으로 착각해도 비운다', () => {
    const { fields } = sanitize({ quantity: 20 }, textOf('missing'));
    assert.equal(fields.quantity, null);
  });

  test('정상 문의: AI가 원문에 없는 5를 주면 비운다', () => {
    const { fields } = sanitize({ quantity: 5 }, textOf('normal'));
    assert.equal(fields.quantity, null);
  });

  test('HC 문의: "2대"가 있으므로 2를 받는다', () => {
    const { fields } = sanitize({ quantity: 2 }, textOf('unsupported'));
    assert.equal(fields.quantity, 2);
  });
});

describe('B/L 건수 가드 — 원문에 "N건"이 있어야만 받는다', () => {
  test('정상 문의: 1건이 있으므로 받는다', () => {
    const { fields } = sanitize({ blCount: 1 }, textOf('normal'));
    assert.equal(fields.blCount, 1);
  });

  test('원문에 없는 3건은 비운다', () => {
    const { fields } = sanitize({ blCount: 3 }, textOf('normal'));
    assert.equal(fields.blCount, null);
  });

  test('세는 표현이 없는 글이면 비운다', () => {
    const { fields } = sanitize({ blCount: 1 }, '견적 부탁드립니다.');
    assert.equal(fields.blCount, null);
  });
});

describe('열거형 가드', () => {
  test('GP·HC·RF만 받는다', () => {
    assert.equal(sanitize({ containerType: 'GP' }, '').fields.containerType, 'GP');
    assert.equal(sanitize({ containerType: 'HC' }, '').fields.containerType, 'HC');
    assert.equal(sanitize({ containerType: 'REEFER' }, '').fields.containerType, null);
  });

  test('항구는 등록된 코드만 받는다', () => {
    assert.equal(sanitize({ origin: 'KRPUS' }, '').fields.origin, 'KRPUS');
    assert.equal(sanitize({ origin: 'KRINC' }, '').fields.origin, null);
  });

  test('운송 범위는 정해진 값만 받는다', () => {
    assert.equal(sanitize({ serviceScope: 'CY-CY' }, '').fields.serviceScope, 'CY-CY');
    assert.equal(sanitize({ serviceScope: '문전' }, '').fields.serviceScope, null);
  });

  test('위험물 여부는 no·yes만 받는다', () => {
    assert.equal(sanitize({ hazardous: 'no' }, '').fields.hazardous, 'no');
    assert.equal(sanitize({ hazardous: '비위험물' }, '').fields.hazardous, null);
  });
});

describe('날짜 가드 — 달력에 있는 날짜만', () => {
  test('정상 날짜를 받는다', () => {
    assert.equal(sanitize({ departureDate: '2026-09-25' }, '').fields.departureDate, '2026-09-25');
  });

  test('달력에 없는 날짜는 비운다', () => {
    assert.equal(sanitize({ departureDate: '2026-02-30' }, '').fields.departureDate, null);
  });

  test('형식이 다른 날짜는 비운다', () => {
    assert.equal(sanitize({ readyDate: '2026년 9월 22일' }, '').fields.readyDate, null);
  });
});

describe('숫자 변환', () => {
  test('쉼표와 단위가 섞인 문자열을 숫자로 바꾼다', () => {
    assert.equal(toNumber('8,000kg'), 8000);
    assert.equal(toNumber(8000), 8000);
  });

  test('숫자가 없으면 null', () => {
    assert.equal(toNumber('미확인'), null);
    assert.equal(toNumber(null), null);
  });

  test('중량은 숫자로 정규화된다', () => {
    assert.equal(sanitize({ weightPerContainer: '8,000kg' }, '').fields.weightPerContainer, 8000);
  });
});

describe('세는 표현 찾기', () => {
  test('정상 문의에서 "2대"를 찾는다', () => {
    assert.deepEqual([...countsIn(textOf('normal'), '대')], [2]);
  });

  test('수량 누락 문의에는 "N대"가 없다', () => {
    assert.equal(countsIn(textOf('missing'), '대').size, 0);
  });

  test('"1건"을 찾는다', () => {
    assert.deepEqual([...countsIn(textOf('normal'), '건')], [1]);
  });
});

describe('빈 값은 그대로 비운다', () => {
  test('null·빈 문자열은 null로 남는다', () => {
    const { fields, dropped } = sanitize({ requester: null, commodity: '' }, '');
    assert.equal(fields.requester, null);
    assert.equal(fields.commodity, null);
    // 애초에 값이 없던 건 "비워 둔 항목"으로 세지 않는다
    assert.equal(dropped.length, 0);
  });

  test('모든 필드가 응답에 들어 있다', () => {
    const { fields } = sanitize({}, '');
    assert.equal(Object.keys(fields).length, 13);
  });
});
