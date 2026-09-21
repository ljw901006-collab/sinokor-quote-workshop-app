// 비트8-2 · 서버가 키를 맡는다.
//
// - 서버 환경변수 GEMINI_API_KEY / GEMINI_MODEL만 읽는다.
// - 클라이언트가 보낸 키는 무시한다. 개인 키 경로는 없다.
// - AI는 문의를 읽고(extract) 문장을 돕는다(draft).
// - 금액·보류 판정은 코드(calc.js)가 한다. AI가 낸 숫자를 금액으로 쓰지 않는다.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate, maskKey, DEFAULT_MODEL } from './_gemini.js';
import { calculate, parseDate } from '../public/calc.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const EXTRACT_FIELDS = [
  'requester',
  'origin',
  'destination',
  'containerType',
  'containerSize',
  'quantity',
  'weightPerContainer',
  'blCount',
  'commodity',
  'readyDate',
  'departureDate',
  'hazardous',
  'serviceScope',
];

function noKeyResponse(res) {
  return res.status(200).json({
    ok: false,
    code: 'no-server-key',
    reason: '서버에 Gemini 키가 없습니다.',
    next: '.env.example을 .env로 복사하고 GEMINI_API_KEY에 키를 넣은 뒤, 서버를 다시 켜 주세요.',
  });
}

const EXTRACT_PROMPT = (text) => `너는 물류 회사의 견적 담당자를 돕는 도구다.
아래 "문의 원문"을 읽고 항목을 뽑아 JSON으로만 답한다.

규칙:
- 원문에 근거가 없는 값은 반드시 null로 둔다. 절대 추측하거나 기본값(1, 0 등)으로 채우지 않는다.
- 수량(quantity)은 원문에 "N대"처럼 세는 표현이 있을 때만 적는다. 없으면 반드시 null.
- B/L 건수(blCount)도 원문에 "N건"이 있을 때만 적는다. 없으면 null.
- 날짜는 YYYY-MM-DD 형식으로 바꾼다. 원문에 없으면 null.
- containerType은 GP, HC, RF 중 하나 또는 null.
- containerSize는 "20" 또는 "40" 또는 null.
- hazardous는 "no"(비위험물), "yes"(위험물), null 중 하나.
- serviceScope는 "CY-CY", "CY-DOOR", "DOOR-CY", "DOOR-DOOR", null 중 하나.
- 항구는 UN/LOCODE 코드로 바꾼다. 부산항=KRPUS, 하이퐁항=VNHPH. 확실하지 않으면 null.

응답 형식(이 구조 그대로, 다른 텍스트 없이):
{
  "fields": {
    "requester": null, "origin": null, "destination": null,
    "containerType": null, "containerSize": null, "quantity": null,
    "weightPerContainer": null, "blCount": null, "commodity": null,
    "readyDate": null, "departureDate": null, "hazardous": null, "serviceScope": null
  }
}

문의 원문:
"""
${text}
"""`;

const ENUMS = {
  containerType: ['GP', 'HC', 'RF'],
  containerSize: ['20', '40'],
  hazardous: ['no', 'yes'],
  serviceScope: ['CY-CY', 'CY-DOOR', 'DOOR-CY', 'DOOR-DOOR'],
  origin: ['KRPUS', 'VNHPH'],
  destination: ['KRPUS', 'VNHPH'],
};

/** "8,000kg" 같은 문자열도 숫자로 바꾼다. 숫자가 없으면 null. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^0-9.]/g, '');
  if (digits === '') return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 원문에서 "N대" · "N건" 같은 세는 표현을 모두 찾는다. */
export function countsIn(text, unit) {
  const found = new Set();
  const pattern = new RegExp('(\\d+)\\s*' + unit, 'g');
  let match;
  while ((match = pattern.exec(text)) !== null) found.add(Number(match[1]));
  return found;
}

/**
 * AI가 뽑은 값을 코드가 검증한다.
 *
 * - 수량과 B/L 건수는 **원문에 세는 표현이 실제로 있어야만** 받는다.
 *   원문에 "N대"가 없으면 수량은 null이다. AI가 무엇을 말하든 서버에서 비운다.
 * - 열거형·날짜는 형식이 맞아야 받는다.
 * - 나머지 문자열은 사람이 화면에서 확인하므로 그대로 넘긴다.
 */
export function sanitize(fields, text) {
  const out = {};
  const dropped = [];
  const drop = (key) => {
    out[key] = null;
    dropped.push(key);
  };

  const containerCounts = countsIn(text, '대');
  const blCounts = countsIn(text, '건');

  for (const key of EXTRACT_FIELDS) {
    const raw = fields?.[key] ?? null;

    if (raw === null || raw === '') {
      out[key] = null;
      continue;
    }

    // 수량 — 원문에 "N대"가 없으면 지어낸 값이다
    if (key === 'quantity') {
      const n = toNumber(raw);
      if (n === null || !containerCounts.has(n)) drop(key);
      else out[key] = n;
      continue;
    }

    // B/L 건수 — 원문에 "N건"이 없으면 비운다
    if (key === 'blCount') {
      const n = toNumber(raw);
      if (n === null || !blCounts.has(n)) drop(key);
      else out[key] = n;
      continue;
    }

    if (key === 'weightPerContainer') {
      const n = toNumber(raw);
      if (n === null) drop(key);
      else out[key] = n;
      continue;
    }

    // 열거형 — 정해진 값만 받는다
    if (key in ENUMS) {
      const value = String(raw).toUpperCase();
      const allowed = ENUMS[key].map((v) => v.toUpperCase());
      const index = allowed.indexOf(value);
      if (index === -1) drop(key);
      else out[key] = ENUMS[key][index];
      continue;
    }

    // 날짜 — 달력에 있는 YYYY-MM-DD 만 받는다
    if (key === 'readyDate' || key === 'departureDate') {
      const value = String(raw).trim();
      if (parseDate(value) === null) drop(key);
      else out[key] = value;
      continue;
    }

    out[key] = String(raw).trim();
  }

  return { fields: out, dropped };
}

async function handleExtract(req, res, { apiKey, model }) {
  const text = typeof req.body?.inquiryText === 'string' ? req.body.inquiryText : '';
  if (text.trim() === '') {
    return res.status(400).json({
      ok: false,
      code: 'empty-input',
      reason: '문의 원문이 비어 있습니다.',
      next: '문의를 고른 뒤 다시 눌러 주세요.',
    });
  }

  const result = await generate({
    apiKey,
    model,
    prompt: EXTRACT_PROMPT(text),
    timeoutMs: 55000,
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });

  if (!result.ok) {
    return res.status(200).json({ ok: false, ...result.error });
  }

  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return res.status(200).json({
      ok: false,
      code: 'parse',
      reason: 'AI 응답을 JSON으로 읽지 못했습니다.',
      next: '다시 눌러 주세요. 입력은 그대로 남아 있습니다.',
    });
  }

  const { fields, dropped } = sanitize(parsed.fields, text);

  return res.status(200).json({
    ok: true,
    fields,
    dropped,
    note: dropped.length > 0
      ? `원문에서 근거를 확인하지 못해 비워 둔 항목: ${dropped.join(', ')}. 사람이 확인해 넣어 주세요.`
      : '',
  });
}

const DRAFT_PROMPT = (input, result) => {
  const lines = result.lines
    .map((l) => `- ${l.label}: ${l.unit} ${l.currency} × ${l.multiplier} = ${l.amount} ${l.currency} (${l.provenance === 'public' ? '공개 확인값' : '교육용 추정값'})`)
    .join('\n');
  const subtotals = result.subtotals
    .map((s) => `- ${s.currency}: ${s.empty ? '계산 없음' : s.amount}${s.partial ? ' (일부 항목 보류된 부분 소계)' : ''}`)
    .join('\n');
  const held = result.held.length
    ? result.held.map((h) => `- ${h.label}: ${h.reason}`).join('\n')
    : '- 없음';

  return `너는 알파카 물류 고객지원 담당자가 고객에게 보낼 회신 초안을 쓰는 도구다.

아주 중요한 규칙:
- 아래 "계산 결과"의 숫자를 그대로 쓴다. 네가 더하거나 빼거나 새 숫자를 만들지 않는다.
- 통화를 서로 더하지 않는다. 환산하지 않는다.
- 보류된 항목은 금액 없이, 왜 보류인지와 무엇을 확인해야 하는지 적는다.
- 교육용 추정값이 섞여 있으면 확정 금액이 아니라고 밝힌다.
- 예약·발송을 확정하는 문장을 쓰지 않는다. 담당자 검토 후 발송된다는 전제로 쓴다.
- 한국어 존댓말 이메일 본문만 쓴다. 제목·머리말·마크다운 표는 쓰지 않는다.

문의 조건:
- 문의자: ${input.requester ?? '미확인'}
- 구간: ${input.origin ?? '미확인'} → ${input.destination ?? '미확인'}
- 컨테이너: ${input.containerSize ?? '?'}${input.containerType ?? '?'} ${input.quantity ?? '미확인'}대
- B/L: ${input.blCount ?? '미확인'}건
- 품명: ${input.commodity ?? '미확인'}
- 준비일: ${input.readyDate ?? '미확인'} / 희망 출항일: ${input.departureDate ?? '미확인'}

계산 결과 (코드가 계산한 값. 그대로 인용할 것):
${lines || '- 계산된 항목 없음'}

통화별 소계:
${subtotals || '- 없음'}

보류 항목:
${held}

위 내용으로 회신 초안을 써라.`;
};

async function handleDraft(req, res, { apiKey, model }) {
  const input = req.body?.input;
  if (!input || typeof input !== 'object') {
    return res.status(400).json({
      ok: false,
      code: 'empty-input',
      reason: '입력값이 없습니다.',
      next: '폼을 채운 뒤 다시 눌러 주세요.',
    });
  }

  // 금액은 서버가 원본 요율로 다시 계산한다. 클라이언트가 보낸 금액을 믿지 않는다.
  const rates = readJson('public/data/rates.json');
  const sources = readJson('public/data/sources.json');
  const result = calculate(input, rates, sources);

  const ai = await generate({
    apiKey,
    model,
    prompt: DRAFT_PROMPT(input, result),
    timeoutMs: 55000,
    generationConfig: { temperature: 0.3 },
  });

  if (!ai.ok) {
    // AI가 실패해도 코드가 계산한 결과는 돌려준다.
    return res.status(200).json({ ok: false, ...ai.error, calculation: result });
  }

  return res.status(200).json({ ok: true, draft: ai.text.trim(), calculation: result });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'POST로 보내 주세요.', next: '' });
  }

  // 클라이언트가 키를 보내도 쓰지 않는다. 서버 환경변수만 읽는다.
  if (req.body && typeof req.body === 'object' && 'apiKey' in req.body) {
    return res.status(400).json({
      ok: false,
      code: 'client-key-rejected',
      reason: '클라이언트가 보낸 키는 받지 않습니다.',
      next: '서버 환경변수 GEMINI_API_KEY를 사용합니다.',
    });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? '';
  if (apiKey === '') return noKeyResponse(res);

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const action = req.body?.action;

  try {
    if (action === 'extract') return await handleExtract(req, res, { apiKey, model });
    if (action === 'draft') return await handleDraft(req, res, { apiKey, model });
    return res.status(400).json({
      ok: false,
      code: 'unknown-action',
      reason: `알 수 없는 action입니다: ${action}`,
      next: 'extract 또는 draft를 보내 주세요.',
    });
  } catch (err) {
    // 오류 메시지에 키가 섞여 있을 수 있으니 가린다.
    return res.status(500).json({
      ok: false,
      code: 'server-error',
      reason: '서버에서 오류가 발생했습니다.',
      next: maskKey(String(err?.message ?? ''), apiKey) || '다시 시도해 주세요.',
    });
  }
}
