/**
 * GET /api/transit — ODsay 대중교통 길찾기 + 실시간 도착 오버레이.
 *
 * 요청: ?sx=경도&sy=위도&ex=경도&ey=위도[&walkPace=1]
 * 응답: { itineraries: [...] } — src/js/api/transit.js가 기대하는 정규화 형태
 *
 * 3단계로 합성한다:
 *  1) ODsay: 경로(어디서 승차/환승/하차) — ODSAY_API_KEY
 *  2) 지하철 구간: 서울 열린데이터광장 실시간 도착(역명 기준) — SEOUL_SUBWAY_API_KEY
 *  3) 버스 구간: 서울시 버스운행정보(ws.bus.go.kr) 노선 검색 → 노선별 도착정보 — TAGO_SERVICE_KEY
 *     (data.go.kr 카탈로그명은 "TAGO"가 아니라 "서울특별시_버스도착정보조회 서비스"이지만,
 *      실제 게이트웨이가 국토교통부 TAGO(apis.data.go.kr)가 아닌 서울시 자체 ws.bus.go.kr이라
 *      환경변수명만 유지하고 호출 대상은 서울시 게이트웨이로 맞춘다)
 *
 * 어느 하나라도 없거나 실패하면 그 구간만 "배차간격 기반 예정"으로 폴백한다
 * (ODsay 자체가 없으면 빈 배열을 반환해 프런트엔드가 자체 추정 로직을 쓴다).
 */

import { coord, env, fail, fetchJson, handler, sendJson } from "./_lib/http.js";

const ODSAY_URL = "https://api.odsay.com/v1/api/searchPubTransPathT";
/**
 * ODsay는 "서비스 플랫폼: URI" 방식으로 등록되어 있어 Referer 헤더로 도메인을 확인한다.
 * 서버(Vercel)에서 호출할 때도 이 값을 등록된 URI와 일치시켜야 인증이 통과된다.
 */
const ODSAY_REFERER = env("PUBLIC_APP_ORIGIN") || "https://readytogo-gamma.vercel.app";

const SEOUL_SUBWAY_URL = (key, station) =>
  `http://swopenapi.seoul.go.kr/api/subway/${key}/json/realtimeStationArrival/0/10/${encodeURIComponent(station)}`;

const SEOUL_BUS_BASE = "http://ws.bus.go.kr/api/rest";
const seoulBusRouteSearchUrl = (key, keyword) =>
  `${SEOUL_BUS_BASE}/busRouteInfo/getBusRouteList?serviceKey=${encodeURIComponent(key)}&strSrch=${encodeURIComponent(keyword)}&resultType=json`;
const seoulBusArrivalByRouteUrl = (key, busRouteId) =>
  `${SEOUL_BUS_BASE}/arrive/getArrInfoByRouteAll?serviceKey=${encodeURIComponent(key)}&busRouteId=${busRouteId}&resultType=json`;

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

/**
 * 실시간 도착 문구에서 "몇 정거장 전"을 뽑아낸다.
 * 지하철(arvlMsg2): "[4]번째 전역 (판교)", "전역 도착", "강남 도착" 등
 * 버스(arrmsg1): "3분후[2번째전]", "곧 도착", "운행종료" 등
 * 못 읽어내는 문구(운행종료 등)는 null — 그 경우 시각화는 조용히 생략된다.
 */
function parseStationsAway(msg) {
  if (!msg) return null;
  // "[2]번째 전역", "2번째전" 등 — 숫자와 "번째" 사이에 닫는 대괄호가 낄 수 있다
  const m = String(msg).match(/(\d+)\]?\s*번째\s*전/);
  if (m) return Number(m[1]);
  if (/도착|진입/.test(msg)) return 0;
  return null;
}

const minToSec = (m) => Math.round((Number(m) || 0) * 60);

/**
 * 지도에 그릴 실제 동선. ODsay는 지하철/버스 구간마다 실제 경유 정류장/역 좌표
 * (passStopList)를 주므로 그걸 이어붙이면 직선이 아니라 노선을 따라간다.
 * 도보 구간(환승 이동 등)은 좌표를 안 주니 시작/끝만 이어 직선으로 근사한다.
 */
function buildPath(subPaths, origin, destination) {
  const points = [[origin.lat, origin.lng]];
  subPaths.forEach((s) => {
    const stations = s.passStopList?.stations;
    if (stations?.length) {
      stations.forEach((st) => points.push([Number(st.y), Number(st.x)]));
      return;
    }
    if (Number.isFinite(s.startY) && Number.isFinite(s.startX)) points.push([s.startY, s.startX]);
    if (Number.isFinite(s.endY) && Number.isFinite(s.endX)) points.push([s.endY, s.endX]);
  });
  points.push([destination.lat, destination.lng]);
  return points;
}
/** ODsay는 "수도권 2호선"처럼 접두어를 붙여 주므로 떼고 매칭한다(안 떼면 전부 기본색으로 빠짐) */
const subwayColor = (name = "") =>
  SUBWAY_COLORS.find(([re]) => re.test(name.replace(/^수도권\s*/, "")))?.[1] || "#3D5BAB";

/** ws.bus.go.kr 응답: { msgHeader:{headerCd,headerMsg}, msgBody:{itemList} } — 1건이면 배열이 아닐 수 있다 */
function seoulBusOk(data) {
  return String(data?.msgHeader?.headerCd) === "0";
}
function seoulBusItems(data) {
  const list = data?.msgBody?.itemList;
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}

/**
 * ODsay는 맞춤버스 등에서 "8641(맞춤버스(평일운행))"처럼 번호 뒤에 설명을 덧붙여 준다.
 * 괄호 앞의 순수 번호만 남긴다 — 표시용으로도, 서울 버스 API 노선 검색 키워드로도 이게 맞다.
 */
function cleanBusNo(busNo) {
  return String(busNo || "버스").split("(")[0].trim() || "버스";
}

function lineOf(leg) {
  const lane = leg.lane?.[0] || {};
  if (leg.trafficType === SUBWAY) {
    const name = lane.name || "지하철";
    return { name, color: subwayColor(name) };
  }
  const type = BUS_TYPES[lane.type] || { kind: "버스", color: "#3D5BAB" };
  return { name: `${cleanBusNo(lane.busNo)}번`, color: type.color, kind: type.kind };
}

/** 실시간 정보가 없을 때: 평균 배차간격으로 도착 예정 시각을 만든다(첫 차는 배차간격의 절반 뒤) */
function scheduleArrivals(headwaySec, nowMs, count = 8) {
  const arrivals = [];
  for (let i = 0; i < count; i += 1) {
    const offset = headwaySec / 2 + headwaySec * i;
    arrivals.push({ at: new Date(nowMs + offset * 1000).toISOString(), live: false, crowding: null });
  }
  return arrivals;
}

/* ---------- 지하철: 서울 열린데이터광장 실시간 도착 ---------- */

/** btrainSttus(운행 등급) 또는 문구 어디에든 "급행"/"특급"이 보이면 급행으로 본다 */
function parseExpress(t) {
  return /급행|특급/.test(`${t.btrainSttus || ""} ${t.trainLineNm || ""} ${t.arvlMsg2 || ""}`);
}

/** 서울 열린데이터광장 실시간 도착 API의 lstcarAt("1"=막차) 필드로 막차 여부를 판단한다 */
function parseIsLast(t) {
  return String(t.lstcarAt) === "1";
}

/**
 * 역명으로 실시간 도착 목록을 가져온다. 상행/하행이 뒤섞여 오므로 방향을 확정하지 않고
 * 도착이 빠른 순으로 그대로 보여준다(실제 승강장 전광판과 동일한 방식).
 */
async function fetchSubwayArrivals(stationName) {
  const key = env("SEOUL_SUBWAY_API_KEY");
  if (!key || !stationName) return null;

  try {
    const data = await fetchJson(SEOUL_SUBWAY_URL(key, stationName), { label: "서울 지하철 실시간 도착", timeoutMs: 6000 });
    const list = data?.realtimeArrivalList;
    if (!Array.isArray(list) || !list.length) return null;

    const nowMs = Date.now();
    return list
      .map((t) => ({
        at: new Date(nowMs + (Number(t.barvlDt) || 0) * 1000).toISOString(),
        live: true,
        crowding: null,
        /** 승강장 전광판 문구 그대로 — 방향 확정이 안 되니 사용자가 직접 보고 판단 */
        label: `${t.trainLineNm || ""} · ${t.arvlMsg2 || ""}`.trim(),
        stationsAway: parseStationsAway(t.arvlMsg2),
        // 실시간 응답에서만 실제 급행/일반·막차 여부를 알 수 있다 — 배차간격 추정치는 알 수 없으니 비워둔다
        express: parseExpress(t),
        isLast: parseIsLast(t),
      }))
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .slice(0, 6);
  } catch (err) {
    console.warn("[transit] 서울 지하철 실시간 조회 실패", err.message);
    return null;
  }
}

/* ---------- 버스: 서울시 버스운행정보(ws.bus.go.kr) ---------- */

/** 버스번호로 검색해 정확히 일치하는 노선의 busRouteId를 찾는다 */
async function findSeoulBusRouteId(key, busNo) {
  const data = await fetchJson(seoulBusRouteSearchUrl(key, busNo), { label: "서울 버스 노선 검색", timeoutMs: 6000 });
  if (!seoulBusOk(data)) return null;
  const routes = seoulBusItems(data);
  const exact = routes.find((r) => String(r.busRouteNm) === String(busNo));
  return (exact || routes[0])?.busRouteId ?? null;
}

/**
 * ODsay가 준 버스번호로 노선ID를 찾고, 그 노선의 전체 정류소별 도착정보 중
 * ODsay의 ARS(표지판) 번호와 일치하는 정류소를 골라 실시간 도착을 가져온다.
 */
async function fetchBusArrival({ arsId, busNo }) {
  const key = env("TAGO_SERVICE_KEY");
  if (!key || !busNo) return null;

  try {
    const busRouteId = await findSeoulBusRouteId(key, busNo);
    if (!busRouteId) return null;

    const arrivalRes = await fetchJson(seoulBusArrivalByRouteUrl(key, busRouteId), {
      label: "서울 버스 노선별 도착정보",
      timeoutMs: 6000,
    });
    if (!seoulBusOk(arrivalRes)) return null;

    const stops = seoulBusItems(arrivalRes);
    const match = arsId ? stops.find((s) => String(s.arsId) === String(arsId)) : null;
    const stop = match || stops[0];
    if (!stop) return null;

    // arrmsg1가 "운행종료"/"기점출발대기" 등 비수치 상태를 담을 때는 exps1이 의미 없다
    const secs = Number(stop.exps1 ?? stop.traTime1);
    if (!Number.isFinite(secs) || secs <= 0) return null;

    return {
      at: new Date(Date.now() + secs * 1000).toISOString(),
      live: true,
      crowding: null,
      label: stop.arrmsg1 || null,
      stationsAway: parseStationsAway(stop.arrmsg1),
    };
  } catch (err) {
    console.warn("[transit] 서울 버스 실시간 조회 실패", err.message);
    return null;
  }
}

/* ---------- ODsay 경로 → 앱 itinerary 정규화 ---------- */

/**
 * 동기 변환만 한다 — 실시간 조회는 아직 안 한다. ODsay가 주는 원본 경로 후보가
 * 실제로 화면에 노출되는 것보다 훨씬 많아서(같은 버스 노선이 여러 경로에 중복 등장하는
 * 등), 여기서 바로 실시간까지 물어보면 버려질 항목에도 쓸데없이 호출이 나간다.
 * 실시간은 최종 선택(중복 제거 + 상위 몇 개) 이후 overlayRealtime()에서 붙인다.
 */
/**
 * 승차 구간별 상세 — 환승이 있으면(legs.length > 1) 탑승마다 노선명/승차역/하차역이
 * 다 다른데, 예전엔 legs[0]/legs[last]만 남기고 중간은 "환승 N회"라는 숫자로만
 * 뭉개버렸다. 사용자가 "환승인지 직통인지, 환승이면 어디서 무슨 노선을 타야 하는지"를
 * 알 수 있게 탑승 구간을 하나씩 그대로 배열로 남긴다.
 */
/**
 * 지하철 구간의 경유역 목록 — 실시간 탑승 안내(남은 역 안내)용. passStopList가 이미
 * 역명/좌표를 갖고 있는데 지금까지는 지도 폴리라인 그릴 때 좌표만 뽑고 버렸다.
 */
function stopsOf(leg) {
  const stations = leg.passStopList?.stations;
  if (!stations?.length) return null;
  return stations.map((st) => ({ name: st.stationName, lat: Number(st.y), lng: Number(st.x) }));
}

function buildSegments(subPaths, legs, walkPace) {
  return legs.map((leg, i) => {
    let transferWalkSec = 0;
    if (i > 0) {
      const prevIdx = subPaths.indexOf(legs[i - 1]);
      const curIdx = subPaths.indexOf(leg);
      transferWalkSec = Math.round(
        subPaths
          .slice(prevIdx + 1, curIdx)
          .filter((s) => s.trafficType === 3)
          .reduce((acc, s) => acc + minToSec(s.sectionTime), 0) / walkPace,
      );
    }
    const isSubway = leg.trafficType === SUBWAY;
    return {
      type: isSubway ? "subway" : "bus",
      line: lineOf(leg),
      board: { name: leg.startName, lat: leg.startY, lng: leg.startX },
      alight: { name: leg.endName, lat: leg.endY, lng: leg.endX },
      rideSec: minToSec(leg.sectionTime),
      transferWalkSec,
      // 실시간 탑승 안내는 지하철만 지원한다 — 버스는 정류장 간 시간 편차가 커서
      // "몇 정거장 전" 추정이 부정확하다
      stops: isSubway ? stopsOf(leg) : null,
    };
  });
}

function buildItinerary(path, { nowMs, walkPace, origin, destination }) {
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

  const segments = buildSegments(subPaths, legs, walkPace);
  // 탑승 구간 총합 = 각 구간 승차시간 + (보정된) 환승 도보시간. segments에서 그대로
  // 더해서 만든다 — 따로 계산하면 환승 도보에 walkPace 보정이 빠져 아래 leg 목록
  // 합계(totalSec)와 어긋날 수 있다.
  const rideSec = segments.reduce((acc, s) => acc + s.rideSec + s.transferWalkSec, 0);

  const type = legs[0].trafficType === SUBWAY ? "subway" : "bus";
  const headwaySec = legs[0].intervalTime ? minToSec(legs[0].intervalTime) : DEFAULT_HEADWAY[type];
  const line = lineOf(legs[0]);

  return {
    // 버스는 노선별로 여러 개를 동시에 보여줄 수 있어 타입만으론 id가 겹친다
    id: type === "bus" ? `bus-${line.name}` : type,
    type,
    line,
    board: { name: legs[0].startName, walkSec: boardWalk },
    alight: { name: legs[legs.length - 1].endName, walkSec: alightWalk },
    rideSec,
    transfers: legs.length - 1,
    segments,
    headwaySec,
    arrivals: scheduleArrivals(headwaySec, nowMs),
    path: buildPath(subPaths, origin, destination),
    live: false,
    scheduled: true,
    headwayEstimated: !legs[0].intervalTime,
    source: "odsay_headway",
    totalTimeSec: minToSec(path.info?.totalTime),
    fare: path.info?.payment ?? null,
    stationCount: legs.reduce((acc, l) => acc + (l.stationCount || 0), 0),
    // 실시간 조회에 필요한 최소 정보만 내부용으로 들고 있다가 응답 직전 지운다
    _leg0: { startName: legs[0].startName, startArsID: legs[0].startArsID },
  };
}

/** 최종 선택된 itinerary에만 호출한다 — 실패해도 이미 들어있는 배차 추정치를 그대로 둔다 */
async function overlayRealtime(itinerary) {
  const leg0 = itinerary._leg0;
  if (itinerary.type === "subway") {
    const real = await fetchSubwayArrivals(leg0.startName);
    if (real?.length) {
      itinerary.arrivals = real;
      itinerary.live = true;
      itinerary.scheduled = false;
      itinerary.source = "seoul_subway";
    }
  } else {
    const real = await fetchBusArrival({
      arsId: leg0.startArsID,
      busNo: itinerary.line.name.replace(/번$/, ""), // 정제된 번호로 검색해야 서울 버스 API에서 노선을 찾는다
    });
    if (real) {
      // 노선당 "다음 한 대"만 오므로 그 뒤는 배차간격으로 이어붙인다
      const rest = scheduleArrivals(itinerary.headwaySec, new Date(real.at).getTime(), 5).map((a) => ({
        ...a,
        live: false,
      }));
      itinerary.arrivals = [real, ...rest];
      itinerary.live = true;
      itinerary.scheduled = false;
      itinerary.source = "tago_bus";
    }
  }
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

  const data = await fetchJson(`${ODSAY_URL}?${qs}`, {
    label: "ODsay 대중교통 길찾기",
    timeoutMs: 9000,
    headers: { Referer: ODSAY_REFERER },
  });

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
    .map((p) => buildItinerary(p, { nowMs, walkPace, origin, destination }))
    .filter(Boolean);

  // 지하철은 대표 경로 하나만(보통 ODsay 추천 1개면 충분), 버스는 노선번호별로 각각 남겨서
  // 여러 노선이 가능할 때 사용자가 직접 골라 탈 수 있게 한다. 같은 노선이 중복되면 더 빠른 쪽을 채택.
  const bestSubway = converted
    .filter((it) => it.type === "subway")
    .sort((a, b) => a.totalTimeSec - b.totalTimeSec)[0];

  const busByRoute = new Map();
  converted
    .filter((it) => it.type === "bus")
    .forEach((it) => {
      const prev = busByRoute.get(it.id);
      if (!prev || it.totalTimeSec < prev.totalTimeSec) busByRoute.set(it.id, it);
    });
  const buses = [...busByRoute.values()].sort((a, b) => a.totalTimeSec - b.totalTimeSec).slice(0, 4);

  const itineraries = [bestSubway, ...buses].filter(Boolean);

  // 실시간 조회는 비용이 크다(호출량 한도) — 최종 목록 중 지하철 1개 + 가장 빠른 버스 2개만 붙인다.
  // 나머지 버스 옵션은 배차간격 기반 예정 시각으로 남는다.
  const realtimeTargets = [bestSubway, ...buses.slice(0, 2)].filter(Boolean);
  await Promise.all(realtimeTargets.map((it) => overlayRealtime(it)));
  itineraries.forEach((it) => delete it._leg0);

  sendJson(
    res,
    200,
    {
      itineraries,
      source: "odsay",
      searched: converted.length,
    },
    { cacheSec: 55 }, // 홈 화면 자동 새로고침 주기(60초)에 맞춰 중복 호출을 줄인다
  );
});
