/**
 * GET /api/transit — ODsay 대중교통 길찾기 프록시.
 *
 * 요청: ?sx=경도&sy=위도&ex=경도&ey=위도[&walkPace=1]
 * 응답: { itineraries: [...] } — src/js/api/transit.js가 기대하는 정규화 형태
 *
 * 필요한 환경변수: ODSAY_API_KEY
 *   없으면 빈 배열을 200으로 반환하고 프런트엔드가 자체 추정 로직을 쓴다.
 *
 * ⚠️ ODsay는 "경로"만 제공하고 실시간 도착시각은 제공하지 않는다.
 *    따라서 도착 목록은 평균 배차간격(intervalTime)으로 만든 예정 시각이며,
 *    모두 live=false로 표시해 UI가 실시간이라고 오인하지 않게 한다.
 */

import { coord, env, fail, fetchJson, handler, sendJson } from "./_lib/http.js";

const ODSAY_URL = "https://api.odsay.com/v1/api/searchPubTransPathT";

/** trafficType: 1 지하철 · 2 버스 · 3 도보 */
const SUBWAY = 1;
const BUS = 2;

/** 노선명으로 색을 고른다 — ODsay의 subwayCode 체계보다 이름 매칭이 안전하다 */
const SUBWAY_COLORS = [
  [/^수도권 1호선|^1호선/, "#0052A4"],
  [/^2호선/, "#00A84D"],
  [/^3호선/, "#EF7C1C"],
  [/^4호선/, "#00A5DE"],
  [/^5호선/, "#996CAC"],
  [/^6호선/, "#CD7C2F"],
  [/^7호선/, "#747F00"],
  [/^8호선/, "#E6186C"],
  [/^9호선/, "#BDB092"],
  [/신분당/, "#D31145"],
  [/수인분당|분당/, "#F5A200"],
  [/경의중앙/, "#77C4A3"],
  [/공항철도/, "#0090D2"],
  [/경춘/, "#0C8E72"],
  [/경강/, "#003DA5"],
  [/서해/, "#8FC31F"],
  [/김포/, "#A17800"],
  [/우이신설/, "#B0CE18"],
  [/신림/, "#6789CA"],
  [/에버라인|용인/, "#509F22"],
  [/의정부/, "#FDA600"],
  [/인천 ?1/, "#7CA8D5"],
  [/인천 ?2/, "#ED8B00"],
  [/GTX/, "#9A6292"],
];

/** ODsay 버스 type 코드 → 색/구분명 */
const BUS_TYPES = {
  1: { kind: "일반", color: "#5BB025" },
  2: { kind: "좌석", color: "#3D5BAB" },
  3: { kind: "마을", color: "#5BB025" },
  4: { kind: "직행좌석", color: "#E8462E" },
  5: { kind: "공항", color: "#00A2D1" },
  6: { kind: "간선급행", color: "#E8462E" },
  10: { kind: "외곽", color: "#5BB025" },
  11: { kind: "간선", color: "#3D5BAB" },
  12: { kind: "지선", color: "#5BB025" },
  13: { kind: "순환", color: "#F99D1C" },
  14: { kind: "광역", color: "#E8462E" },
  15: { kind: "급행", color: "#E8462E" },
  16: { kind: "관광", color: "#3D5BAB" },
  20: { kind: "농어촌", color: "#5BB025" },
  21: { kind: "경기간선", color: "#3D5BAB" },
  22: { kind: "경기지선", color: "#5BB025" },
  23: { kind: "경기광역급행", color: "#E8462E" },
  26: { kind: "경기순환", color: "#F99D1C" },
};

/** intervalTime이 비어 있을 때 쓰는 기본 배차간격(초) */
const DEFAULT_HEADWAY = { subway: 300, bus: 600 };

const minToSec = (m) => Math.round((Number(m) || 0) * 60);

const subwayColor = (name = "") => SUBWAY_COLORS.find(([re]) => re.test(name))?.[1] || "#3D5BAB";

function lineOf(leg) {
  const lane = leg.lane?.[0] || {};
  if (leg.trafficType === SUBWAY) {
    const name = lane.name || "지하철";
    return { name, color: subwayColor(name) };
  }
  const type = BUS_TYPES[lane.type] || { kind: "버스", color: "#3D5BAB" };
  return { name: `${lane.busNo || "버스"}번`, color: type.color, kind: type.kind };
}

/**
 * 실시간 정보가 없으므로 평균 배차간격으로 도착 예정 시각을 만든다.
 * 첫 차는 "배차간격의 절반 뒤"로 두는 게 기댓값 기준으로 가장 타당하다.
 */
function scheduleArrivals(headwaySec, nowMs, count = 8) {
  const arrivals = [];
  for (let i = 0; i < count; i += 1) {
    const offset = headwaySec / 2 + headwaySec * i;
    arrivals.push({
      at: new Date(nowMs + offset * 1000).toISOString(),
      live: false,
      crowding: null,
    });
  }
  return arrivals;
}

/** ODsay path 하나 → 앱의 itinerary 형태 */
function toItinerary(path, { nowMs, walkPace }) {
  const subPaths = path.subPath || [];
  const legs = subPaths.filter((s) => s.trafficType === SUBWAY || s.trafficType === BUS);
  if (!legs.length) return null;

  const firstIdx = subPaths.indexOf(legs[0]);
  const lastIdx = subPaths.indexOf(legs[legs.length - 1]);

  // 승차 전 / 하차 후 도보. ODsay 도보시간은 표준 보행속도 기준이라 개인 배율로 보정한다.
  const walkOf = (list) =>
    Math.round(list.filter((s) => s.trafficType === 3).reduce((acc, s) => acc + minToSec(s.sectionTime), 0) / walkPace);
  const boardWalk = walkOf(subPaths.slice(0, firstIdx));
  const alightWalk = walkOf(subPaths.slice(lastIdx + 1));

  // 탑승 구간 = 첫 승차부터 마지막 하차까지 (중간 환승 도보·대기 포함)
  const rideSec = subPaths.slice(firstIdx, lastIdx + 1).reduce((acc, s) => acc + minToSec(s.sectionTime), 0);

  const type = legs[0].trafficType === SUBWAY ? "subway" : "bus";
  const headwaySec = legs[0].intervalTime
    ? minToSec(legs[0].intervalTime)
    : DEFAULT_HEADWAY[type];

  return {
    id: type,
    type,
    line: lineOf(legs[0]),
    board: { name: legs[0].startName, walkSec: boardWalk },
    alight: { name: legs[legs.length - 1].endName, walkSec: alightWalk },
    rideSec,
    transfers: legs.length - 1,
    headwaySec,
    /** 도착 시각은 실시간이 아니라 배차간격 기반 예정값이다 */
    arrivals: scheduleArrivals(headwaySec, nowMs),
    scheduled: true,
    headwayEstimated: !legs[0].intervalTime,
    source: "odsay",
    totalTimeSec: minToSec(path.info?.totalTime),
    fare: path.info?.payment ?? null,
    stationCount: legs.reduce((acc, l) => acc + (l.stationCount || 0), 0),
  };
}

export default handler(async (req, res) => {
  const apiKey = env("ODSAY_API_KEY");
  if (!apiKey) {
    // 키가 없어도 200 — 프런트엔드가 조용히 자체 추정으로 폴백한다
    sendJson(res, 200, {
      itineraries: [],
      source: "not_configured",
      reason: "ODSAY_API_KEY가 없어 앱 내 추정 로직을 사용합니다.",
    });
    return;
  }

  const origin = coord(req.query, "sy", "sx");
  const destination = coord(req.query, "ey", "ex");
  if (!origin || !destination) {
    fail(res, 400, "bad_request", "sx / sy / ex / ey 좌표가 필요합니다");
    return;
  }
  const walkPace = Math.min(2, Math.max(0.5, Number(req.query.walkPace) || 1));

  const qs = new URLSearchParams({
    apiKey,
    SX: String(origin.lng),
    SY: String(origin.lat),
    EX: String(destination.lng),
    EY: String(destination.lat),
    OPT: "0", // 0: 추천 경로순
    SearchType: "0", // 0: 도시 내
    output: "json",
    lang: "0",
  });

  const data = await fetchJson(`${ODSAY_URL}?${qs}`, { label: "ODsay 대중교통 길찾기", timeoutMs: 9000 });

  // ODsay는 오류도 HTTP 200으로 주고 error 객체를 실어 보낸다
  if (data.error) {
    const { code, message } = data.error;
    // 3: 출발/도착이 너무 가까움 등 "경로 없음"은 정상 폴백 대상
    if (String(code) === "3" || String(code) === "4") {
      sendJson(res, 200, { itineraries: [], source: "no_route", reason: message });
      return;
    }
    fail(res, 502, "odsay_error", message || "ODsay 오류", { code });
    return;
  }

  const nowMs = Date.now();
  const converted = (data.result?.path || [])
    .map((p) => toItinerary(p, { nowMs, walkPace }))
    .filter(Boolean);

  // 앱은 지하철/버스 후보를 각각 하나씩 보여준다(plan id 중복 방지). 소요시간이 짧은 쪽을 채택.
  const best = new Map();
  converted.forEach((it) => {
    const prev = best.get(it.type);
    if (!prev || it.totalTimeSec < prev.totalTimeSec) best.set(it.type, it);
  });

  sendJson(
    res,
    200,
    {
      itineraries: [...best.values()],
      source: "odsay",
      searched: converted.length,
    },
    { cacheSec: 120 },
  );
});
