/** 화면 간 공유되는 렌더 조각들 (홈 / 경로 상세에서 함께 사용) */

import { SKY_LABEL, skyGlyph } from "../api/weather.js";
import { TRAFFIC_LABEL } from "../api/directions.js";
import { urgency } from "../core/departure.js";
import { adviceSummary } from "../core/advice.js";
import {
  clamp,
  escapeHtml,
  fmtClock,
  fmtDistance,
  fmtDur,
  pad2,
  splitDuration,
} from "../util.js";

/* ---------- 날씨 ---------- */

export function weatherCard(weather, locationLabel) {
  if (!weather) {
    return `<div class="card"><div class="skeleton" style="height:52px"></div></div>`;
  }
  return `
    <div class="card">
      <div class="weather">
        <span class="weather__glyph">${skyGlyph(weather.sky)}</span>
        <div class="grow">
          <div class="row" style="gap:8px;align-items:baseline">
            <span class="weather__temp">${Math.round(weather.temp)}°</span>
            <span class="badge">${escapeHtml(SKY_LABEL[weather.sky] || "")}</span>
          </div>
          <p class="weather__meta">
            ${escapeHtml(locationLabel)} · 최저 ${Math.round(weather.tempMin)}° / 최고 ${Math.round(weather.tempMax)}°<br />
            강수확률 ${weather.pop}% · 습도 ${weather.humidity}% · 바람 ${weather.windMs}m/s
          </p>
        </div>
      </div>
    </div>`;
}

export function adviceBanners(tips) {
  if (!tips?.length) return "";
  return `<div class="stack">${tips
    .map(
      (tip) => `
      <div class="banner banner--${tip.tone}">
        <span class="banner__emoji">${tip.emoji}</span>
        <span class="banner__text">${escapeHtml(tip.text)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

/* ---------- 카운트다운 ---------- */

const URGENCY_LABEL = {
  late: "이미 출발했어야 해요",
  urgent: "지금 나가세요!",
  soon: "곧 출발해야 해요",
  normal: "문 앞 출발까지",
};

/** 카운트다운 블록의 정적 골격 — 값은 tickCountdown()이 갱신한다. */
export function countdownBlock(plan, { footNote = "" } = {}) {
  return `
    <div class="countdown" data-countdown>
      <p class="countdown__label" data-cd-label></p>
      <p class="countdown__time" data-cd-time>--:--</p>
      <p class="countdown__depart" data-cd-depart></p>
      <div class="progress"><div class="progress__bar" data-cd-bar style="width:0%"></div></div>
      ${footNote ? `<p class="muted" style="font-size:12.5px;font-weight:600;margin-top:10px">${escapeHtml(footNote)}</p>` : ""}
    </div>`;
}

/**
 * 1초마다 호출되는 카운트다운 갱신.
 * @param {HTMLElement} root  countdownBlock을 포함한 컨테이너
 */
export function tickCountdown(root, plan, now = new Date()) {
  const box = root.querySelector("[data-countdown]");
  if (!box || !plan) return;

  // 도착 목표가 없어 "지금 출발"이 기준인 경우: 남은 시간 대신 소요시간/ETA를 강조
  if (plan.immediate) {
    const arriveAt = new Date(now.getTime() + plan.totalSec * 1000);
    box.classList.remove("countdown--urgent", "countdown--soon", "countdown--late");
    box.classList.add("countdown--eta");
    box.querySelector("[data-cd-label]").textContent = "지금 출발하면";
    box.querySelector("[data-cd-time]").innerHTML = `${fmtDur(plan.totalSec)} <small>소요</small>`;
    box.querySelector("[data-cd-depart]").innerHTML =
      `<b>${fmtClock(arriveAt)}</b> 도착 예정 · ${escapeHtml(plan.label)}`;
    box.querySelector("[data-cd-bar]").style.width = "100%";
    return;
  }

  box.classList.remove("countdown--eta");
  const remainMs = plan.leaveAt.getTime() - now.getTime();
  const level = urgency(Math.round(remainMs / 1000));
  const { h, m, s } = splitDuration(remainMs);

  box.classList.toggle("countdown--urgent", level === "urgent");
  box.classList.toggle("countdown--soon", level === "soon");
  box.classList.toggle("countdown--late", level === "late");

  const timeEl = box.querySelector("[data-cd-time]");
  if (level === "late") {
    timeEl.innerHTML = `${h ? `${h}시간 ` : ""}${m}분 <small>지남</small>`;
  } else if (h > 0) {
    timeEl.innerHTML = `${h}<small>시간</small> ${pad2(m)}<small>분</small>`;
  } else {
    timeEl.innerHTML = `${pad2(m)}:${pad2(s)}`;
  }

  box.querySelector("[data-cd-label]").textContent = URGENCY_LABEL[level];

  const arriveAt = plan.arriveAt;
  box.querySelector("[data-cd-depart]").innerHTML =
    `<b>${fmtClock(plan.leaveAt)}</b> 출발 · ${fmtClock(arriveAt)} 도착 예정`;

  // 1시간 전부터 채워지는 진행 바
  const ratio = clamp(1 - remainMs / (60 * 60 * 1000), 0, 1);
  box.querySelector("[data-cd-bar]").style.width = `${(ratio * 100).toFixed(1)}%`;
}

/* ---------- 경로 상세 ---------- */

export function legsList(plan) {
  return `
    <ul class="legs">
      ${plan.legs
        .map(
          (leg) => `
        <li class="leg" data-kind="${leg.kind}">
          <div class="grow">
            <p class="leg__title">${escapeHtml(leg.title)}</p>
            ${leg.sub ? `<p class="leg__sub">${escapeHtml(leg.sub)}</p>` : ""}
          </div>
          <span class="leg__dur">${fmtDur(leg.sec)}</span>
        </li>`,
        )
        .join("")}
    </ul>`;
}

export function planNotes(plan) {
  if (!plan.notes?.length) return "";
  return `<p class="muted" style="font-size:12.5px;font-weight:600;line-height:1.6;margin-top:10px">
    ${plan.notes.map((n) => escapeHtml(n)).join(" · ")}
  </p>`;
}

/**
 * 도착 정보 스트립 (대중교통 플랜 전용).
 * 실시간 도착을 제공하는 소스일 때만 '실시간' 배지를 달고,
 * 배차간격으로 계산한 예정 시각은 그렇게 표시한다.
 */
export function liveArrivals(plan) {
  const arrivals = plan.meta?.nextArrivals;
  if (!arrivals?.length) return "";
  const line = plan.meta.itinerary.line;
  const isLive = arrivals.some((a) => a.live);

  return `
    <div class="card" style="padding:13px 14px">
      <div class="row row--between" style="margin-bottom:8px">
        <span style="font-size:13.5px;font-weight:800;color:${escapeHtml(line.color)}">${escapeHtml(line.name)}</span>
        ${
          isLive
            ? `<span class="badge badge--live"><span class="live-dot"></span>실시간</span>`
            : `<span class="badge badge--warn">배차 기준 예정</span>`
        }
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${arrivals
          .map(
            (a) =>
              `<span class="chip">${fmtDur(a.inSec)} 후${a.crowdingLabel ? ` · ${escapeHtml(a.crowdingLabel)}` : ""}</span>`,
          )
          .join("")}
      </div>
    </div>`;
}

/** 이동수단 후보 카드 */
export function optionCard(plan, { selected = false } = {}) {
  const slack = plan.slackSec;
  const badge = plan.late
    ? `<span class="badge badge--live">도착 지연</span>`
    : slack !== null && slack < 5 * 60
      ? `<span class="badge badge--warn">여유 ${fmtDur(Math.max(0, slack))}</span>`
      : slack !== null
        ? `<span class="badge badge--ok">여유 ${fmtDur(slack)}</span>`
        : "";

  const traffic = plan.meta?.route
    ? ` · 도로 ${TRAFFIC_LABEL[plan.meta.route.trafficLevel]}`
    : plan.meta?.itinerary
      ? ` · ${escapeHtml(plan.meta.itinerary.line.name)}`
      : "";

  return `
    <button class="option" data-plan="${escapeHtml(plan.id)}" aria-pressed="${selected}">
      <span class="option__head">
        <span class="option__mode">${plan.icon} ${escapeHtml(plan.label)}</span>
        ${badge}
        <span class="option__dur">${fmtDur(plan.totalSec)}</span>
      </span>
      <span class="option__desc">
        ${fmtClock(plan.leaveAt)} 출발 → ${fmtClock(plan.arriveAt)} 도착${traffic} · ${fmtDistance(plan.distance)}
      </span>
    </button>`;
}

/* ---------- 위젯 미리보기 ---------- */

/**
 * OS 홈 위젯(WidgetKit/Glance) 대응 카드.
 * 웹에서는 PWA 홈 화면 아이콘 + 이 요약 카드로 동일한 정보를 제공한다.
 */
export function widgetCard({ plan, weather, destName, now = new Date() }) {
  const remain = plan ? Math.round((plan.leaveAt.getTime() - now.getTime()) / 1000) : null;
  const big =
    remain === null
      ? "—"
      : remain < 0
        ? "출발!"
        : remain >= 3600
          ? `${Math.floor(remain / 3600)}시간 ${Math.floor((remain % 3600) / 60)}분`
          : `${Math.max(0, Math.round(remain / 60))}분`;

  return `
    <div class="widget">
      <div class="widget__top">
        <span>ReadyToGo</span>
        <span>${weather ? `${Math.round(weather.temp)}° · ${escapeHtml(adviceSummary(weather))}` : ""}</span>
      </div>
      <p class="widget__big">${escapeHtml(big)}</p>
      <p class="widget__sub">${plan ? `${fmtClock(plan.leaveAt)} 출발 · ${escapeHtml(destName || "")}` : "목적지를 설정하세요"}</p>
      ${
        plan
          ? `<div class="widget__foot">${plan.icon} ${escapeHtml(plan.label)} · ${fmtDur(plan.totalSec)} · ${fmtClock(plan.arriveAt)} 도착</div>`
          : ""
      }
    </div>`;
}
