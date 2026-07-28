/**
 * 맞춤 준비물 가이드 — 날씨/도로 상황을 사용자 행동 문장으로 변환한다.
 * 기획서 §4-③ 규칙(강수확률 30% 이상 → 우산, 일교차 → 겉옷)을 기준으로 확장.
 */

import { fmtDur } from "../util.js";

const POP_UMBRELLA = 30;
const POP_STRONG = 60;
const DIURNAL_RANGE = 10;

/**
 * @param {object} weather        출발지 날씨
 * @param {object} [destWeather]  목적지 날씨 (다르면 비교 안내)
 * @param {object} [plan]         선택된 이동 플랜 (도로/혼잡 안내용)
 * @returns {Array<{id,emoji,text,tone}>}
 */
export function buildAdvice(weather, destWeather = null, plan = null) {
  const tips = [];
  if (!weather) return tips;

  const pop = Math.max(weather.pop ?? 0, weather.popMax6h ?? 0);
  const range = (weather.tempMax ?? 0) - (weather.tempMin ?? 0);
  // 현재값보다 향후 6시간 최대값이 높으면 "이동 시간대" 기준임을 밝힌다
  const popWhen = pop > (weather.pop ?? 0) ? "6시간 내 최대 강수 확률" : "강수 확률";

  if (pop >= POP_STRONG) {
    tips.push({
      id: "umbrella-strong",
      emoji: "☂️",
      tone: "rain",
      text: `${popWhen} ${pop}% — 우산은 필수, 우비도 고려하세요!`,
    });
  } else if (pop >= POP_UMBRELLA) {
    tips.push({
      id: "umbrella",
      emoji: "☂️",
      tone: "rain",
      text: `${popWhen} ${pop}% — 오늘 우산 챙기세요!`,
    });
  }

  if (weather.sky === "snow") {
    tips.push({ id: "snow", emoji: "❄️", tone: "cold", text: "눈 예보 — 미끄럼 방지 신발과 이동 시간 여유를 두세요." });
  }

  if (range >= DIURNAL_RANGE && weather.tempMin < 20) {
    tips.push({
      id: "outer",
      emoji: "🧥",
      tone: "warn",
      text: `일교차 ${Math.round(range)}℃ — 가벼운 겉옷을 추천합니다.`,
    });
  }

  if (weather.tempMin <= 0) {
    tips.push({ id: "freeze", emoji: "🧣", tone: "cold", text: `최저 ${Math.round(weather.tempMin)}℃ — 목도리와 장갑을 챙기세요.` });
  }

  if (weather.tempMax >= 31) {
    tips.push({ id: "heat", emoji: "🥤", tone: "warn", text: `최고 ${Math.round(weather.tempMax)}℃ — 물과 양산, 그늘 이동을 권장합니다.` });
  }

  if ((weather.windMs ?? 0) >= 8) {
    tips.push({ id: "wind", emoji: "🌬️", tone: "warn", text: `순간 풍속 ${weather.windMs}m/s — 우산보다 우비가 안전합니다.` });
  }

  // 목적지 날씨가 출발지와 뚜렷이 다를 때만 별도 안내
  if (destWeather) {
    const destPop = Math.max(destWeather.pop ?? 0, destWeather.popMax6h ?? 0);
    if (destPop >= POP_UMBRELLA && destPop - pop >= 20) {
      tips.push({
        id: "dest-rain",
        emoji: "🌧️",
        tone: "rain",
        text: `목적지는 강수 확률 ${destPop}% — 도착지에서 비를 만날 수 있어요.`,
      });
    }
    const dt = Math.round((destWeather.temp ?? 0) - (weather.temp ?? 0));
    if (Math.abs(dt) >= 4) {
      tips.push({
        id: "dest-temp",
        emoji: dt < 0 ? "🥶" : "🌡️",
        tone: "info",
        text: `목적지가 현재 위치보다 ${Math.abs(dt)}℃ ${dt < 0 ? "낮습니다" : "높습니다"}.`,
      });
    }
  }

  if (plan?.meta?.route?.trafficLevel === "jam") {
    const delay = plan.meta.route.durationSec - plan.meta.route.freeFlowSec;
    tips.push({
      id: "traffic",
      emoji: "🚗",
      tone: "danger",
      text: `도로 정체 — 평소보다 ${fmtDur(delay)} 더 걸립니다. 대중교통도 확인해 보세요.`,
    });
  }

  if (!tips.length) {
    tips.push({ id: "clear", emoji: "👍", tone: "info", text: "특별히 챙길 건 없어요. 가볍게 다녀오세요!" });
  }

  return tips;
}

/** 위젯/공유용 한 줄 요약 */
export function adviceSummary(weather) {
  if (!weather) return "날씨 정보 없음";
  const pop = Math.max(weather.pop ?? 0, weather.popMax6h ?? 0);
  if (pop >= POP_UMBRELLA) return `우산 필요 · 강수 ${pop}%`;
  if ((weather.tempMax ?? 0) - (weather.tempMin ?? 0) >= DIURNAL_RANGE) return "겉옷 챙기기";
  return "우산 불필요";
}
