// 견적 계산. 브라우저와 Node 테스트에서 같은 코드를 쓴다.
//
// CLAUDE.md의 약속:
//  - 금액·소계·보류 판정은 코드가 한다. AI가 낸 숫자를 쓰지 않는다.
//  - 통화끼리 더하지 않는다. 환산하지 않는다.
//  - 컨테이너당 비용은 수량을, B/L당 비용은 B/L 건수를 곱한다.
//  - GP 요율을 HC·RF에 대신 쓰지 않는다.
//  - 적용기간 밖은 보류한다.

/** 지원하는 항구 코드와 별칭. 부분 일치는 인정하지 않는다. */
export const PORT_ALIASES = {
  KRPUS: ['KRPUS', 'BUSAN', 'PUSAN', '부산', '부산항'],
  VNHPH: ['VNHPH', 'HAIPHONG', 'HAI PHONG', '하이퐁', '하이퐁항'],
};

/** 이 앱이 계산을 지원하는 조건. 그 밖은 보류한다. */
export const SUPPORTED = {
  containerType: 'GP',
  hazardous: 'no',
  serviceScope: 'CY-CY',
};

/**
 * 항구 입력을 표준 코드로 바꾼다. 등록된 별칭과 정확히 같아야 한다.
 * 일부 글자가 포함됐다는 이유로 맞다고 보지 않는다.
 */
export function normalizePort(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed === '') return null;
  for (const [code, aliases] of Object.entries(PORT_ALIASES)) {
    if (aliases.some((alias) => alias.toUpperCase() === trimmed)) return code;
  }
  return null;
}

/**
 * YYYY-MM-DD 형식이면서 실제 달력에 있는 날짜인지 검사한다.
 * 2026-02-30 처럼 형식만 맞는 날짜는 거른다.
 */
export function parseDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Date가 넘겨받은 값을 굴려버리면(2월 30일 → 3월 2일) 실제로 없는 날짜다.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/** 출항일이 요율의 적용기간 안에 있는지. effectiveTo가 null이면 종료일 없음. */
export function isWithinPeriod(rate, departureDate) {
  const from = parseDate(rate.effectiveFrom);
  const to = rate.effectiveTo == null ? null : parseDate(rate.effectiveTo);
  if (from && departureDate < from) return false;
  if (to && departureDate > to) return false;
  return true;
}

/**
 * 입력값을 검사한다. 계산 자체를 막는 문제는 blockers에 담는다.
 * @returns {{ blockers: Array<{code: string, reason: string}>, departureDate: Date|null,
 *            origin: string|null, destination: string|null }}
 */
export function validateInput(input) {
  const blockers = [];
  const add = (code, reason) => blockers.push({ code, reason });

  // 항구
  const origin = normalizePort(input.origin);
  const destination = normalizePort(input.destination);
  if (input.origin == null || String(input.origin).trim() === '') {
    add('origin-missing', '출발항이 비어 있습니다. 사람 확인이 필요합니다.');
  } else if (!origin) {
    add('origin-unknown', `출발항 "${input.origin}"을 인식하지 못했습니다. 정확한 코드(KRPUS)로 넣어 주세요.`);
  }
  if (input.destination == null || String(input.destination).trim() === '') {
    add('destination-missing', '도착항이 비어 있습니다. 사람 확인이 필요합니다.');
  } else if (!destination) {
    add('destination-unknown', `도착항 "${input.destination}"을 인식하지 못했습니다. 정확한 코드(VNHPH)로 넣어 주세요.`);
  }

  // 컨테이너 종류 — GP만 지원
  if (input.containerType == null || input.containerType === '') {
    add('container-type-missing', '컨테이너 종류가 비어 있습니다. 사람 확인이 필요합니다.');
  } else if (input.containerType !== SUPPORTED.containerType) {
    add(
      'container-type-unsupported',
      `${input.containerType} 요율을 갖고 있지 않습니다. GP 요율을 대신 적용할 수 없습니다.`,
    );
  }

  // 크기
  if (input.containerSize == null || input.containerSize === '') {
    add('container-size-missing', '컨테이너 크기가 비어 있습니다. 사람 확인이 필요합니다.');
  }

  // 수량 — 빈 값은 채우지 않는다
  if (input.quantity == null || input.quantity === '') {
    add('quantity-missing', '수량이 원문에 없습니다. 사람이 확인해 넣어 주세요.');
  } else if (!Number.isFinite(Number(input.quantity))) {
    add('quantity-invalid', '수량이 숫자가 아닙니다.');
  } else if (Number(input.quantity) < 0) {
    add('quantity-negative', '수량이 음수입니다.');
  } else if (!Number.isInteger(Number(input.quantity))) {
    add('quantity-fraction', '수량이 소수입니다. 컨테이너는 정수 대수로 넣어 주세요.');
  } else if (Number(input.quantity) === 0) {
    add('quantity-zero', '수량이 0입니다. 사람 확인이 필요합니다.');
  }

  // B/L 건수
  if (input.blCount == null || input.blCount === '') {
    add('bl-missing', 'B/L 건수가 비어 있습니다. 사람 확인이 필요합니다.');
  } else if (!Number.isInteger(Number(input.blCount)) || Number(input.blCount) < 0) {
    add('bl-invalid', 'B/L 건수는 0 이상의 정수여야 합니다.');
  }

  // 위험물 · 운송 범위 — 비었거나 지원 밖이면 일반 요율을 적용하지 않는다
  if (input.hazardous == null || input.hazardous === '') {
    add('hazardous-missing', '위험물 여부가 비어 있습니다. 확인 전에는 일반 요율을 적용할 수 없습니다.');
  } else if (input.hazardous !== SUPPORTED.hazardous) {
    add('hazardous-unsupported', '위험물은 이 요율표의 지원 범위 밖입니다.');
  }
  if (input.serviceScope == null || input.serviceScope === '') {
    add('scope-missing', '운송 범위가 비어 있습니다. 확인 전에는 일반 요율을 적용할 수 없습니다.');
  } else if (input.serviceScope !== SUPPORTED.serviceScope) {
    add('scope-unsupported', `${input.serviceScope}는 이 요율표의 지원 범위(CY-CY) 밖입니다.`);
  }

  // 날짜
  const readyDate = parseDate(input.readyDate);
  const departureDate = parseDate(input.departureDate);
  if (input.readyDate == null || input.readyDate === '') {
    add('ready-missing', '화물 준비일이 비어 있습니다.');
  } else if (!readyDate) {
    add('ready-invalid', `화물 준비일 "${input.readyDate}"는 달력에 없는 날짜입니다.`);
  }
  if (input.departureDate == null || input.departureDate === '') {
    add('departure-missing', '희망 출항일이 비어 있습니다. 적용기간을 확인할 수 없습니다.');
  } else if (!departureDate) {
    add('departure-invalid', `희망 출항일 "${input.departureDate}"는 달력에 없는 날짜입니다.`);
  }
  if (readyDate && departureDate && readyDate > departureDate) {
    add('date-order', '화물 준비일이 희망 출항일보다 늦습니다.');
  }

  return { blockers, departureDate, origin, destination };
}

/**
 * 요율 한 줄이 이번 견적에 쓸 수 있는지 판정한다.
 * @returns {{ ok: true, unit: number, multiplier: number } | { ok: false, reason: string }}
 */
function evaluateRate(rate, input, ctx) {
  // 노선
  if (rate.origin !== ctx.origin || rate.destination !== ctx.destination) {
    return { ok: false, reason: '이 노선의 요율이 아닙니다.' };
  }

  // 컨테이너 종류 — GP 요율을 HC·RF에 대신 쓰지 않는다
  if (rate.containerType !== input.containerType) {
    return {
      ok: false,
      reason: `${input.containerType ?? '미입력'} 요율이 없습니다. ${rate.containerType} 요율을 대신 적용하지 않습니다.`,
    };
  }

  // 적용기간
  if (!ctx.departureDate) {
    return { ok: false, reason: '출항일을 알 수 없어 적용기간을 확인할 수 없습니다.' };
  }
  if (!isWithinPeriod(rate, ctx.departureDate)) {
    const to = rate.effectiveTo ?? '종료일 없음';
    return {
      ok: false,
      reason: `적용기간(${rate.effectiveFrom} ~ ${to}) 밖입니다. 출항일 ${input.departureDate}에는 쓸 수 없습니다.`,
    };
  }

  // 단가와 곱할 수
  if (rate.basis === 'container') {
    const unit = rate.amounts[String(input.containerSize)];
    if (unit == null) {
      return { ok: false, reason: `${input.containerSize ?? '미입력'}피트 단가가 요율표에 없습니다.` };
    }
    if (input.quantity == null || input.quantity === '') {
      return { ok: false, reason: '수량이 없어 계산하지 않습니다. 사람이 확인해 넣어 주세요.' };
    }
    const qty = Number(input.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { ok: false, reason: '수량이 1 이상의 정수가 아닙니다.' };
    }
    return { ok: true, unit, multiplier: qty };
  }

  if (rate.basis === 'bl') {
    const unit = rate.amounts.bl;
    if (unit == null) {
      return { ok: false, reason: 'B/L 단가가 요율표에 없습니다.' };
    }
    if (input.blCount == null || input.blCount === '') {
      return { ok: false, reason: 'B/L 건수가 없어 계산하지 않습니다.' };
    }
    const count = Number(input.blCount);
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, reason: 'B/L 건수가 1 이상의 정수가 아닙니다.' };
    }
    return { ok: true, unit, multiplier: count };
  }

  return { ok: false, reason: `알 수 없는 계산 단위(${rate.basis})입니다.` };
}

/**
 * 견적을 계산한다.
 * @param {object} input 사람이 확인한 폼 값
 * @param {Array} rates public/data/rates.json
 * @param {Array} sources public/data/sources.json
 */
export function calculate(input, rates, sources = []) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const { blockers, departureDate, origin, destination } = validateInput(input);
  const ctx = { departureDate, origin, destination };

  const lines = [];
  const held = [];

  // 계산 자체를 막는 문제(항구·종류·날짜·범위)가 있으면 모든 줄을 보류한다.
  const hardCodes = new Set([
    'origin-missing', 'origin-unknown', 'destination-missing', 'destination-unknown',
    'container-type-missing', 'container-type-unsupported', 'container-size-missing',
    'hazardous-missing', 'hazardous-unsupported', 'scope-missing', 'scope-unsupported',
    'departure-missing', 'departure-invalid', 'ready-invalid', 'date-order',
    'quantity-negative', 'quantity-fraction', 'quantity-invalid', 'quantity-zero',
  ]);
  const hardBlockers = blockers.filter((b) => hardCodes.has(b.code));

  for (const rate of rates) {
    const source = sourceById.get(rate.sourceId) ?? null;
    const base = {
      id: rate.id,
      label: rate.label,
      currency: rate.currency,
      basis: rate.basis,
      side: rate.side,
      provenance: rate.provenance,
      assumption: rate.assumption || '',
      effectiveFrom: rate.effectiveFrom,
      effectiveTo: rate.effectiveTo,
      sourceId: rate.sourceId,
      sourceTitle: source?.title ?? rate.sourceId,
      sourceUrl: source?.url ?? null,
      sourceChecked: source?.checked ?? null,
    };

    if (hardBlockers.length > 0) {
      held.push({ ...base, reason: hardBlockers.map((b) => b.reason).join(' / ') });
      continue;
    }

    const result = evaluateRate(rate, input, ctx);
    if (!result.ok) {
      held.push({ ...base, reason: result.reason });
      continue;
    }

    lines.push({
      ...base,
      unit: result.unit,
      multiplier: result.multiplier,
      amount: result.unit * result.multiplier,
    });
  }

  // 통화별 소계. 서로 더하지 않는다.
  const subtotalMap = new Map();
  for (const line of lines) {
    const prev = subtotalMap.get(line.currency) ?? { currency: line.currency, amount: 0, partial: false };
    prev.amount += line.amount;
    subtotalMap.set(line.currency, prev);
  }
  // 같은 통화에서 보류된 줄이 있으면 부분 소계로 표시한다.
  for (const item of held) {
    const existing = subtotalMap.get(item.currency);
    if (existing) {
      existing.partial = true;
    } else {
      subtotalMap.set(item.currency, { currency: item.currency, amount: 0, partial: true, empty: true });
    }
  }

  const currencyOrder = ['USD', 'KRW', 'VND'];
  const subtotals = [...subtotalMap.values()].sort(
    (a, b) => currencyOrder.indexOf(a.currency) - currencyOrder.indexOf(b.currency),
  );

  return { lines, held, subtotals, blockers };
}

/** 소계를 통화별 숫자 맵으로 꺼낸다. 테스트에서 쓰기 쉽게. */
export function subtotalMapOf(result) {
  const map = {};
  for (const s of result.subtotals) {
    if (!s.empty) map[s.currency] = s.amount;
  }
  return map;
}
