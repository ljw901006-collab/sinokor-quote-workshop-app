// Gemini 호출과 오류 분류를 한곳에 모은다.
// 키는 인자로만 받고, 저장하거나 반환하거나 로그에 남기지 않는다.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/** 오류 메시지 원문에 키가 들어 있으면 가린다. */
export function maskKey(text, apiKey) {
  if (typeof text !== 'string') return '';
  let out = text;
  if (apiKey && apiKey.length >= 8) {
    out = out.split(apiKey).join('[가려짐]');
  }
  // 흔한 키 모양도 함께 가린다.
  out = out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[가려짐]');
  out = out.replace(/AQ\.[0-9A-Za-z_-]{20,}/g, '[가려짐]');
  return out;
}

/**
 * HTTP 상태와 응답 본문으로 한국어 원인·다음 행동을 만든다.
 * @returns {{ code: string, reason: string, next: string }}
 */
export function classifyError(status, body, apiKey) {
  const raw = maskKey(typeof body === 'string' ? body : JSON.stringify(body ?? ''), apiKey);
  const isKeyInvalid = status === 400 && /API_KEY_INVALID|API key not valid/i.test(raw);

  if (status === 0) {
    return {
      code: 'network',
      reason: 'Gemini 서버에 연결하지 못했습니다.',
      next: '인터넷 연결을 확인한 뒤 다시 눌러 주세요.',
    };
  }
  if (status === 408) {
    return {
      code: 'timeout',
      reason: '응답이 제한 시간 안에 오지 않았습니다.',
      next: '잠시 뒤 다시 눌러 주세요. 계속되면 더 가벼운 모델로 바꿔 보세요.',
    };
  }
  if (isKeyInvalid || status === 401) {
    return {
      code: 'invalid-key',
      reason: '키가 올바르지 않습니다. (Gemini가 400 API_KEY_INVALID로 답했습니다)',
      next: 'AI Studio에서 키를 다시 확인해 넣어 주세요.',
    };
  }
  if (status === 403) {
    return {
      code: 'forbidden',
      reason: '이 키로는 이 요청이 허용되지 않습니다.',
      next: 'AI Studio에서 키의 사용 제한과 프로젝트 설정을 확인해 주세요.',
    };
  }
  if (status === 404) {
    return {
      code: 'not-found',
      reason: '요청한 모델을 찾지 못했습니다.',
      next: '모델 이름을 확인해 주세요. 서버 환경변수 GEMINI_MODEL로 바꿀 수 있습니다.',
    };
  }
  if (status === 429) {
    return {
      code: 'rate-limit',
      reason: '너무 많이 불렀거나 사용 한도를 넘었습니다.',
      next: '잠시 뒤 다시 눌러 주세요.',
    };
  }
  if (status === 503) {
    return {
      code: 'overloaded',
      reason: '모델이 붐빕니다.',
      next: '잠시 뒤 다시 누르고, 계속되면 더 가벼운 모델로 바꿔 보세요.',
    };
  }
  if (status === 400) {
    return {
      code: 'bad-request',
      reason: '요청 형식이 올바르지 않습니다.',
      next: '입력을 확인한 뒤 다시 시도해 주세요.',
    };
  }
  return {
    code: `http-${status}`,
    reason: `Gemini가 ${status} 상태로 답했습니다.`,
    next: '잠시 뒤 다시 시도해 주세요.',
  };
}

/**
 * Gemini generateContent 호출.
 * @param {object} options
 * @param {string} options.apiKey  호출에만 쓰고 저장하지 않는다
 * @param {string} options.model
 * @param {string} options.prompt
 * @param {number} options.timeoutMs
 * @param {object} [options.generationConfig]
 * @returns {Promise<{ok: true, text: string} | {ok: false, status: number, error: object}>}
 */
export async function generate({ apiKey, model, prompt, timeoutMs = 20000, generationConfig }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  let bodyText = '';
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 키를 URL이 아니라 헤더로 보낸다 — 주소창·로그에 남지 않게.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(generationConfig ? { generationConfig } : {}),
      }),
      signal: controller.signal,
    });
    bodyText = await res.text();
  } catch (err) {
    clearTimeout(timer);
    const status = err?.name === 'AbortError' ? 408 : 0;
    return { ok: false, status, error: classifyError(status, '', apiKey) };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, status: res.status, error: classifyError(res.status, bodyText, apiKey) };
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      status: res.status,
      error: { code: 'parse', reason: '응답을 읽지 못했습니다.', next: '다시 시도해 주세요.' },
    };
  }

  const text = parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { ok: true, text };
}
