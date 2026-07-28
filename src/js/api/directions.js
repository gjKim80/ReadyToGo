/**
 * 경로 어댑터 — NAVER Directions 5 (driving) / 도보 경로 대응.
 *
 * 반환 형태(정규화):
 *  {
 *    distance, durationSec, freeFlowSec, trafficLevel, tollFare, fuelPrice,
 *    summary, path: [[lat,lng], ...]
 *  }
 */

import { config, isMock, proxyGet } from "./config.js";
import { clamp, haversine, seededInt, seededRandom, pick, sleep } from "../util.js";

const ROADS = [
  "올림픽대로", "강변북로", "내부순환로", "경부고속도로", "동부간선도로",
  "서부간선도로", "북부간선도로", "테헤란로", "강남대로", "세종대로",
];

/** 요일/시간대별 정체 계수 — 1.0이 자유 흐름 */
export function trafficFactor(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const weekend = [0, 6].includes(date.getDay());

  if (weekend) {
    if (h >= 11 && h <= 14) return 1.2;
    if (h >= 15 && h <= 20) return 1.32;
    if (h >= 22 || h <= 6) return 0.92;
    return 1.08;
  }
  if (h >= 7 && h <= 9.5) return 1.62;
  if (h >= 17.5 && h <= 20) return 1.72;
  if (h >= 22 || h <= 6) return 0.88;
  if (h > 9.5 && h < 17.5) return 1.15;
  return 1.1;
}

export function trafficLevel(factor) {
  if (factor >= 1.5) return "jam";
  if (factor >= 1.2) return "slow";
  return "smooth";
}

export const TRAFFIC_LABEL = { smooth: "원활", slow: "서행", jam: "정체" };

/** 출발→도착 사이를 살짝 꺾인 폴리라인으로 근사 (지도 렌더링용) */
function mockPath(origin, destination, seed) {
  const steps = 7;
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const wobble = i === 0 || i === steps ? 0 : (seededRandom(`${seed}:p${i}`) - 0.5) * 0.012;
    path.push([
      origin.lat + (destination.lat - origin.lat) * t + wobble,
      origin.lng + (destination.lng - origin.lng) * t + wobble * 0.8,
    ]);
  }
  return path;
}

function mockDriving(origin, destination, now) {
  const straight = haversine(origin, destination);
  const seed = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}>d>${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`;

  // 실도로 거리 = 직선거리 × 굴곡계수(1.25~1.45)
  const detour = 1.25 + seededRandom(`${seed}:detour`) * 0.2;
  const distance = Math.round(straight * detour);

  // 자유흐름 속도: 단거리 도심 25km/h → 장거리 고속 75km/h
  const freeSpeedKmh = clamp(22 + (distance / 1000) * 2.4, 22, 78);
  const freeFlowSec = Math.round(distance / ((freeSpeedKmh * 1000) / 3600));

  const factor = trafficFactor(now) * (0.94 + seededRandom(`${seed}:f`) * 0.14);
  const durationSec = Math.round(freeFlowSec * factor);

  const tollFare = distance > 20000 ? seededInt(`${seed}:toll`, 800, 4800) : 0;
  const fuelPrice = Math.round(((distance / 1000) * 130) / 10) * 10;

  const via = [pick(`${seed}:r1`, ROADS)];
  if (distance > 8000) via.push(pick(`${seed}:r2`, ROADS));

  return {
    source: "mock",
    mode: "driving",
    distance,
    durationSec,
    freeFlowSec,
    trafficFactor: Number(factor.toFixed(2)),
    trafficLevel: trafficLevel(factor),
    tollFare,
    fuelPrice,
    summary: [...new Set(via)].join(" → "),
    path: mockPath(origin, destination, seed),
  };
}

function mockWalking(origin, destination, walkPace) {
  const straight = haversine(origin, destination);
  const distance = Math.round(straight * 1.28);
  const speed = 1.25 * walkPace; // m/s
  return {
    source: "mock",
    mode: "walking",
    distance,
    durationSec: Math.round(distance / speed),
    freeFlowSec: Math.round(distance / speed),
    trafficFactor: 1,
    trafficLevel: "smooth",
    tollFare: 0,
    fuelPrice: 0,
    summary: "도보 경로",
    path: mockPath(origin, destination, `${straight}:w`),
  };
}

/**
 * 자차/도보 경로 조회.
 * @param {'driving'|'walking'} mode
 */
export async function getDirections(origin, destination, { mode = "driving", now = new Date(), walkPace = 1, signal } = {}) {
  if (!isMock()) {
    try {
      return await proxyGet(
        config.endpoints.directions,
        {
          start: `${origin.lng},${origin.lat}`,
          goal: `${destination.lng},${destination.lat}`,
          option: mode === "driving" ? "trafast" : "walking",
        },
        { signal },
      );
    } catch (err) {
      console.warn("[directions] 프록시 실패 — 목 데이터로 폴백", err);
    }
  }

  await sleep(config.mockLatencyMs);
  return mode === "walking"
    ? mockWalking(origin, destination, walkPace)
    : mockDriving(origin, destination, now);
}
