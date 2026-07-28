/**
 * 서버리스 함수 공용 유틸 — CORS, JSON 응답, 외부 API 호출.
 *
 * 프런트엔드는 GitHub Pages(다른 오리진)에서 서비스될 수 있으므로 CORS가 필요하다.
 * ALLOWED_ORIGINS 환경변수(쉼표 구분)를 지정하면 해당 오리진만 허용하고,
 * 비어 있으면 모든 오리진을 허용한다(키는 서버에만 있으므로 노출 위험은 없지만,
 * 호출 쿼터를 지키려면 배포 후 실제 도메인으로 좁히는 것을 권장).
 */

export function applyCors(req, res) {
  const allowList = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  if (!allowList.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowList.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  // 오리진별로 응답 헤더가 달라지므로 CDN 캐시가 섞이지 않도록 표시
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept,Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function sendJson(res, status, body, { cacheSec = 0 } = {}) {
  if (cacheSec > 0) {
    res.setHeader("Cache-Control", `public, s-maxage=${cacheSec}, stale-while-revalidate=${cacheSec * 2}`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).send(JSON.stringify(body));
}

/** 프런트엔드가 목 데이터로 폴백할 수 있도록 에러도 JSON + 비200으로 반환 */
export function fail(res, status, code, message, detail) {
  sendJson(res, status, { error: code, message, ...(detail ? { detail } : {}) });
}

export class UpstreamError extends Error {
  constructor(message, { status = 502, detail } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 외부 API 호출 후 JSON 파싱.
 * 공공데이터포털은 키 오류 시 JSON을 요청해도 XML/HTML을 반환하므로,
 * 파싱 실패 시 원문 앞부분을 detail로 실어 원인을 알 수 있게 한다.
 */
export async function fetchJson(url, { headers = {}, timeoutMs = 8000, label = "upstream" } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new UpstreamError(`${label} 호출 실패: ${err.message}`, { status: 504 });
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 아래에서 처리 */
  }

  if (!res.ok) {
    throw new UpstreamError(`${label} 오류 (HTTP ${res.status})`, {
      status: res.status === 401 || res.status === 403 ? 502 : 502,
      detail: json ?? text.slice(0, 400),
    });
  }
  if (json === null) {
    throw new UpstreamError(`${label} 응답이 JSON이 아닙니다`, { status: 502, detail: text.slice(0, 400) });
  }
  return json;
}

/** GET 전용 핸들러 래퍼 — CORS / preflight / 메서드 검사 / 에러 변환 */
export function handler(fn) {
  return async (req, res) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "GET") {
      fail(res, 405, "method_not_allowed", "GET만 지원합니다");
      return;
    }
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof UpstreamError) {
        fail(res, err.status, "upstream_error", err.message, err.detail);
        return;
      }
      console.error("[api] 처리 중 오류", err);
      fail(res, 500, "internal_error", err?.message || "알 수 없는 오류");
    }
  };
}

/** 필수 좌표 파라미터 파싱 */
export function coord(query, latKey, lngKey) {
  const lat = Number(query[latKey]);
  const lng = Number(query[lngKey]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** 환경변수 조회 — 없으면 501로 응답할 수 있도록 null 반환 */
export function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/**
 * 필수 환경변수 중 비어 있는 것만 골라 501로 응답한다.
 * 키를 하나씩 넣어가는 중에 "무엇이 남았는지"가 바로 보이게 하는 것이 목적이다.
 * @param {Record<string, string|null>} required 이름 → env() 결과
 * @returns {boolean} 응답을 보냈으면 true
 */
export function requireEnv(res, required) {
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (!missing.length) return false;

  fail(res, 501, "not_configured", `${missing.join(", ")} 환경변수가 없습니다`, { missing });
  return true;
}
