/**
 * 스마트 출발 시각 계산기 (역산 엔진) — 앱의 핵심 로직.
 *
 * "도착 희망 시각"에서 거꾸로 계산해 **문 앞을 나서야 하는 시각**을 구한다.
 *  · 대중교통: 도보 + 실시간 대기 + 탑승 + 하차 도보
 *  · 자차:     출발 준비 + 실시간 정체 반영 주행 + 주차 후 도보
 *
 * 반환 plan 형태:
 *  {
 *    id, kind, label, icon, color, live,
 *    legs: [{ kind, title, sub, sec }],
 *    totalSec, leaveAt, arriveAt, slackSec, late, notes[], meta
 *  }
 */

import { getTransitItineraries, CROWDING_LABEL } from "../api/transit.js";
import { getDirections, TRAFFIC_LABEL } from "../api/directions.js";
import { fmtDistance, fmtDur, haversine } from "../util.js";

/** 자차: 차량까지 이동 / 주차 후 목적지까지 도보 (초) */
const TO_CAR_SEC = 120;
const PARK_WALK_SEC = 180;
/** 도보 단독 이동을 후보로 제시할 최대 직선거리 */
const WALKABLE_M = 2500;

const sum = (legs) => legs.reduce((acc, leg) => acc + leg.sec, 0);

/** arriveBy 이후까지 도착 목록이 닿도록 배차간격으로 연장 */
function extendArrivals(arrivals, headwaySec, until) {
  const list = arrivals.map((a) => ({ ...a, at: new Date(a.at) }));
  if (!until || !headwaySec) return list;

  let last = list[list.length - 1];
  let guard = 0;
  while (last && last.at.getTime() < until.getTime() && guard < 200) {
    last = { at: new Date(last.at.getTime() + headwaySec * 1000), live: false, crowding: last.crowding };
    list.push(last);
    guard += 1;
  }
  return list;
}

function planTransit(itinerary, { now, arriveBy, bufferSec }) {
  const walkTo = itinerary.board.walkSec;
  const walkFrom = itinerary.alight.walkSec;
  const ride = itinerary.rideSec;
  const tail = (ride + walkFrom) * 1000;

  const arrivals = extendArrivals(itinerary.arrivals, itinerary.headwaySec, arriveBy);
  const earliestBoard = now.getTime() + (walkTo + bufferSec) * 1000;
  const catchable = arrivals.filter((a) => a.at.getTime() >= earliestBoard);

  let chosen;
  let late = false;

  if (!catchable.length) {
    // 남은 차편이 없다 — 마지막 차편 기준으로 안내하되 지각으로 표시
    chosen = arrivals[arrivals.length - 1];
    late = true;
  } else if (!arriveBy) {
    chosen = catchable[0];
  } else {
    const onTime = catchable.filter((a) => a.at.getTime() + tail <= arriveBy.getTime());
    if (onTime.length) {
      chosen = onTime[onTime.length - 1]; // 늦지 않는 선에서 가장 늦게 출발
    } else {
      chosen = catchable[0]; // 어떤 차를 타도 늦음 → 가장 빠른 차
      late = true;
    }
  }

  const boardAt = chosen.at;
  const leaveAt = new Date(boardAt.getTime() - (walkTo + bufferSec) * 1000);
  const arriveAt = new Date(boardAt.getTime() + tail);

  const isSubway = itinerary.type === "subway";
  const transferNote = itinerary.transfers ? ` · 환승 ${itinerary.transfers}회` : " · 직통";

  const legs = [
    {
      kind: "walk",
      title: `${itinerary.board.name}까지 도보`,
      sub: "출발지에서 승차 지점까지",
      sec: walkTo,
    },
    {
      kind: "wait",
      title: "승차 대기 여유",
      sub: `${itinerary.line.name} ${boardAt.getHours()}시 ${String(boardAt.getMinutes()).padStart(2, "0")}분 도착 예정`,
      sec: bufferSec,
    },
    {
      kind: itinerary.type,
      title: `${itinerary.line.name} 탑승`,
      sub: `${itinerary.board.name} → ${itinerary.alight.name}${transferNote}`,
      sec: ride,
    },
    {
      kind: "walk",
      title: "하차 후 목적지까지 도보",
      sub: `${itinerary.alight.name}에서 출발`,
      sec: walkFrom,
    },
  ];

  const nextArrivals = arrivals
    .filter((a) => a.at.getTime() >= now.getTime())
    .slice(0, 3)
    .map((a) => ({
      at: a.at,
      live: a.live,
      inSec: Math.round((a.at.getTime() - now.getTime()) / 1000),
      crowding: a.crowding,
      crowdingLabel: CROWDING_LABEL[a.crowding],
      stationsAway: a.stationsAway ?? null,
    }));

  return {
    id: itinerary.id,
    kind: isSubway ? "subway" : "bus",
    // 지하철도 노선명을 그대로 쓴다 — 배지에 번호/색을 표시하려면 어차피 필요하고,
    // 버스는 노선이 여러 개 나올 수 있어 "버스"만으로는 서로 구별이 안 된다.
    label: itinerary.line.name,
    icon: isSubway ? "🚇" : "🚌",
    color: itinerary.line.color,
    // ODsay 등 경로 전용 소스는 실시간 도착을 주지 않는다 — 있는 척하지 않는다
    live: arrivals.some((a) => a.live),
    legs,
    totalSec: sum(legs),
    leaveAt,
    arriveAt,
    boardAt,
    late,
    notes: [
      `${itinerary.line.name} 배차 약 ${fmtDur(itinerary.headwaySec)}`,
      nextArrivals[0]
        ? `다음 차 ${fmtDur(nextArrivals[0].inSec)} 후${nextArrivals[0].crowdingLabel ? ` · ${nextArrivals[0].crowdingLabel}` : ""}`
        : null,
    ].filter(Boolean),
    meta: { itinerary, nextArrivals },
  };
}

function planDriving(route, { now, arriveBy, bufferSec }) {
  const legs = [
    { kind: "walk", title: "출발 준비 · 차량까지", sub: "주차 위치까지 이동", sec: TO_CAR_SEC + bufferSec },
    {
      kind: "drive",
      title: "자차 주행",
      sub: `${route.summary} · ${fmtDistance(route.distance)}`,
      sec: route.durationSec,
    },
    { kind: "walk", title: "주차 후 목적지까지 도보", sub: "주차장 → 목적지", sec: PARK_WALK_SEC },
  ];

  const totalSec = sum(legs);
  const leaveAt = arriveBy ? new Date(arriveBy.getTime() - totalSec * 1000) : new Date(now);
  const arriveAt = new Date(leaveAt.getTime() + totalSec * 1000);
  const delaySec = route.durationSec - route.freeFlowSec;

  return {
    id: "driving",
    kind: "drive",
    label: "자차",
    icon: "🚗",
    color: "#1B64DA",
    live: true,
    legs,
    totalSec,
    leaveAt,
    arriveAt,
    late: false,
    notes: [
      `도로 상황 ${TRAFFIC_LABEL[route.trafficLevel]}${delaySec > 60 ? ` · 평소보다 +${fmtDur(delaySec)}` : ""}`,
      route.tollFare ? `통행료 약 ${route.tollFare.toLocaleString()}원` : null,
    ].filter(Boolean),
    meta: { route },
  };
}

function planWalking(route, { now, arriveBy, bufferSec }) {
  const legs = [
    { kind: "walk", title: "출발 준비", sub: "문 앞까지", sec: bufferSec },
    { kind: "walk", title: "도보 이동", sub: `${fmtDistance(route.distance)} 이동`, sec: route.durationSec },
  ];
  const totalSec = sum(legs);
  const leaveAt = arriveBy ? new Date(arriveBy.getTime() - totalSec * 1000) : new Date(now);

  return {
    id: "walking",
    kind: "walk",
    label: "도보",
    icon: "🚶",
    color: "#868C98",
    live: false,
    legs,
    totalSec,
    leaveAt,
    arriveAt: new Date(leaveAt.getTime() + totalSec * 1000),
    late: false,
    notes: [`총 ${fmtDistance(route.distance)}`],
    meta: { route },
  };
}

/**
 * 출발지 → 목적지의 모든 이동수단 후보를 계산한다.
 *
 * @param {object}   opts
 * @param {object}   opts.origin       {lat,lng}
 * @param {object}   opts.destination  {lat,lng}
 * @param {Date|null} opts.arriveBy    도착 희망 시각 (null이면 "지금 출발" 기준)
 * @param {Date}     [opts.now]
 * @param {number}   [opts.bufferMin]  개인 여유시간(분)
 * @param {number}   [opts.walkPace]   도보 속도 배율
 * @param {'transit'|'driving'|'walking'} [opts.prefer] 우선 노출할 수단
 */
export async function planTrip({
  origin,
  destination,
  arriveBy = null,
  now = new Date(),
  bufferMin = 5,
  walkPace = 1,
  prefer = "transit",
  signal,
} = {}) {
  const bufferSec = Math.max(0, Math.round(bufferMin * 60));
  const distance = haversine(origin, destination);

  const [itineraries, driving, walking] = await Promise.all([
    getTransitItineraries(origin, destination, { now, walkPace, signal }),
    getDirections(origin, destination, { mode: "driving", now, signal }),
    distance <= WALKABLE_M
      ? getDirections(origin, destination, { mode: "walking", now, walkPace, signal })
      : Promise.resolve(null),
  ]);

  const plans = [
    ...itineraries.map((it) => planTransit(it, { now, arriveBy, bufferSec })),
    planDriving(driving, { now, arriveBy, bufferSec }),
    walking ? planWalking(walking, { now, arriveBy, bufferSec }) : null,
  ].filter(Boolean);

  plans.forEach((plan) => {
    plan.slackSec = arriveBy ? Math.round((arriveBy.getTime() - plan.arriveAt.getTime()) / 1000) : null;
    plan.leaveInSec = Math.round((plan.leaveAt.getTime() - now.getTime()) / 1000);
    plan.distance = distance;
    /**
     * 도착 목표 없이 지금이 곧 출발 시각인 경우 — 카운트다운 대신 ETA를 강조한다.
     * (미래 시점을 now로 넣어 계산한 경우와 구분해야 하므로 실제 시계를 기준으로 판단)
     */
    plan.immediate = !arriveBy && plan.leaveAt.getTime() - Date.now() <= 1000;
  });

  // 선호 수단 우선 → 늦지 않는 안 우선 → 총 소요 짧은 순
  const preferRank = (plan) => {
    if (prefer === "driving") return plan.kind === "drive" ? 0 : 1;
    if (prefer === "walking") return plan.kind === "walk" ? 0 : 1;
    return ["subway", "bus"].includes(plan.kind) ? 0 : 1;
  };

  plans.sort(
    (a, b) =>
      preferRank(a) - preferRank(b) ||
      Number(a.late) - Number(b.late) ||
      a.totalSec - b.totalSec,
  );

  return plans;
}

/** 카운트다운 상태 등급 */
export function urgency(leaveInSec) {
  if (leaveInSec < 0) return "late";
  if (leaveInSec <= 5 * 60) return "urgent";
  if (leaveInSec <= 15 * 60) return "soon";
  return "normal";
}
