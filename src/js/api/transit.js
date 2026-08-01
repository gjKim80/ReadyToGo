/**
 * 대중교통 어댑터 — 공공데이터포털(버스/지하철 실시간 도착) 대응.
 *
 * 반환 형태(정규화):
 *  {
 *    id, type: 'subway'|'bus',
 *    line: { name, color },
 *    board:  { name, walkSec },   // 출발지 → 승차 정류장/역
 *    alight: { name, walkSec },   // 하차 → 목적지
 *    rideSec, transfers, headwaySec,
 *    arrivals: [{ at: ISO, live: boolean, crowding: 'low'|'mid'|'high', label }]
 *  }
 */

import { config, isMock, proxyGet } from "./config.js";
import { haversine, seededInt, seededRandom, pick, sleep } from "../util.js";

const SUBWAY_LINES = [
  { name: "2호선", color: "#00A84D" },
  { name: "3호선", color: "#EF7C1C" },
  { name: "5호선", color: "#996CAC" },
  { name: "7호선", color: "#747F00" },
  { name: "9호선", color: "#BDB092" },
  { name: "신분당선", color: "#D31145" },
  { name: "수인분당선", color: "#F5A200" },
];

const BUS_KINDS = [
  { prefix: "간선", color: "#3D5BAB" },
  { prefix: "지선", color: "#5BB025" },
  { prefix: "광역", color: "#E8462E" },
];

const CROWDING = ["low", "mid", "high"];
export const CROWDING_LABEL = { low: "여유", mid: "보통", high: "혼잡" };

/** 실시간 도착 목록 생성: 앞 2대는 실시간, 이후는 배차간격 기반 예정
 * @param {boolean} withExpress 지하철처럼 급행/일반 구분이 있는 노선이면 각 열차에 express 플래그를 단다 */
function buildArrivals(seed, headwaySec, now, count = 8, withExpress = false) {
  const first = Math.round(seededRandom(`${seed}:first`) * headwaySec);
  const arrivals = [];
  let t = first;
  for (let i = 0; i < count; i += 1) {
    // 실시간 구간은 배차가 ±25% 흔들리도록
    const jitter = i < 2 ? (seededRandom(`${seed}:j${i}`) - 0.5) * headwaySec * 0.5 : 0;
    arrivals.push({
      at: new Date(now.getTime() + Math.max(0, t + jitter) * 1000).toISOString(),
      live: i < 2,
      crowding: pick(`${seed}:c${i}`, CROWDING),
      // 실제로도 급행은 일반보다 드물게 다닌다 — 대략 3대 중 1대 꼴로 섞는다
      ...(withExpress ? { express: seededRandom(`${seed}:e${i}`) < 0.3 } : {}),
    });
    t += headwaySec;
  }
  return arrivals;
}

function stopNameFor(seed, kind) {
  const areas = ["중앙", "시청", "역전", "우체국", "사거리", "초등학교", "공원", "아파트", "도서관", "시장"];
  const area = pick(seed, areas);
  return kind === "subway" ? `${area}역` : `${area} 정류장`;
}

function mockItineraries(origin, destination, now, walkPace = 1) {
  const distance = haversine(origin, destination);
  const seed = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}>${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`;
  const walkSpeed = 1.25 * walkPace; // m/s

  const options = [];

  // ── 지하철: 2km 이상일 때 유효
  if (distance >= 2000) {
    const line = SUBWAY_LINES[seededInt(`${seed}:line`, 0, SUBWAY_LINES.length - 1)];
    const boardWalk = Math.round(seededInt(`${seed}:sbw`, 300, 900) / walkSpeed);
    const alightWalk = Math.round(seededInt(`${seed}:saw`, 200, 800) / walkSpeed);
    const transfers = distance > 12000 ? seededInt(`${seed}:tr`, 0, 2) : seededInt(`${seed}:tr`, 0, 1);
    // 표정속도 약 32km/h + 환승 1회당 4분
    const rideSec = Math.round((distance * 1.25) / (32000 / 3600)) + transfers * 240;
    const headway = seededInt(`${seed}:sh`, 180, 420);

    options.push({
      id: "subway",
      type: "subway",
      line,
      board: { name: stopNameFor(`${seed}:sb`, "subway"), walkSec: boardWalk },
      alight: { name: stopNameFor(`${seed}:sa`, "subway"), walkSec: alightWalk },
      rideSec,
      transfers,
      headwaySec: headway,
      arrivals: buildArrivals(`${seed}:sub`, headway, now, 8, true),
    });
  }

  // ── 버스: 항상 후보로 제공 (600m 미만 초근거리는 제외)
  if (distance >= 600) {
    const kind = BUS_KINDS[distance > 15000 ? 2 : seededInt(`${seed}:bk`, 0, 1)];
    const number =
      kind.prefix === "광역"
        ? `${seededInt(`${seed}:bn`, 1000, 9999)}`
        : `${seededInt(`${seed}:bn`, 100, 799)}`;
    const boardWalk = Math.round(seededInt(`${seed}:bbw`, 120, 550) / walkSpeed);
    const alightWalk = Math.round(seededInt(`${seed}:baw`, 100, 500) / walkSpeed);
    // 시내버스 표정속도 약 18km/h (혼잡시간대 보정은 planner에서 처리)
    const rideSec = Math.round((distance * 1.35) / (18000 / 3600));
    const headway = seededInt(`${seed}:bh`, 300, 840);

    options.push({
      id: "bus",
      type: "bus",
      line: { name: `${number}번`, color: kind.color, kind: kind.prefix },
      board: { name: stopNameFor(`${seed}:bb`, "bus"), walkSec: boardWalk },
      alight: { name: stopNameFor(`${seed}:ba`, "bus"), walkSec: alightWalk },
      rideSec,
      transfers: 0,
      headwaySec: headway,
      arrivals: buildArrivals(`${seed}:bus`, headway, now),
    });
  }

  return options;
}

/**
 * 출발지→목적지 대중교통 후보 경로 조회.
 * @returns {Promise<Array>} 정규화된 itinerary 목록
 */
export async function getTransitItineraries(origin, destination, { now = new Date(), walkPace = 1, signal } = {}) {
  if (!isMock()) {
    try {
      const data = await proxyGet(
        config.endpoints.transit,
        {
          sx: origin.lng, sy: origin.lat,
          ex: destination.lng, ey: destination.lat,
          walkPace,
        },
        { signal },
      );
      if (Array.isArray(data.itineraries) && data.itineraries.length) return data.itineraries;
    } catch (err) {
      console.warn("[transit] 프록시 실패 — 목 데이터로 폴백", err);
    }
  }

  await sleep(config.mockLatencyMs);
  return mockItineraries(origin, destination, now, walkPace);
}
