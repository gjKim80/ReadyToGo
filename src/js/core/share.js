/** 이동 경로 및 ETA 공유 (기획서 §4-⑤) */

import { fmtClock, fmtDur } from "../util.js";

/** 수신자가 열면 동일한 목적지로 경로가 세팅되는 딥링크 */
export function buildDeepLink(destination) {
  const url = new URL(location.href);
  url.hash = `#/route?name=${encodeURIComponent(destination.name)}&lat=${destination.lat}&lng=${destination.lng}`;
  return url.toString();
}

/**
 * 공유 문구 생성
 * @param {'now'|'plan'} tone  now: 지금 출발 / plan: 예정 안내
 */
export function buildShareText({ plan, destination, tone = "now", now = new Date() }) {
  const arriveAt = tone === "now" ? new Date(now.getTime() + plan.totalSec * 1000) : plan.arriveAt;
  const head =
    tone === "now"
      ? `나 지금 출발했어! ${fmtClock(arriveAt)} 도착 예정이야.`
      : `${fmtClock(plan.leaveAt)}에 출발할게. ${fmtClock(arriveAt)} 도착 예정이야.`;

  const via = plan.meta?.itinerary
    ? `${plan.icon} ${plan.meta.itinerary.line.name} · ${fmtDur(plan.totalSec)}`
    : `${plan.icon} ${plan.label} · ${fmtDur(plan.totalSec)}`;

  return [head, `📍 ${destination.name}`, via, buildDeepLink(destination)].join("\n");
}

/**
 * Web Share API → 실패 시 클립보드 복사.
 * @returns {Promise<'shared'|'copied'|'failed'>}
 */
export async function shareText(text, title = "ReadyToGo") {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
