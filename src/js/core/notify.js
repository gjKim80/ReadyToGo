/**
 * 출발 알림.
 *
 * ⚠️ 웹앱 한계: 브라우저는 앱이 닫힌 동안 임의 시각 알림을 보장하지 않는다
 * (Push 서버 없이는 백그라운드 타이머가 종료됨). 여기서는 앱이 열려 있는 동안의
 * 예약 알림만 처리하고, 완전한 백그라운드 알림은 Web Push + 서버가 필요하다.
 */

import { fmtClock } from "../util.js";

const LEAD_TIMES = [10 * 60, 0]; // 출발 10분 전, 출발 시각
let timers = [];

export const canNotify = () => "Notification" in window;

export async function requestPermission() {
  if (!canNotify()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

export function clearAlerts() {
  timers.forEach(clearTimeout);
  timers = [];
}

/** 선택된 플랜 기준으로 출발 알림을 다시 예약한다. */
export function scheduleDepartureAlerts(plan, destName) {
  clearAlerts();
  if (!canNotify() || Notification.permission !== "granted" || !plan) return;

  LEAD_TIMES.forEach((lead) => {
    const fireAt = plan.leaveAt.getTime() - lead * 1000;
    const delay = fireAt - Date.now();
    if (delay <= 0 || delay > 6 * 3600 * 1000) return;

    timers.push(
      setTimeout(() => {
        const title = lead ? `${lead / 60}분 후 출발하세요` : "지금 출발하세요!";
        new Notification(title, {
          body: `${destName} · ${fmtClock(plan.leaveAt)} 출발 → ${fmtClock(plan.arriveAt)} 도착 예정`,
          tag: "readytogo-departure",
          icon: "./assets/icon-192.png",
        });
      }, delay),
    );
  });
}
