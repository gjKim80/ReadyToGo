/** 홈 — 평일/주말 모드별 "설정 → Ready → Go" 흐름과 출발 카운트다운 */

import { getWeather } from "../api/weather.js";
import { getCurrentPosition, reverseGeocode } from "../api/places.js";
import { planTrip } from "../core/departure.js";
import { buildAdvice } from "../core/advice.js";
import { buildShareText, shareText } from "../core/share.js";
import { clearAlerts, scheduleDepartureAlerts } from "../core/notify.js";
import { APP_VERSION, buildTimeLabel } from "../version.js";
import {
  getHome,
  getPlace,
  getState,
  getWork,
  listFavorites,
  listPlaces,
  pushHistory,
  setCommute,
  setTrip,
} from "../store.js";
import { toast } from "../ui/components.js";
import { mountPlacePicker } from "../ui/placePicker.js";
import {
  approachLine,
  countdownBlock,
  groupedOptionList,
  legsList,
  liveArrivals,
  planNotes,
  tickCountdown,
  weatherAdviceRow,
} from "../ui/parts.js";
import {
  atTime,
  delegate,
  escapeHtml,
  fmtClock,
  fmtDateKo,
  nextOccurrence,
  sleep,
} from "../util.js";

/** 세션 동안 유지되는 현재 위치 캐시 */
let cachedOrigin = null;

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
    const direction = state.trip.weekdayDirection || auto;

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

function headerLine(now, isWeekday) {
  return `<p class="section-title">${escapeHtml(fmtDateKo(now))} · ${isWeekday ? "평일 모드" : "주말 모드"}</p>`;
}

/** Date → {ampm, h12, mm} — 현재 시각/회사 출발 시각 등 모든 큰 시계 표시가 이 포맷을 공유한다 */
function clock12Parts(date) {
  return {
    ampm: date.getHours() < 12 ? "오전" : "오후",
    h12: date.getHours() % 12 || 12,
    mm: String(date.getMinutes()).padStart(2, "0"),
  };
}

/** clock12Parts 결과를 hero-time 마크업으로 — 현재 시각/회사 출발 시각이 항상 같은 스타일을 쓰게 한다 */
function clockHtml({ ampm, h12, mm }) {
  return `<span class="hero-time__ampm">${escapeHtml(ampm)}</span><span class="hero-time__digits mono-num">${h12}:${mm}</span>`;
}

/** "출발 보드" 히어로 — eyebrow "현재 시각" + 전광판 스타일 큰 시각(고정폭) + 오늘 날짜 */
function heroTimeBlock(now) {
  return `
    <div class="hero-row">
      <span class="eyebrow">현재 시각</span>
      <span class="eyebrow eyebrow--muted">${escapeHtml(fmtDateKo(now))}</span>
    </div>
    <div class="hero-time-row">
      <p class="hero-time">${clockHtml(clock12Parts(now))}</p>
      <span id="status-chip-slot" class="status-chip-slot"></span>
    </div>`;
}

/**
 * 실제 지금부터 (plan이 요구하는) 출발 시각까지 남은 시간을 "여유 N시간 M분" 상태 칩으로 — 30분 이내면 warn 톤.
 * plan.leaveInSec은 planTrip에 넘긴 기준 시각(퇴근 목표처럼 미래일 수 있음) 대비라 여기 쓰면 안 되고,
 * 항상 실제 현재 시각(Date.now()) 기준으로 새로 계산해야 "지금부터의 여유"가 정확하다.
 */
function statusChipHtml(plan) {
  const leaveInSec = Math.round((plan.leaveAt.getTime() - Date.now()) / 1000);
  const mins = Math.round(leaveInSec / 60);
  const tone = mins <= 30 ? "warn" : "ok";
  let label;
  if (mins < 0) label = "출발 시각이 지났어요";
  else if (mins === 0) label = "지금 출발하세요";
  else if (mins >= 60) label = `여유 ${Math.floor(mins / 60)}시간 ${mins % 60}분`;
  else label = `여유 ${mins}분`;
  return `<span class="status-chip status-chip--${tone}"><span class="status-chip__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

/** 평일인데 집/회사 자체가 저장되어 있지 않은 경우 — Settings로 유도한다(대체 수단 없음). */
function commuteMissingCard() {
  const noPlacesAtAll = listPlaces().length === 0;
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

/* ---------- 설정 화면 (Ready를 누르기 전) ---------- */

function renderSetup(root, ctx, state, now0, isWeekday, trip) {
  let pickerOpen = isWeekday ? false : trip.needsSetup === "destination";
  let disposed = false;
  let pickerDispose = null;
  /** Ready 아래 예상 소요/상태 칩용 — 있으면 쓰고, 못 구했으면 조용히 생략(스펙 기준) */
  let estimatePlan = null;

  function applyEstimate() {
    if (pickerOpen || !estimatePlan) return;
    const chipSlot = root.querySelector("#status-chip-slot");
    if (chipSlot) chipSlot.innerHTML = statusChipHtml(estimatePlan);
    const subtextSlot = root.querySelector("#ready-subtext-slot");
    if (subtextSlot) {
      const mins = Math.round(estimatePlan.totalSec / 60);
      const label = isWeekday ? (trip.direction === "toWork" ? "회사" : "집") : trip.destination.name;
      subtextSlot.textContent = `${label} 도착까지 예상 ${mins}분`;
    }
  }

  async function loadEstimateOnce() {
    if (!trip.origin || !trip.destination) return;
    const s = getState();
    try {
      const plans = await planTrip({
        origin: trip.origin,
        destination: trip.destination,
        arriveBy: trip.arriveBy,
        now: trip.planNow,
        bufferMin: s.settings.bufferMin,
        walkPace: s.settings.walkPace,
        prefer: isWeekday ? s.settings.preferredMode : s.trip.mode,
      });
      if (disposed) return;
      estimatePlan = plans[0] || null;
      applyEstimate();
    } catch {
      // 실패해도 화면을 막지 않는다 — 칩/서브텍스트는 없으면 그냥 생략
    }
  }

  function paint() {
    const s = getState();
    const destination = isWeekday ? null : getPlace(s.trip.destinationId);
    const home = isWeekday ? getHome() : null;
    const work = isWeekday ? getWork() : null;

    const weekdayBody = isWeekday
      ? `
        <div class="route-row-list">
          <button class="route-row" data-dir="toWork" aria-pressed="${trip.direction === "toWork"}">
            <span class="route-row__bar" aria-hidden="true"></span>
            <span class="route-row__body">
              <span class="route-row__sub">집(${escapeHtml(home.name)}) → 회사(${escapeHtml(work.name)})</span>
              <span class="route-row__title">출근</span>
            </span>
          </button>
          <button class="route-row" data-dir="toHome" aria-pressed="${trip.direction === "toHome"}">
            <span class="route-row__bar" aria-hidden="true"></span>
            <span class="route-row__body">
              <span class="route-row__sub">회사(${escapeHtml(work.name)}) → 집(${escapeHtml(home.name)})</span>
              <span class="route-row__title">퇴근</span>
            </span>
          </button>
        </div>

        <span class="field-label">${trip.direction === "toWork" ? "회사 도착 목표" : "회사 출발 시각"}</span>
        <div class="hero-time-row" style="position:relative">
          <p class="hero-time">${clockHtml(clock12Parts(atTime(trip.direction === "toWork" ? s.commute.arriveAt : s.commute.leaveAt)))}</p>
          <button class="status-chip status-chip--ok" type="button" data-act="edit-time">
            <span class="status-chip__dot" aria-hidden="true"></span>변경
          </button>
          <input
            type="time"
            class="field-value-input-native"
            style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"
            data-commute-quick="${trip.direction === "toWork" ? "arriveAt" : "leaveAt"}"
            value="${escapeHtml(trip.direction === "toWork" ? s.commute.arriveAt : s.commute.leaveAt)}"
          />
        </div>`
      : "";

    const weekendBody = !isWeekday
      ? `
        <div class="route-row-list">
          ${
            pickerOpen
              ? `<div id="picker-slot" style="padding:4px 0"></div>`
              : `<button class="route-row" data-act="open-picker" aria-pressed="true" style="align-items:center">
                   <span class="route-row__bar" aria-hidden="true"></span>
                   <span class="route-row__body grow" style="min-width:0">
                     <span class="route-row__sub truncate">${escapeHtml(destination.address || "목적지")}</span>
                     <span class="route-row__title truncate">${escapeHtml(destination.name)}</span>
                   </span>
                   <span class="link-btn" style="flex:none;align-self:center">변경</span>
                 </button>`
          }
        </div>

        ${
          pickerOpen
            ? ""
            : `
              <span class="field-label">도착 희망 시각</span>
              <div class="hero-time-row">
                <input type="time" class="field-value-input grow" id="arriveBy" value="${escapeHtml(s.trip.arriveBy || "")}" />
                <button class="status-chip status-chip--ok" type="button" data-act="now">
                  <span class="status-chip__dot" aria-hidden="true"></span>지금 출발
                </button>
              </div>

              <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:16px">
                <span class="eyebrow">출발지</span>
                <button class="chip" data-origin="" aria-pressed="${!s.trip.originId}">📍 현재 위치</button>
                ${getHome() ? `<button class="chip" data-origin="${escapeHtml(getHome().id)}" aria-pressed="${s.trip.originId === getHome().id}">🏠 집</button>` : ""}
                ${getWork() ? `<button class="chip" data-origin="${escapeHtml(getWork().id)}" aria-pressed="${s.trip.originId === getWork().id}">🏢 회사</button>` : ""}
              </div>`
        }`
      : "";

    const readyDisabled = isWeekday ? false : !destination || pickerOpen;

    root.innerHTML = `
      ${heroTimeBlock(new Date())}
      <div id="setup-collapse" class="setup-collapse">
        ${weekdayBody}
        ${weekendBody}
      </div>
      ${
        !pickerOpen
          ? `<button class="btn btn--primary btn--block btn--ready" data-act="ready" style="margin-top:26px" ${readyDisabled ? "disabled" : ""}>
               READY
             </button>
             <p id="ready-subtext-slot" class="ready-subtext"></p>`
          : ""
      }
      <p class="app-footer">
        ReadyToGo v${escapeHtml(APP_VERSION)} (dev) · ${escapeHtml(buildTimeLabel())} Update
      </p>`;

    if (pickerOpen) {
      pickerDispose?.();
      pickerDispose = mountPlacePicker(root.querySelector("#picker-slot"), {
        title: "어디로 가시나요?",
        onSelect(place) {
          pickerDispose?.();
          pickerDispose = null;
          pickerOpen = false;
          pushHistory(place.id);
          setTrip({ destinationId: place.id });
          ctx.refresh?.();
        },
      });
    }

    applyEstimate();
  }

  paint();
  loadEstimateOnce();

  delegate(root, "click", "[data-dir]", (_e, el) => {
    if (state.trip.weekdayDirection === el.dataset.dir) return;
    setTrip({ weekdayDirection: el.dataset.dir });
    ctx.refresh?.();
  });

  delegate(root, "change", "[data-commute-quick]", (_e, el) => {
    if (!el.value) return;
    setCommute({ [el.dataset.commuteQuick]: el.value });
    toast("출퇴근 시각을 저장했어요");
    ctx.refresh?.();
  });

  delegate(root, "click", '[data-act="edit-time"]', () => {
    const input = root.querySelector("[data-commute-quick], #arriveBy");
    if (input?.showPicker) input.showPicker();
    else input?.focus();
  });

  delegate(root, "click", '[data-act="open-picker"]', () => {
    pickerOpen = true;
    paint();
  });

  delegate(root, "click", "[data-origin]", (_e, el) => {
    setTrip({ originId: el.dataset.origin || null });
    ctx.refresh?.();
  });

  delegate(root, "change", "#arriveBy", (_e, el) => {
    setTrip({ arriveBy: el.value || null });
    ctx.refresh?.();
  });

  delegate(root, "click", '[data-act="now"]', () => {
    setTrip({ arriveBy: null });
    ctx.refresh?.();
  });

  delegate(root, "click", '[data-act="ready"]', async (_e, el) => {
    el.disabled = true;
    el.textContent = "GO";
    el.classList.add("btn--ready--go");
    await sleep(420);
    if (disposed) return;

    // 기존 메뉴(방향/시간·목적지 설정)를 위로 밀어 접은 뒤, 그 자리에 카운트다운 데이터가 나타나도록
    const collapseEl = root.querySelector("#setup-collapse");
    if (collapseEl) {
      collapseEl.style.maxHeight = `${collapseEl.scrollHeight}px`;
      void collapseEl.offsetHeight; // 강제 리플로우 — 아래 클래스 추가가 트랜지션으로 잡히도록
      collapseEl.classList.add("setup-collapse--collapsed");
      await sleep(380);
      if (disposed) return;
    }

    setTrip({ active: true });
    ctx.refresh?.();
  });

  return () => {
    disposed = true;
    pickerDispose?.();
  };
}

/* ---------- 액티브 화면 (Ready → Go 이후 카운트다운) ---------- */

async function renderActive(root, ctx, trip, now0, isWeekday) {
  const view = { plans: [], selectedId: null, weather: null, destWeather: null };

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
        prefer: isWeekday ? s.settings.preferredMode : s.trip.mode,
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

    root.innerHTML = `
      ${headerLine(new Date(), isWeekday)}

      ${weatherAdviceRow(view.weather, trip.origin.name, tips)}

      <div class="card" style="margin-top:12px">
        <div class="row row--between" style="margin-bottom:4px">
          <div class="grow">
            <p style="font-size:16px;font-weight:800" class="truncate">${escapeHtml(trip.title)}</p>
            <p class="muted truncate" style="font-size:12.5px;font-weight:600;margin-top:2px">
              ${escapeHtml(trip.origin.name)} → ${escapeHtml(trip.destination.name)}
            </p>
          </div>
          <button class="btn btn--sm btn--ghost" data-act="reset" style="flex:none">다시 설정</button>
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

      ${groupedOptionList(view.plans, view.selectedId)}

      <!-- 홈 화면 위젯 미리보기: 실제 OS 위젯 연동 전까지 노출하지 않음 (widgetCard는 ui/parts.js에 남겨둠) -->

      <p class="app-footer">
        ReadyToGo v${escapeHtml(APP_VERSION)} (dev) · ${escapeHtml(buildTimeLabel())} Update
      </p>`;

    tickCountdown(root, plan);

    if (s.settings.notify) scheduleDepartureAlerts(plan, trip.destination.name);
  }

  delegate(root, "click", "[data-plan]", (_e, el) => {
    view.selectedId = el.dataset.plan;
    paint();
  });

  delegate(root, "click", "[data-act]", async (_e, el) => {
    const act = el.dataset.act;
    if (act === "reset") {
      setTrip({ active: false });
      ctx.refresh?.();
      return;
    }
    if (act === "detail") {
      const patch = {
        destinationId: trip.destination.id,
        originId: trip.origin.id || null,
        mode: selected()?.kind === "drive" ? "driving" : "transit",
      };
      // 홈에서 쓰던 시각 기준(출근=도착 목표 / 퇴근=출발 시각)을 경로 상세 화면에도 그대로 넘긴다 —
      // 안 그러면 저기선 "지금 출발" 기준으로 다시 계산돼 홈에서 맞춘 시각과 어긋난다
      if (trip.arriveBy) {
        patch.timeMode = "arrive";
        patch.arriveBy = fmtClock(trip.arriveBy);
      } else if (isWeekday && trip.direction === "toHome") {
        patch.timeMode = "depart";
        patch.departAt = fmtClock(trip.planNow);
      } else {
        patch.timeMode = "now";
      }
      setTrip(patch);
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

  let disposed = false;

  await load();
  if (disposed) return () => {};
  root.classList.add("view-enter"); // 설정 화면이 접힌 자리에서 카운트다운 데이터가 나타나는 연출
  paint();

  const ticker = setInterval(() => {
    if (disposed) return;
    tickCountdown(root, selected());
  }, 1000);

  const refresher = setInterval(async () => {
    // 백그라운드 탭에서 계속 돌면 API 호출 한도만 축낸다 — 보이지 않을 땐 건너뛴다
    if (disposed || document.hidden) return;
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

/* ---------- 진입점 ---------- */

export async function render(root, ctx = {}) {
  const now0 = new Date();
  const state = getState();
  const isWeekday = state.mode === "weekday";

  root.innerHTML = `
    ${headerLine(now0, isWeekday)}
    <div class="card"><div class="skeleton" style="height:52px"></div></div>
    <div class="card" style="margin-top:12px"><div class="skeleton" style="height:150px"></div></div>`;

  const trip = await resolveTrip(state, now0);

  if (trip.needsSetup === "commute") {
    root.innerHTML = `${headerLine(now0, isWeekday)}${commuteMissingCard()}`;
    return () => {};
  }

  // 목적지가 아예 없거나(주말) 아직 Ready를 안 눌렀으면 설정 화면
  // 장소가 지워졌다 등으로 trip을 못 만드는데 active만 true로 남아있는 경우도 여기서 자연히 걸러진다
  if (trip.needsSetup === "destination" || !state.trip.active) {
    return renderSetup(root, ctx, state, now0, isWeekday, trip);
  }

  return renderActive(root, ctx, trip, now0, isWeekday);
}
