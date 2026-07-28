/**
 * GET /api/directions — NAVER Directions 5 (자차 경로) 프록시.
 *
 * 요청: ?start=lng,lat&goal=lng,lat&option=trafast
 * 응답: src/js/api/directions.js가 기대하는 정규화 형태
 *   { source, mode, distance, durationSec, freeFlowSec, trafficFactor,
 *     trafficLevel, tollFare, fuelPrice, summary, path: [[lat,lng], ...] }
 *
 * 필요한 환경변수:
 *   NAVER_CLIENT_ID     (Maps 애플리케이션의 Client ID / API Key ID)
 *   NAVER_CLIENT_SECRET (Client Secret / API Key)
 */

import { UpstreamError, env, fail, fetchJson, handler, sendJson } from "./_lib/http.js";

/**
 * NAVER Cloud Platform은 2025년 Maps 개편으로 REST 호스트가 이원화되어 있다.
 * 신규 키는 maps.apigw, 기존 키는 naveropenapi.apigw를 쓴다.
 * 어느 세대의 키인지 사용자가 알기 어려우므로 순서대로 시도한다.
 */
const HOSTS = [
  "https://maps.apigw.ntruss.com",
  "https://naveropenapi.apigw.ntruss.com",
];

const PATH = "/map-direction/v1/driving";

/** section.congestion: 1 원활 · 2 서행 · 3 지체 · 4 정체 */
const CONGESTION_FACTOR = { 1: 1.0, 2: 1.25, 3: 1.5, 4: 1.8 };

const COORD_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

function trafficLevel(factor) {
  if (factor >= 1.5) return "jam";
  if (factor >= 1.2) return "slow";
  return "smooth";
}

/**
 * 구간별 정체 등급을 거리 가중 평균해 "평소 대비 지연 계수"를 추정한다.
 * Directions 5는 자유흐름 소요시간을 주지 않으므로, 이 계수로 freeFlowSec를 역산한다.
 */
function estimateTrafficFactor(sections, totalDistance) {
  const usable = (sections || []).filter((s) => CONGESTION_FACTOR[s.congestion] && s.distance > 0);
  if (!usable.length) return 1.15;

  const covered = usable.reduce((acc, s) => acc + s.distance, 0);
  const weighted = usable.reduce((acc, s) => acc + CONGESTION_FACTOR[s.congestion] * s.distance, 0);

  // 정체 정보가 없는 구간은 원활(1.0)로 간주해 희석한다.
  const rest = Math.max(0, (totalDistance || covered) - covered);
  return (weighted + rest) / (covered + rest);
}

/** 가장 긴 구간 이름 최대 3개를 경로 순서대로 요약 */
function summarize(sections) {
  const named = (sections || []).filter((s) => s.name);
  if (!named.length) return "자차 경로";

  const seen = new Set();
  const unique = named.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  return [...unique]
    .sort((a, b) => (b.distance || 0) - (a.distance || 0))
    .slice(0, 3)
    .sort((a, b) => (a.pointIndex || 0) - (b.pointIndex || 0))
    .map((s) => s.name)
    .join(" → ");
}

async function callNaver(params, headers) {
  let lastError;
  for (const host of HOSTS) {
    try {
      return await fetchJson(`${host}${PATH}?${params}`, { headers, label: "NAVER Directions" });
    } catch (err) {
      lastError = err;
      // 인증/경로 문제일 때만 다른 호스트를 시도한다.
      const retriable = err instanceof UpstreamError && /HTTP (401|403|404)|JSON이 아닙니다/.test(err.message);
      if (!retriable) throw err;
    }
  }
  throw lastError;
}

export default handler(async (req, res) => {
  const clientId = env("NAVER_CLIENT_ID", "NAVER_MAPS_CLIENT_ID");
  const clientSecret = env("NAVER_CLIENT_SECRET", "NAVER_MAPS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    fail(res, 501, "not_configured", "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다");
    return;
  }

  const { start, goal, option = "trafast", cartype, fueltype } = req.query;

  // NAVER Directions 5는 자차 전용이다. 도보 경로는 프런트엔드가 자체 추정한다.
  if (option === "walking") {
    fail(res, 501, "unsupported_mode", "NAVER Directions 5는 도보 경로를 제공하지 않습니다");
    return;
  }
  if (!COORD_RE.test(String(start || "")) || !COORD_RE.test(String(goal || ""))) {
    fail(res, 400, "bad_request", "start / goal은 'lng,lat' 형식이어야 합니다");
    return;
  }

  const allowedOptions = ["trafast", "tracomfort", "traoptimal", "traavoidtoll", "traavoidcaronly"];
  const routeOption = allowedOptions.includes(option) ? option : "trafast";

  const params = new URLSearchParams({ start, goal, option: routeOption, lang: "ko" });
  if (cartype) params.set("cartype", String(cartype));
  if (fueltype) params.set("fueltype", String(fueltype));

  const data = await callNaver(params.toString(), {
    "x-ncp-apigw-api-key-id": clientId,
    "x-ncp-apigw-api-key": clientSecret,
  });

  if (data.code !== 0) {
    // code 1: 출발/도착이 너무 가까움, code 2: 좌표 오류 등
    fail(res, 422, "no_route", data.message || "경로를 찾을 수 없습니다", { code: data.code });
    return;
  }

  const route = data.route?.[routeOption]?.[0];
  if (!route) {
    fail(res, 422, "no_route", "경로 결과가 비어 있습니다");
    return;
  }

  const summary = route.summary || {};
  const distance = Math.round(summary.distance || 0);
  const durationSec = Math.round((summary.duration || 0) / 1000);
  const factor = estimateTrafficFactor(route.section, distance);

  sendJson(
    res,
    200,
    {
      source: "naver",
      mode: "driving",
      distance,
      durationSec,
      freeFlowSec: Math.max(1, Math.round(durationSec / factor)),
      trafficFactor: Number(factor.toFixed(2)),
      trafficLevel: trafficLevel(factor),
      tollFare: Math.round(summary.tollFare || 0),
      fuelPrice: Math.round(summary.fuelPrice || 0),
      summary: summarize(route.section),
      // NAVER는 [lng,lat] 순서, 프런트엔드는 [lat,lng] 순서를 쓴다.
      path: (route.path || []).map(([lng, lat]) => [lat, lng]),
      taxiFare: Math.round(summary.taxiFare || 0),
    },
    { cacheSec: 60 },
  );
});
