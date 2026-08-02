/** 이동 경로 및 ETA 공유 (기획서 §4-⑤) */

import { fmtClock, fmtDur } from "../util.js";

/** 앱이 없을 때 보낼 스토어 — T맵은 현재 위치 기준으로 안내하므로 출발지 좌표는 넘기지 않는다 */
const TMAP_STORE_URL = /android/i.test(navigator.userAgent)
  ? "https://play.google.com/store/apps/details?id=com.skt.tmap.ku"
  : "https://apps.apple.com/kr/app/id431589174";

export function buildTmapUrl(destination) {
  const params = new URLSearchParams({
    goalname: destination.name,
    goalx: String(destination.lng),
    goaly: String(destination.lat),
  });
  return `tmap://route?${params}`;
}

/** T맵 앱으로 전환 — 잠깐 기다려도 화면이 그대로면(=앱이 안 열렸으면) 스토어로 보낸다 */
export function openTmap(destination) {
  location.href = buildTmapUrl(destination);
  setTimeout(() => {
    if (!document.hidden) location.href = TMAP_STORE_URL;
  }, 1200);
}

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
