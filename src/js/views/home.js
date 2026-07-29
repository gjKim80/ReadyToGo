/** 홈 — 평일/주말 모드별 출발 카운트다운, 날씨·준비물 가이드, 위젯 미리보기 */

import { getWeather } from "../api/weather.js";
import { getCurrentPosition, reverseGeocode } from "../api/places.js";
import { planTrip } from "../core/departure.js";
import { buildAdvice } from "../core/advice.js";
import { buildShareText, shareText } from "../core/share.js";
import { clearAlerts, scheduleDepartureAlerts } from "../core/notify.js";
import { APP_VERSION, BUILD_TIME } from "../version.js";
import {
  getHome,
  getPlace,
  getState,
  getWork,
  listFavorites,
  listPlaces,
  setCommute,
  setTrip,
} from "../store.js";
import { toast } from "../ui/components.js";
import {
  adviceBanners,
  approachLine,
  countdownBlock,
  legsList,
  liveArrivals,
  optionCard,
  planNotes,
  tickCountdown,
  weatherCard,
} from "../ui/parts.js";
import {
  atTime,
  delegate,
  escapeHtml,
  fmtClock,
  fmtDateKo,
  nextOccurrence,
} from "../util.js";

/** 세션 동안 유지되는 현재 위치 캐시 */
let cachedOrigin = null;

/** BUILD_TIME(ISO) → "2026.07.28 23:43" */
function buildTimeLabel() {
  const d = new Date(BUILD_TIME);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 사용자가 수동으로 뒤집은 평일 방향 (null이면 시간대 기준 자동) */
let directionOverride = null;

async function currentOrigin() {
  if (cachedOrigin) return cachedOrigin;
  const coord = await getCurrentPosition();
  const geo = await reverseGeocode(coord);
  cachedOrigin = { id: null, name: "현재 위치", address: geo.address, ...coord, icon: "📍" };
  return cachedOrigin;
}

/** 현재 모드에 맞는 출발지/목적지/도착 목표를 결정한다. */
async function resolveTrip(state, now) {
  if (state.mode === "weekday") {
    const home = getHome();
    const work = getWork();
    if (!home || !work) {
      return { needsSetup: "commute" };
    }

    const arriveTarget = atTime(state.commute.arriveAt, now);
    const auto = now < arriveTarget ? "toWork" : "toHome";
    const direction = directionOverride || auto;

    if (direction === "toWork") {
      const arriveBy = arriveTarget > now ? arriveTarget : nextOccurrence(state.commute.arriveAt, now);
      return {
        direction,
        origin: home,
        destination: work,
        arriveBy,
        planNow: now,
        title: `출근 · ${work.name}`,
        subtitle: `${fmtClock(arriveBy)} 도착 목표`,
      };
    }

    const leaveTarget = atTime(state.commute.leaveAt, now);
    const departTarget = leaveTarget > now ? leaveTarget : now;
    return {
      direction,
      origin: work,
      destination: home,
      arriveBy: null,
      planNow: departTarget,
      title: `퇴근 · ${home.name}`,
      subtitle: `${fmtClock(departTarget)} 회사 출발 기준`,
    };
  }

  // 주말 모드
  const destination = getPlace(state.trip.destinationId);
  if (!destination) return { needsSetup: "destination" };

  const origin = state.trip.originId ? getPlace(state.trip.originId) : await currentOrigin();
  const arriveBy = state.trip.arriveBy ? nextOccurrence(state.trip.arriveBy, now) : null;

  return {
    origin,
    destination,
    arriveBy,
    planNow: now,
    title: destination.name,
    subtitle: arriveBy ? `${fmtClock(arriveBy)} 도착 목표` : "지금 출발 기준",
  };
}

function setupCard(kind) {
  const noPlacesAtAll = listPlaces().length === 0;

  if (kind === "commute") {
    return `
      <div class="card">
        <p class="empty">${
          noPlacesAtAll
            ? "저장된 장소가 없어요.<br />집과 회사를 추가해주세요."
            : "평일 모드를 쓰려면 집과 회사를 먼저 등록하세요."
        }</p>
        <a class="btn btn--primary btn--block" href="#/settings">출퇴근 경로 설정하기</a>
      </div>`;
  }
  const favorites = listFavorites();
  return `
    <div class="card">
      <p class="empty">${
        noPlacesAtAll
          ? "저장된 장소가 없어요.<br />장소를 추가하면 출발 시각을 역산해 드려요."
          : "어디로 가시나요?<br />목적지를 정하면 출발 시각을 역산해 드려요."
      }</p>
      <a class="btn btn--primary btn--block" href="#/route">목적지 검색하기</a>
      ${
        favorites.length
          ? `<p class="section-title" style="margin:16px 0 8px">⭐ 즐겨찾기</p>
             <div class="row" style="gap:8px;flex-wrap:wrap">
               ${favorites
                 .map(
                   (p) =>
                     `<button class="chip" data-quick="${escapeHtml(p.id)}">${p.icon || "📍"} ${escapeHtml(p.name)}</button>`,
                 )
                 .join("")}
             </div>`
          : ""
      }
    </div>`;
}

export async function render(root, ctx = {}) {
  const now0 = new Date();
  const state = getState();

  root.innerHTML = `
    <p class="section-title">${escapeHtml(fmtDateKo(now0))} · ${state.mode === "weekday" ? "평일 모드" : "주말 모드"}</p>
    <div class="card"><div class="skeleton" style="height:52px"></div></div>
    <div class="card" style="margin-top:12px"><div class="skeleton" style="height:150px"></div></div>`;

  const trip = await resolveTrip(state, now0);

  if (trip.needsSetup) {
    root.innerHTML = `
      <p class="section-title">${escapeHtml(fmtDateKo(now0))} · ${state.mode === "weekday" ? "평일 모드" : "주말 모드"}</p>
      ${setupCard(trip.needsSetup)}`;
    delegate(root, "click", "[data-quick]", (_e, el) => {
      setTrip({ destinationId: el.dataset.quick });
      ctx.refresh?.();
    });
    return () => {};
  }

  const view = {
    plans: [],
    selectedId: null,
    weather: null,
    destWeather: null,
  };

  async function load() {
    const s = getState();
    const now = new Date();
    const planNow = trip.planNow > now ? trip.planNow : now;

    const [plans, weather, destWeather] = await Promise.all([
      planTrip({
        origin: trip.origin,
        destination: trip.destination,
        arriveBy: trip.arriveBy,
        now: planNow,
        bufferMin: s.settings.bufferMin,
        walkPace: s.settings.walkPace,
        prefer: s.mode === "weekday" ? s.settings.preferredMode : s.trip.mode,
      }),
      getWeather(trip.origin, { now }),
      getWeather(trip.destination, { now }),
    ]);

    view.plans = plans;
    view.weather = weather;
    view.destWeather = destWeather;
    if (!plans.some((p) => p.id === view.selectedId)) view.selectedId = plans[0]?.id ?? null;
  }

  function selected() {
    return view.plans.find((p) => p.id === view.selectedId) || view.plans[0] || null;
  }

  function paint() {
    const s = getState();
    const plan = selected();
    const tips = buildAdvice(view.weather, view.destWeather, plan);
    const isWeekday = s.mode === "weekday";

    root.innerHTML = `
      <p class="section-title">${escapeHtml(fmtDateKo(new Date()))} · ${isWeekday ? "평일 모드" : "주말 모드"}</p>

      ${weatherCard(view.weather, trip.origin.name)}
      ${adviceBanners(tips)}

      <div class="card" style="margin-top:12px">
        <div class="row row--between" style="margin-bottom:4px">
          <div class="grow">
            <p style="font-size:16px;font-weight:800" class="truncate">${escapeHtml(trip.title)}</p>
            <p class="muted truncate" style="font-size:12.5px;font-weight:600;margin-top:2px">
              ${escapeHtml(trip.origin.name)} → ${escapeHtml(trip.destination.name)}
            </p>
            ${
              isWeekday
                ? `<div class="row" style="gap:6px;margin-top:6px;align-items:center">
                     <span class="muted" style="font-size:12.5px;font-weight:600;white-space:nowrap">
                       ${trip.direction === "toWork" ? "도착 목표" : "회사 출발"}
                     </span>
                     <input
                       type="time"
                       class="input"
                       data-commute-quick="${trip.direction === "toWork" ? "arriveAt" : "leaveAt"}"
                       value="${escapeHtml(trip.direction === "toWork" ? s.commute.arriveAt : s.commute.leaveAt)}"
                       style="height:32px;width:auto;min-width:0;padding:0 8px;font-size:13px;flex:none"
                     />
                   </div>`
                : `<p class="muted" style="font-size:12.5px;font-weight:600;margin-top:2px">${escapeHtml(trip.subtitle)}</p>`
            }
          </div>
          ${
            isWeekday
              ? `<div class="mode-switch" style="flex:none">
                   <button class="mode-switch__btn" data-dir="toWork" aria-selected="${trip.direction === "toWork"}">출근</button>
                   <button class="mode-switch__btn" data-dir="toHome" aria-selected="${trip.direction === "toHome"}">퇴근</button>
                 </div>`
              : `<button class="btn btn--sm btn--ghost" data-act="change-dest" style="flex:none">변경</button>`
          }
        </div>

        ${plan ? countdownBlock(plan) : `<p class="empty">경로를 찾을 수 없습니다.</p>`}
      </div>

      ${plan ? `<div class="card">${legsList(plan)}${planNotes(plan)}${approachLine(plan)}</div>` : ""}
      ${plan ? liveArrivals(plan) : ""}

      ${
        plan
          ? `<div class="row" style="gap:8px;margin-top:12px">
               <button class="btn btn--primary grow" data-act="share">🔗 ETA 공유</button>
               <button class="btn btn--ghost grow" data-act="detail">경로 상세</button>
             </div>`
          : ""
      }

      <p class="section-title" style="margin-top:22px">다른 이동수단</p>
      <div class="stack">
        ${view.plans.map((p) => optionCard(p, { selected: p.id === view.selectedId })).join("")}
      </div>

      <!-- 홈 화면 위젯 미리보기: 실제 OS 위젯 연동 전까지 노출하지 않음 (widgetCard는 ui/parts.js에 남겨둠) -->

      <p class="muted" style="font-size:11px;font-weight:600;text-align:center;margin-top:28px">
        ReadyToGo v${escapeHtml(APP_VERSION)} (dev) · ${escapeHtml(buildTimeLabel())} 업데이트
      </p>`;

    tickCountdown(root, plan);

    if (s.settings.notify) scheduleDepartureAlerts(plan, trip.destination.name);
  }

  /* ---------- 이벤트 ---------- */

  delegate(root, "click", "[data-plan]", (_e, el) => {
    view.selectedId = el.dataset.plan;
    paint();
  });

  delegate(root, "click", "[data-dir]", (_e, el) => {
    if (directionOverride === el.dataset.dir) return;
    directionOverride = el.dataset.dir;
    ctx.refresh?.();
  });

  delegate(root, "change", "[data-commute-quick]", (_e, el) => {
    if (!el.value) return;
    setCommute({ [el.dataset.commuteQuick]: el.value });
    toast("출퇴근 시각을 저장했어요");
    ctx.refresh?.();
  });

  delegate(root, "click", "[data-act]", async (_e, el) => {
    const act = el.dataset.act;
    if (act === "change-dest") {
      location.hash = "#/route";
      return;
    }
    if (act === "detail") {
      setTrip({ destinationId: trip.destination.id, mode: selected()?.kind === "drive" ? "driving" : "transit" });
      location.hash = "#/route";
      return;
    }
    if (act === "share") {
      const plan = selected();
      if (!plan) return;
      const text = buildShareText({ plan, destination: trip.destination, tone: "now" });
      const result = await shareText(text);
      if (result === "copied") toast("공유 문구를 클립보드에 복사했어요");
      else if (result === "failed") toast("공유에 실패했어요");
    }
  });

  /* ---------- 라이프사이클 ---------- */

  let disposed = false;

  await load();
  if (disposed) return () => {};
  paint();

  const ticker = setInterval(() => {
    if (disposed) return;
    tickCountdown(root, selected());
  }, 1000);

  const refresher = setInterval(async () => {
    if (disposed) return;
    await load();
    if (!disposed) paint();
  }, Math.max(20, getState().settings.autoRefreshSec) * 1000);

  return () => {
    disposed = true;
    clearInterval(ticker);
    clearInterval(refresher);
    clearAlerts();
  };
}
