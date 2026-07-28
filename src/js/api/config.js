/**
 * 외부 API 설정.
 *
 * 현재 저장소에는 발급된 키가 없으므로 기본값은 목(mock) 어댑터다.
 * 실제 연동 시 아래 값만 채우면 각 어댑터가 자동으로 실 API 경로를 탄다.
 *
 * ⚠️ 브라우저에서 공공데이터포털/기상청/NAVER Directions를 직접 호출하면
 *    (1) CORS 차단, (2) 서비스 키 노출 문제가 발생한다.
 *    따라서 실 연동은 반드시 `proxyBase`(자체 서버/서버리스 함수)를 경유해야 한다.
 *    NAVER Maps JS SDK(지도 렌더링)만 브라우저에서 직접 로드 가능하다.
 */

export const config = {
  /** 서버 프록시 base URL 예: "https://api.example.com/rtg" — 비어 있으면 목 모드 */
  proxyBase: "",

  /** NAVER Maps JS SDK client id. 있으면 실지도, 없으면 내장 Flat 2D 지도 사용 */
  naverMapClientId: "",

  endpoints: {
    weather: "/weather", // 기상청 단기예보(초단기실황+단기예보) 프록시
    transit: "/transit", // 공공데이터포털 버스/지하철 실시간 도착 프록시
    directions: "/directions", // NAVER Directions 5 프록시
    places: "/places", // 장소 검색(로컬/지오코딩) 프록시
  },

  /** 목 모드에서 네트워크 지연을 흉내 내는 시간(ms) */
  mockLatencyMs: 180,
};

export const isMock = () => !config.proxyBase;

/** 프록시 GET 헬퍼 — 실패 시 호출부가 목으로 폴백할 수 있도록 throw */
export async function proxyGet(endpoint, params, { signal } = {}) {
  const url = new URL(config.proxyBase.replace(/\/$/, "") + endpoint, location.href);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  return res.json();
}
