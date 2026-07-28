/**
 * GET /api/health — 키 설정 상태 점검.
 *
 *   /api/health          → 어떤 환경변수가 채워져 있는지만 확인 (키 값은 노출하지 않음)
 *   /api/health?probe=1  → 실제 샘플 요청을 보내 각 API가 정말 동작하는지 확인
 *
 * 키를 하나씩 넣어가며 진행할 때 이 엔드포인트로 단계별 검증을 한다.
 */

import { env, handler, sendJson } from "./_lib/http.js";

/** 서울시청 → 강남역 (프로브용 고정 좌표) */
const SAMPLE = {
  directions: "start=126.9780,37.5665&goal=127.0276,37.4979&option=trafast",
  weather: "lat=37.5665&lng=126.9780",
  places: "query=강남역",
  transit: "sx=126.9780&sy=37.5665&ex=127.0276&ey=37.4979",
};

async function probe(base, path, query) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/${path}?${query}`, { signal: AbortSignal.timeout(12000) });
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      source: body?.source ?? null,
      message: res.ok ? null : body?.message || body?.error || "unknown",
      detail: res.ok ? null : body?.detail ?? null,
    };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, message: err.message };
  }
}

export default handler(async (req, res) => {
  const configured = {
    naver: Boolean(env("NAVER_CLIENT_ID", "NAVER_MAPS_CLIENT_ID") && env("NAVER_CLIENT_SECRET", "NAVER_MAPS_CLIENT_SECRET")),
    kma: Boolean(env("KMA_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY")),
    naverSearch: Boolean(env("NAVER_SEARCH_CLIENT_ID") && env("NAVER_SEARCH_CLIENT_SECRET")),
    odsay: Boolean(env("ODSAY_API_KEY")),
  };

  const status = {
    ok: true,
    time: new Date().toISOString(),
    region: process.env.VERCEL_REGION || null,
    /** 설정 화면이 그대로 읽어 쓰는 서비스별 상태 */
    services: {
      weather: {
        label: "날씨",
        origin: "기상청 단기예보",
        ready: configured.kma,
        keys: ["KMA_SERVICE_KEY"],
      },
      directions: {
        label: "자차 경로",
        origin: "NAVER Directions 5",
        ready: configured.naver,
        keys: ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"],
      },
      places: {
        label: "장소 검색",
        origin: configured.naverSearch ? "NAVER 지역검색 + Geocoding" : "NAVER Geocoding",
        ready: configured.naver,
        optional: !configured.naverSearch,
        keys: ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET"],
      },
      transit: {
        label: "대중교통",
        origin: configured.odsay ? "ODsay 길찾기 (도착시각은 배차 기준)" : "앱 내 추정",
        ready: configured.odsay,
        keys: ["ODSAY_API_KEY"],
      },
    },
    allowedOrigins: process.env.ALLOWED_ORIGINS || "*",
  };

  if (!req.query.probe) {
    sendJson(res, 200, status);
    return;
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const base = `${proto}://${req.headers.host}`;

  const [directions, weather, places, transit] = await Promise.all([
    probe(base, "directions", SAMPLE.directions),
    probe(base, "weather", SAMPLE.weather),
    probe(base, "places", SAMPLE.places),
    probe(base, "transit", SAMPLE.transit),
  ]);

  sendJson(res, 200, { ...status, probe: { directions, weather, places, transit } });
});
