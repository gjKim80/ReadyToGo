/** 탑승 중 실시간 안내 — "이 경로로 안내 시작" 이후의 라이브 트래킹 화면.
 * 시간 기반 추정이 축이고, GPS는 신호가 잡힐 때만(지상 구간/역 근처) 보정한다
 * (지하철 터널 안에서는 GPS가 거의 안 잡힌다) — 자세한 설계는 계획 문서 참고. */

import { getState, setTrip } from "../store.js";
import { estimateProgress } from "../core/guidance.js";
import { pollPosition } from "../core/track.js";
import { canNotify, requestPermission } from "../core/notify.js";
import { toast } from "../ui/components.js";
import { delegate, escapeHtml, fmtDur } from "../util.js";

const TICK_MS = 5000;

const LEG_STATUS_ICON = { walk: "walk", wait: "wait", subway: "subway", bus: "bus" };

function legStatusText(leg, progress) {
  if (leg.kind === "wait") return `${leg.title}`;
  if (leg.kind === "walk") return leg.title;
  if (leg.kind === "subway" || leg.kind === "bus") {
    if (progress.stationsRemaining === null) return `${leg.line?.name || ""} 탑승 중`;
    return progress.stationsRemaining === 0
      ? `곧 ${leg.alight?.name || ""} 도착`
      : `${leg.line?.name || ""} 탑승 중 · ${leg.alight?.name || ""} 방면`;
  }
  return leg.title || "";
}

function stopChips(leg, progress) {
  if (!leg.stops?.length || progress.stationIndex === null) return "";
  const upcoming = leg.stops.slice(progress.stationIndex, progress.stationIndex + 5);
  return `
    <div class="arrival-chips" style="margin-top:14px">
      ${upcoming
        .map(
          (s, i) => `
        <span class="arrival-chip${i === 0 ? " arrival-chip--chosen" : ""}">
          <span class="arrival-chip__time">${escapeHtml(s.name)}</span>
          <span class="arrival-chip__rel">${i === 0 ? "현재 근처" : `${i}개 역 전`}</span>
        </span>`,
        )
        .join("")}
    </div>`;
}

export async function render(root, ctx = {}) {
  const s0 = getState();
  const guidance = s0.trip.guidance;
  if (!guidance?.active || !guidance.planSnapshot) {
    location.hash = "#/home";
    return () => {};
  }

  let disposed = false;
  let lastGps = null;
  let completed = false;

  async function endGuidance(toHash = "#/home") {
    setTrip({ guidance: { active: false, startedAt: null, planSnapshot: null, alertedGetOff: false } });
    location.hash = toHash;
  }

  function paint() {
    if (disposed) return;
    const { planSnapshot, alertedGetOff } = getState().trip.guidance;
    if (!planSnapshot) return; // endGuidance 처리 중 재진입 방지

    const progress = estimateProgress(planSnapshot, { startedAt: guidance.startedAt, alertedGetOff }, new Date(), lastGps);

    if (progress.isComplete && !completed) {
      completed = true;
      root.innerHTML = `
        <div class="guide-complete">
          <p class="guide-complete__emoji">🎉</p>
          <p class="guide-complete__text">${escapeHtml(planSnapshot.completeMessage || "목적지에 도착했어요!")}</p>
          <button class="btn btn--primary btn--block" data-act="finish" style="margin-top:24px">확인</button>
        </div>`;
      return;
    }
    if (completed) return;

    if (progress.shouldAlertGetOff) {
      setTrip({ guidance: { ...getState().trip.guidance, alertedGetOff: true } });
      if (canNotify() && Notification.permission === "granted") {
        new Notification("하차 준비!", {
          body: `${progress.leg.alight?.name || "목적지"}에서 내리세요`,
          tag: "readytogo-getoff",
          icon: "./assets/icon-192.png",
        });
      }
      navigator.vibrate?.([200, 100, 200]);
    }

    const leg = progress.leg;
    const icon = LEG_STATUS_ICON[leg?.kind] || "navigate";

    root.innerHTML = `
      <div class="guide-header">
        <span class="icon icon--${icon}" aria-hidden="true"></span>
        <p class="guide-header__dest">${escapeHtml(planSnapshot.destinationName)}까지 안내 중</p>
      </div>

      <div class="card guide-status">
        <p class="guide-status__text">${escapeHtml(legStatusText(leg, progress))}</p>
        <p class="guide-status__eta">${fmtDur(progress.secRemainingTotal)} 남음</p>
        ${stopChips(leg, progress)}
      </div>

      ${
        alertedGetOff
          ? `<div class="banner banner--danger" style="margin-top:12px">
               <span class="banner__text">${escapeHtml(leg?.alight?.name || "목적지")}에서 내릴 준비를 하세요!</span>
             </div>`
          : ""
      }

      <button class="btn btn--ghost btn--block" data-act="stop" style="margin-top:20px">안내 종료</button>`;
  }

  if (canNotify() && Notification.permission === "default") requestPermission();

  paint();
  const ticker = setInterval(paint, TICK_MS);
  const stopTracking = pollPosition((pos) => {
    lastGps = pos;
  });

  delegate(root, "click", '[data-act="stop"]', () => {
    toast("안내를 종료했어요");
    endGuidance();
  });
  delegate(root, "click", '[data-act="finish"]', () => endGuidance());

  return () => {
    disposed = true;
    clearInterval(ticker);
    stopTracking();
  };
}
