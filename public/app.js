// 문의 원문을 보여주고, 사람이 확인한 입력으로 견적을 계산해 표시한다.
// 원문에 없는 값을 자동으로 채우지 않는다. 금액 판정은 calc.js(코드)가 한다.

import { calculate } from './calc.js';

const FIELD_IDS = [
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

const state = {
  inquiries: [],
  rates: [],
  sources: [],
  lastResult: null,
};

const $ = (id) => document.getElementById(id);

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}를 읽지 못했습니다 (${res.status})`);
  return res.json();
}

/** 통화별 표기. 소수점 없이, 자릿수 구분 쉼표만 쓴다. */
function formatAmount(value, currency) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value) + ' ' + currency;
}

function formatPeriod(from, to) {
  return `${from} ~ ${to ?? '종료일 없음'}`;
}

function basisLabel(basis) {
  return basis === 'container' ? '컨테이너당' : basis === 'bl' ? 'B/L당' : basis;
}

// ── 화면 그리기 ─────────────────────────────

function renderInquiryOptions() {
  const select = $('inquiry-select');
  select.innerHTML = '';
  for (const item of state.inquiries) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    select.append(option);
  }
}

function showInquiry(id) {
  const found = state.inquiries.find((item) => item.id === id);
  $('inquiry-text').textContent = found ? found.text : '';
}

function renderCostRows(lines) {
  const tbody = $('cost-rows');
  tbody.innerHTML = '';
  $('cost-empty').hidden = lines.length > 0;

  // 좁은 화면에서 표를 카드로 쌓을 때 각 칸 앞에 붙일 이름
  const COLUMN_LABELS = ['항목', '출처', '적용기간', '단위', '단가', '수량', '금액'];
  const labelled = (cell, index) => {
    cell.dataset.label = COLUMN_LABELS[index];
    return cell;
  };

  for (const line of lines) {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = line.label;
    tr.append(labelled(name, 0));

    const source = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge badge-${line.provenance}`;
    badge.textContent = line.provenance === 'public' ? '공개' : '추정';
    source.append(badge, ' ');
    if (line.sourceUrl) {
      const link = document.createElement('a');
      link.href = line.sourceUrl;
      link.textContent = line.sourceTitle;
      link.target = '_blank';
      link.rel = 'noreferrer';
      source.append(link);
    } else {
      source.append(document.createTextNode(line.sourceTitle));
    }
    if (line.sourceChecked) {
      const checked = document.createElement('span');
      checked.className = 'source-checked';
      checked.textContent = ` (확인 ${line.sourceChecked})`;
      source.append(checked);
    }
    if (line.provenance === 'estimate' && line.assumption) {
      const note = document.createElement('span');
      note.className = 'assumption';
      note.textContent = line.assumption;
      source.append(note);
    }
    tr.append(labelled(source, 1));

    const period = document.createElement('td');
    period.textContent = formatPeriod(line.effectiveFrom, line.effectiveTo);
    tr.append(labelled(period, 2));

    const unitCell = document.createElement('td');
    unitCell.textContent = basisLabel(line.basis);
    tr.append(labelled(unitCell, 3));

    const price = document.createElement('td');
    price.className = 'num';
    price.textContent = formatAmount(line.unit, line.currency);
    tr.append(labelled(price, 4));

    const qty = document.createElement('td');
    qty.className = 'num';
    qty.textContent = `× ${line.multiplier}`;
    tr.append(labelled(qty, 5));

    const amount = document.createElement('td');
    amount.className = 'num amount';
    amount.textContent = formatAmount(line.amount, line.currency);
    tr.append(labelled(amount, 6));

    tbody.append(tr);
  }
}

function renderSubtotals(subtotals) {
  const list = $('subtotals');
  list.innerHTML = '';

  if (subtotals.length === 0) {
    const li = document.createElement('li');
    li.className = 'subtotal-empty';
    li.textContent = '계산된 소계가 없습니다.';
    list.append(li);
    return;
  }

  for (const s of subtotals) {
    const li = document.createElement('li');
    li.className = 'subtotal';

    const label = document.createElement('span');
    label.className = 'subtotal-currency';
    label.textContent = s.currency;
    li.append(label);

    const value = document.createElement('span');
    value.className = 'subtotal-amount';
    value.textContent = s.empty ? '계산 없음' : formatAmount(s.amount, s.currency);
    li.append(value);

    if (s.partial) {
      const tag = document.createElement('span');
      tag.className = 'badge badge-partial';
      tag.textContent = s.empty ? '전부 보류' : '부분 소계';
      li.append(tag);
    }

    list.append(li);
  }
}

function renderHeld(held) {
  const list = $('held-list');
  list.innerHTML = '';
  $('held-empty').hidden = held.length > 0;

  for (const item of held) {
    const li = document.createElement('li');
    li.className = 'held-item';

    const head = document.createElement('div');
    head.className = 'held-head';
    const name = document.createElement('strong');
    name.textContent = item.label;
    const cur = document.createElement('span');
    cur.className = 'badge badge-hold';
    cur.textContent = `${item.currency} · ${basisLabel(item.basis)}`;
    head.append(name, cur);
    li.append(head);

    const reason = document.createElement('div');
    reason.className = 'held-reason';
    reason.textContent = item.reason;
    li.append(reason);

    list.append(li);
  }
}

// ── 입력 읽기 ───────────────────────────────

/** 폼의 현재 값을 읽는다. 빈 칸은 null로 둔다 — 0이나 1로 채우지 않는다. */
function readForm() {
  const values = {};
  for (const id of FIELD_IDS) {
    const el = $(id);
    const raw = el.value.trim();
    if (raw === '') {
      values[id] = null;
      continue;
    }
    values[id] = el.type === 'number' ? Number(raw) : raw;
  }
  return values;
}

function clearForm() {
  for (const id of FIELD_IDS) {
    $(id).value = '';
  }
  recalculate();
}

function recalculate() {
  const input = readForm();
  const result = calculate(input, state.rates, state.sources);
  state.lastResult = result;
  renderCostRows(result.lines);
  renderSubtotals(result.subtotals);
  renderHeld(result.held);
  return result;
}

// ── 시작 ────────────────────────────────────

function init() {
  $('inquiry-select').addEventListener('change', (event) => {
    showInquiry(event.target.value);
  });

  $('reset-form').addEventListener('click', clearForm);

  for (const id of FIELD_IDS) {
    $(id).addEventListener('input', recalculate);
    $(id).addEventListener('change', recalculate);
  }

  Promise.all([
    loadJson('data/inquiries.json'),
    loadJson('data/rates.json'),
    loadJson('data/sources.json'),
  ])
    .then(([inquiries, rates, sources]) => {
      state.inquiries = inquiries;
      state.rates = rates;
      state.sources = sources;
      renderInquiryOptions();
      showInquiry(inquiries[0]?.id);
      recalculate();
    })
    .catch((err) => {
      $('inquiry-text').textContent = `데이터를 불러오지 못했습니다: ${err.message}`;
    });
}

// ── 비트8-2 · 서버 키로 동작하는 AI ──────────
// 키는 서버 환경변수에만 있다. 이 화면은 키를 다루지 않는다.
// 금액은 서버가 원본 요율로 다시 계산한다. AI는 문장만 돕는다.

// 원문·입력이 바뀐 뒤 도착한 이전 응답은 적용하지 않는다.
let requestSeq = 0;

function bumpSeq() {
  requestSeq += 1;
  return requestSeq;
}

function setStatus(id, message, kind) {
  const el = $(id);
  el.textContent = message;
  el.className = "ai-status" + (kind ? " is-" + kind : "");
}

function describeError(payload) {
  return payload.next ? payload.reason + " " + payload.next : payload.reason;
}

async function postAi(body) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 문의 분석 — 원문에서 필드를 뽑아 폼에 채운다. 근거 없는 값은 비운 채로 둔다. */
async function extractInquiry() {
  const btn = $("extract-btn");
  const inquiryText = $("inquiry-text").textContent;
  const mySeq = bumpSeq();

  btn.disabled = true;
  setStatus("extract-status", "문의를 읽는 중입니다…", "busy");

  try {
    const payload = await postAi({ action: "extract", inquiryText });

    // 그 사이 사람이 문의를 바꿨으면 늦게 온 응답을 버린다.
    if (mySeq !== requestSeq) return;

    if (!payload.ok) {
      setStatus("extract-status", describeError(payload), "error");
      return;
    }

    // 뽑힌 값만 채운다. null은 빈 칸으로 둔다 — 지어내지 않는다.
    for (const id of FIELD_IDS) {
      const value = payload.fields?.[id];
      $(id).value = value === null || value === undefined ? "" : String(value);
    }
    recalculate();

    setStatus(
      "extract-status",
      payload.note || "분석이 끝났습니다. 값을 확인하고 필요하면 고쳐 주세요.",
      payload.dropped?.length ? "warn" : "ok",
    );
  } catch (err) {
    if (mySeq !== requestSeq) return;
    setStatus("extract-status", "서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.", "error");
  } finally {
    btn.disabled = false;
  }
}

/** 회신 초안 — 사람이 확인한 입력을 서버에 보내고, 서버가 재계산한 금액으로 문장을 받는다. */
async function makeDraft() {
  const btn = $("draft-btn");
  const input = readForm();
  const mySeq = bumpSeq();

  btn.disabled = true;
  setStatus("draft-status", "회신 초안을 만드는 중입니다…", "busy");

  try {
    const payload = await postAi({ action: "draft", input });

    if (mySeq !== requestSeq) return;

    if (!payload.ok) {
      setStatus("draft-status", describeError(payload), "error");
      return;
    }

    $("draft-text").value = payload.draft;
    $("draft-text").hidden = false;
    setStatus("draft-status", "초안이 나왔습니다. 보내기 전에 읽고 고쳐 주세요.", "ok");
  } catch (err) {
    if (mySeq !== requestSeq) return;
    setStatus("draft-status", "서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인해 주세요.", "error");
  } finally {
    btn.disabled = false;
  }
}

$("extract-btn").addEventListener("click", extractInquiry);
$("draft-btn").addEventListener("click", makeDraft);

// 사람이 문의를 바꾸거나 입력을 고치면 진행 중인 AI 응답을 무효로 만든다.
$("inquiry-select").addEventListener("change", () => {
  bumpSeq();
  $("draft-text").hidden = true;
  setStatus("extract-status", "");
  setStatus("draft-status", "");
});
for (const id of FIELD_IDS) {
  $(id).addEventListener("input", bumpSeq);
}

// 검사 도구가 폼을 읽고 결과를 확인할 수 있게 열어 둔다.
window.quoteApp = { readForm, clearForm, recalculate, FIELD_IDS, state };

document.addEventListener('DOMContentLoaded', init);
