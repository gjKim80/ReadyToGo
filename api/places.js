/**
 * GET /api/places — 장소 검색 / 역지오코딩 프록시.
 *
 * 요청:
 *   ?query=강남역&lat=&lng=      → 장소 검색
 *   ?mode=reverse&lat=&lng=      → 좌표 → 주소
 *
 * 응답: { items: [{ id, name, address, lat, lng, icon, category, distance }] }
 *       (reverse는 { name, address, icon })
 *
 * 필요한 환경변수:
 *   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET          — NCP Geocoding(주소 검색·좌표 변환)
 *   NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET
 *     — NAVER Developers 지역 검색(상호명 검색). 없으면 주소 검색만 동작한다.
 */

import { coord, env, fail, fetchJson, handler, sendJson } from "./_lib/http.js";

const NCP_HOSTS = ["https://maps.apigw.ntruss.com", "https://naveropenapi.apigw.ntruss.com"];

/** 카테고리 문자열 → 이모지 (목 데이터와 눈높이를 맞추기 위한 최소 매핑) */
const ICONS = [
  [/지하철|전철/, "🚇"],
  [/기차|철도/, "🚉"],
  [/버스|터미널/, "🚌"],
  [/공항/, "✈️"],
  [/병원|의원|약국/, "🏥"],
  [/학교|대학/, "🎓"],
  [/공원|산/, "🌳"],
  [/카페|커피/, "☕"],
  [/음식|식당|한식|중식|일식/, "🍽️"],
  [/백화점|마트|쇼핑|몰/, "🏬"],
  [/은행/, "🏦"],
  [/숙박|호텔/, "🏨"],
  [/관광|문화|박물관|미술관/, "🏛️"],
];

const iconFor = (category = "") => ICONS.find(([re]) => re.test(category))?.[1] || "📍";

const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, "");

/** 한국 영역 안의 좌표인지 — mapx/mapy 좌표계 판별에 사용 */
const inKorea = (lat, lng) => lat > 32 && lat < 39.6 && lng > 123 && lng < 133;

const haversine = (a, b) => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/** NCP Maps REST 호출 — 신규/기존 호스트를 순서대로 시도 */
async function ncpGet(path, params, { id, secret, label }) {
  const qs = new URLSearchParams(params).toString();
  let lastError;
  for (const host of NCP_HOSTS) {
    try {
      return await fetchJson(`${host}${path}?${qs}`, {
        headers: { "x-ncp-apigw-api-key-id": id, "x-ncp-apigw-api-key": secret },
        label,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** NCP Geocoding: 주소/키워드 → 좌표 */
async function geocode(query, creds) {
  const data = await ncpGet("/map-geocode/v2/geocode", { query }, { ...creds, label: "NAVER Geocoding" });
  return (data.addresses || []).map((a) => ({
    name: a.roadAddress || a.jibunAddress,
    address: a.roadAddress || a.jibunAddress,
    lat: Number(a.y),
    lng: Number(a.x),
    category: "주소",
    icon: "📍",
  }));
}

/** NAVER Developers 지역 검색: 상호명 → POI */
async function localSearch(query) {
  const id = env("NAVER_SEARCH_CLIENT_ID");
  const secret = env("NAVER_SEARCH_CLIENT_SECRET");
  if (!id || !secret) return null;

  const qs = new URLSearchParams({ query, display: "10", sort: "random" }).toString();
  const data = await fetchJson(`https://openapi.naver.com/v1/search/local.json?${qs}`, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    label: "NAVER 지역검색",
  });

  return (data.items || []).map((it) => {
    // mapx/mapy는 WGS84를 10^7배한 정수로 내려온다. 값이 한국 범위를 벗어나면
    // 좌표계가 다른 응답이므로 좌표를 버리고 주소 지오코딩으로 보완한다.
    const lng = Number(it.mapx) / 1e7;
    const lat = Number(it.mapy) / 1e7;
    const valid = Number.isFinite(lat) && Number.isFinite(lng) && inKorea(lat, lng);
    const category = stripTags(it.category);
    return {
      name: stripTags(it.title),
      address: it.roadAddress || it.address || "",
      lat: valid ? lat : null,
      lng: valid ? lng : null,
      category,
      icon: iconFor(category),
    };
  });
}

export default handler(async (req, res) => {
  const id = env("NAVER_CLIENT_ID", "NAVER_MAPS_CLIENT_ID");
  const secret = env("NAVER_CLIENT_SECRET", "NAVER_MAPS_CLIENT_SECRET");
  if (!id || !secret) {
    fail(res, 501, "not_configured", "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다");
    return;
  }
  const creds = { id, secret };

  /* ── 역지오코딩 ── */
  if (req.query.mode === "reverse") {
    const at = coord(req.query, "lat", "lng");
    if (!at) {
      fail(res, 400, "bad_request", "lat / lng 좌표가 필요합니다");
      return;
    }

    const data = await ncpGet(
      "/map-reversegeocode/v2/gc",
      {
        coords: `${at.lng},${at.lat}`,
        output: "json",
        orders: "roadaddr,addr",
      },
      { ...creds, label: "NAVER Reverse Geocoding" },
    );

    const results = data.results || [];
    const result = results.find((r) => r.name === "roadaddr") || results[0];
    if (!result) {
      fail(res, 404, "not_found", "주소를 찾을 수 없습니다");
      return;
    }

    const region = result.region || {};
    const areas = [region.area1, region.area2, region.area3, region.area4].map((a) => a?.name).filter(Boolean);
    const land = result.land || {};
    const roadName = [land.name, land.number1, land.number2 ? `-${land.number2}` : ""].filter(Boolean).join(" ").trim();

    sendJson(
      res,
      200,
      {
        name: roadName || `${areas[areas.length - 1] || "선택 위치"} 인근`,
        address: [...areas, roadName].filter(Boolean).join(" "),
        icon: "📍",
      },
      { cacheSec: 3600 },
    );
    return;
  }

  /* ── 장소 검색 ── */
  const query = String(req.query.query || "").trim();
  if (!query) {
    sendJson(res, 200, { items: [] });
    return;
  }
  const near = coord(req.query, "lat", "lng");

  const [localResult, geoResult] = await Promise.allSettled([localSearch(query), geocode(query, creds)]);

  const poi = localResult.status === "fulfilled" ? localResult.value || [] : [];
  const addresses = geoResult.status === "fulfilled" ? geoResult.value : [];
  if (localResult.status === "rejected" && geoResult.status === "rejected") throw geoResult.reason;

  // 지역검색 결과 중 좌표가 없는 항목은 주소를 지오코딩해 좌표를 채운다(최대 5건).
  const needsCoord = poi.filter((p) => p.lat === null && p.address).slice(0, 5);
  await Promise.all(
    needsCoord.map(async (p) => {
      try {
        const [hit] = await geocode(p.address, creds);
        if (hit) {
          p.lat = hit.lat;
          p.lng = hit.lng;
        }
      } catch {
        /* 좌표를 못 채우면 아래에서 제외된다 */
      }
    }),
  );

  const seen = new Set();
  const items = [...poi, ...addresses]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .filter((p) => {
      const key = `${p.name}|${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      ...p,
      id: `naver-${p.lat.toFixed(6)},${p.lng.toFixed(6)}`,
      distance: near ? haversine(near, p) : null,
    }))
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    .slice(0, 12);

  sendJson(res, 200, { items, source: "naver" }, { cacheSec: 600 });
});
