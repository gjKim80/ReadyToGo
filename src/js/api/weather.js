/**
 * 날씨 어댑터 — 기상청 단기예보 API(초단기실황 + 단기예보) 대응.
 *
 * 실 연동 시 프록시가 다음 형태로 정규화해 응답한다고 가정한다:
 *   { temp, tempMin, tempMax, pop, sky, humidity, windMs, hourly: [...] }
 * sky: clear | cloudy | overcast | rain | shower | snow
 */

import { config, isMock, proxyGet } from "./config.js";
import { clamp, seededRandom, sleep } from "../util.js";

/** 서울 기준 월별 평년 최저/최고 (목 데이터 생성용) */
const MONTHLY_NORMALS = [
  [-6, 2], [-4, 5], [1, 11], [7, 18], [13, 24], [18, 28],
  [22, 30], [23, 31], [17, 26], [10, 20], [3, 12], [-3, 4],
];

const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** 하루 기온 곡선: 05시 최저, 15시 최고인 사인 곡선 */
function tempAtHour(hour, min, max) {
  const amplitude = (max - min) / 2;
  const mid = (max + min) / 2;
  const phase = ((hour - 5 + 24) % 24) / 24;
  return mid - amplitude * Math.cos(2 * Math.PI * phase);
}

function skyFromPop(pop, temp, seed) {
  if (pop >= 60) return temp <= 1 ? "snow" : pop >= 80 ? "rain" : "shower";
  if (pop >= 30) return "overcast";
  return seededRandom(`${seed}:sky`) > 0.55 ? "cloudy" : "clear";
}

function mockWeather({ lat, lng }, now) {
  const seed = `${dayKey(now)}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const [normalMin, normalMax] = MONTHLY_NORMALS[now.getMonth()];

  // 일별 편차 ±3.5도, 위도에 따른 미세 보정
  const drift = (seededRandom(`${seed}:drift`) - 0.5) * 7;
  const latAdj = (37.5 - lat) * 1.2;
  const tempMin = Math.round((normalMin + drift + latAdj) * 10) / 10;
  const tempMax = Math.round((normalMax + drift + latAdj) * 10) / 10;

  const basePop = Math.round(seededRandom(`${seed}:pop`) * 100);
  const humidity = 40 + Math.round(seededRandom(`${seed}:hum`) * 50);
  const windMs = Math.round(seededRandom(`${seed}:wind`) * 70) / 10;

  const hourly = [];
  for (let i = 0; i < 12; i += 1) {
    const at = new Date(now.getTime() + i * 3600 * 1000);
    const h = at.getHours();
    const t = tempAtHour(h, tempMin, tempMax);
    // 오후로 갈수록 소나기 확률이 조금 올라가는 경향을 반영
    const hourPop = clamp(
      Math.round(basePop * (0.6 + seededRandom(`${seed}:${h}`) * 0.8) + (h >= 14 && h <= 19 ? 8 : 0)),
      0,
      100,
    );
    hourly.push({
      at: at.toISOString(),
      hour: h,
      temp: Math.round(t * 10) / 10,
      pop: hourPop,
      sky: skyFromPop(hourPop, t, `${seed}:${h}`),
    });
  }

  const current = hourly[0];
  return {
    source: "mock",
    observedAt: now.toISOString(),
    temp: current.temp,
    tempMin,
    tempMax,
    pop: current.pop,
    /** 향후 6시간 중 최대 강수확률 — 준비물 판단의 핵심 지표 */
    popMax6h: Math.max(...hourly.slice(0, 6).map((h) => h.pop)),
    sky: current.sky,
    humidity,
    windMs,
    hourly,
  };
}

/**
 * 좌표 기준 날씨 조회.
 * @param {{lat:number,lng:number}} coord
 * @returns {Promise<object>}
 */
export async function getWeather(coord, { now = new Date(), signal } = {}) {
  if (!isMock()) {
    try {
      return await proxyGet(config.endpoints.weather, { lat: coord.lat, lng: coord.lng }, { signal });
    } catch (err) {
      console.warn("[weather] 프록시 실패 — 목 데이터로 폴백", err);
    }
  }
  await sleep(config.mockLatencyMs);
  return mockWeather(coord, now);
}

export const SKY_LABEL = {
  clear: "맑음",
  cloudy: "구름 조금",
  overcast: "흐림",
  rain: "비",
  shower: "소나기",
  snow: "눈",
};

/** Flat 2D 스타일 날씨 아이콘 (인라인 SVG) */
export function skyGlyph(sky, size = 46) {
  const s = `width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"`;
  const sun = `<circle cx="24" cy="20" r="9" fill="#F7B733"/>`;
  const cloud = `<path d="M14 34h20a7 7 0 0 0 0-14 10 10 0 0 0-19 2 6 6 0 0 0-1 12Z" fill="#C9D2DE"/>`;
  const cloudDark = cloud.replace("#C9D2DE", "#94A3B4");
  const drops = `<path d="M18 38l-2 5M25 38l-2 5M32 38l-2 5" stroke="#2A8CE0" stroke-width="3" stroke-linecap="round"/>`;
  const flakes = `<path d="M18 40h4M20 38v4M28 40h4M30 38v4" stroke="#7FB6E8" stroke-width="2.6" stroke-linecap="round"/>`;

  switch (sky) {
    case "clear":
      return `<svg ${s}>${sun}<path d="M24 4v4M24 32v4M8 20h4M36 20h4M12 8l3 3M33 8l-3 3" stroke="#F7B733" stroke-width="3" stroke-linecap="round"/></svg>`;
    case "cloudy":
      return `<svg ${s}><circle cx="30" cy="16" r="7" fill="#F7B733"/>${cloud}</svg>`;
    case "rain":
      return `<svg ${s}>${cloudDark}${drops}</svg>`;
    case "shower":
      return `<svg ${s}><circle cx="32" cy="14" r="6" fill="#F7B733"/>${cloud}${drops}</svg>`;
    case "snow":
      return `<svg ${s}>${cloudDark}${flakes}</svg>`;
    default:
      return `<svg ${s}>${cloudDark}</svg>`;
  }
}
