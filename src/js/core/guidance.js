/**
 * 탑승 중 실시간 안내 — 순수 함수. DOM/상태 없이 입력만으로 진행 상황을 계산해서
 * 지하철 터널 안에서도(=GPS 없이도) 항상 뭔가 보여줄 수 있게 시간 기반을 축으로 삼고,
 * GPS 신호가 잡힐 때만(지상 구간/역 근처) 보정한다.
 */

import { haversine } from "../util.js";

const GPS_SNAP_METERS = 300;
const ARRIVE_SNAP_METERS = 100;

/** 지하철 구간(leg)에서 경과시간 기준으로 몇 번째 역 근처인지 추정 */
function estimateStationIndex(leg, elapsedInLeg) {
  const stops = leg.stops;
  if (!stops?.length || stops.length < 2) return null;
  const perStation = leg.sec / (stops.length - 1);
  if (!Number.isFinite(perStation) || perStation <= 0) return 0;
  const raw = Math.floor(elapsedInLeg / perStation);
  return Math.max(0, Math.min(stops.length - 1, raw));
}

/** gps가 남은 역 중 하나에 충분히 가까우면 그 역으로 스냅 보정 — 뒤로는 안 간다(노이즈 방지) */
function correctWithGps(leg, stationIndex, gps) {
  if (!gps || !leg.stops?.length) return stationIndex;
  let best = null;
  leg.stops.forEach((stop, i) => {
    if (i < stationIndex - 1) return; // 이미 지난 역은 후보에서 제외
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
    const dist = haversine(gps, stop);
    if (dist <= GPS_SNAP_METERS && (!best || dist < best.dist)) best = { index: i, dist };
  });
  return best ? Math.max(stationIndex, best.index) : stationIndex;
}

/**
 * @param {object} planSnapshot { legs, totalSec, destination: {lat,lng,name} }
 * @param {object} guidance     { startedAt, alertedGetOff }
 * @param {Date}   now
 * @param {{lat:number,lng:number}|null} gps 최근 위치 보정값(폴백/실패 시 null)
 */
export function estimateProgress(planSnapshot, guidance, now, gps = null) {
  const { legs, destination } = planSnapshot;
  const elapsed = Math.max(0, (now.getTime() - new Date(guidance.startedAt).getTime()) / 1000);

  // GPS가 목적지 근처를 확인하면 시간 추정과 상관없이 바로 완료 처리
  if (gps && destination && haversine(gps, destination) <= ARRIVE_SNAP_METERS) {
    return { legIndex: legs.length - 1, isComplete: true, secRemainingTotal: 0, shouldAlertGetOff: false };
  }

  let cursor = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    const legEnd = cursor + leg.sec;
    if (elapsed < legEnd || i === legs.length - 1) {
      const elapsedInLeg = Math.min(leg.sec, elapsed - cursor);
      const secRemainingTotal = Math.max(0, legs.slice(i).reduce((acc, l) => acc + l.sec, 0) - elapsedInLeg);
      const isComplete = i === legs.length - 1 && elapsed >= legEnd;

      let stationIndex = estimateStationIndex(leg, elapsedInLeg);
      if (stationIndex !== null) stationIndex = correctWithGps(leg, stationIndex, gps);

      const stationsRemaining = stationIndex === null ? null : leg.stops.length - 1 - stationIndex;
      const nextStopName = stationIndex === null || stationsRemaining === 0 ? null : leg.stops[stationIndex + 1]?.name;

      return {
        legIndex: i,
        leg,
        elapsedInLeg,
        secRemainingTotal,
        stationIndex,
        stationsRemaining,
        nextStopName,
        isComplete,
        shouldAlertGetOff: !guidance.alertedGetOff && stationsRemaining === 1,
      };
    }
    cursor = legEnd;
  }

  // legs가 비어 있는 등 예외 상황 — 완료로 처리해 화면이 멈추지 않게 한다
  return { legIndex: Math.max(0, legs.length - 1), isComplete: true, secRemainingTotal: 0, shouldAlertGetOff: false };
}
