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

/**
 * 배포 전 프록시 주소를 바꿔 테스트할 수 있는 런타임 오버라이드.
 * 콘솔에서 `localStorage.setItem("rtg:proxyBase", "https://xxx.vercel.app/api")` 후 새로고침.
 */
const proxyOverride = (() => {
  try {
    return localStorage.getItem("rtg:proxyBase") || "";
  } catch {
    return "";
  }
})();

export const config = {
  /**
   * 서버 프록시 base URL — 비어 있으면 목 모드.
   * GitHub Pages에서도 동작해야 하므로 상대경로가 아닌 절대 URL을 쓴다.
   * 키가 없는 엔드포인트는 501을 반환하고, 각 어댑터가 목 데이터로 폴백한다.
   */
  proxyBase: proxyOverride || "https://readytogo-gamma.vercel.app/api",

  /** NAVER Maps JS SDK client id. 있으면 실지도, 없으면 내장 Flat 2D 지도 사용 */
  naverMapClientId: "hyn5shzf4e",

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

/**
 * 501(키 미설정 · 미지원)로 응답한 엔드포인트 목록.
 * 키가 없는 API를 매번 호출하면 왕복 지연만 늘어나므로 세션 동안 건너뛴다.
 */
const unavailable = new Set();

const proxyUrl = (endpoint, params) => {
  const url = new URL(config.proxyBase.replace(/\/$/, "") + endpoint, location.href);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  return url;
};

/** 프록시 GET 헬퍼 — 실패 시 호출부가 목으로 폴백할 수 있도록 throw */
export async function proxyGet(endpoint, params, { signal } = {}) {
  if (unavailable.has(endpoint)) throw new Error(`${endpoint} 미설정 (건너뜀)`);

  const res = await fetch(proxyUrl(endpoint, params), { signal, headers: { Accept: "application/json" } });
  if (res.status === 501) {
    unavailable.add(endpoint);
    throw new Error(`${endpoint} 501 — 서버에 API 키가 설정되지 않았습니다`);
  }
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  return res.json();
}

/**
 * 프록시의 키 설정 상태 조회 (/api/health).
 * 설정 화면에서 어떤 API가 실데이터로 동작 중인지 보여주는 데 쓴다.
 */
let statusPromise = null;

export function getProxyStatus({ refresh = false } = {}) {
  if (!config.proxyBase) return Promise.resolve(null);
  if (refresh) {
    statusPromise = null;
    unavailable.clear();
  }
  if (!statusPromise) {
    statusPromise = fetch(proxyUrl("/health", {}), { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return statusPromise;
}
