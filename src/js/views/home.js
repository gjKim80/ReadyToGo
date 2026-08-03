/** 홈 — 평일/주말 모드별 "설정 → Ready → Go" 흐름과 출발 카운트다운 */

import { getWeather } from "../api/weather.js";
import { getCurrentPosition, reverseGeocode } from "../api/places.js";
import { planTrip } from "../core/departure.js";
import { buildAdvice } from "../core/advice.js";
import { buildShareText, openTmap, shareText } from "../core/share.js";
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
  legsList,
  legsTimeline,
  liveArrivals,
  otherOptionsList,
  planNotes,
  recommendedHeader,
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
  // 출근이면 집(출발지), 퇴근이면 회사(출발지) 날씨 — trip.origin이 방향에 따라 이미 그렇게 잡혀 있다
  let weatherData = { weather: null, destWeather: null };

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
    renderWeatherSlot();
  }

  function renderWeatherSlot() {
    const slot = root.querySelector("#weather-slot");
    if (!slot) return;
    const tips = buildAdvice(weatherData.weather, weatherData.destWeather, estimatePlan);
    slot.innerHTML = weatherAdviceRow(weatherData.weather, trip.origin?.name || "", tips);
  }

  async function loadWeatherOnce() {
    if (!trip.origin || !trip.destination) return;
    try {
      const [weather, destWeather] = await Promise.all([
        getWeather(trip.origin, { now: new Date() }),
        getWeather(trip.destination, { now: new Date() }),
      ]);
      if (disposed) return;
      weatherData = { weather, destWeather };
      renderWeatherSlot();
    } catch {
      // 실패해도 화면을 막지 않는다 — 날씨 카드는 없으면 스켈레톤인 채로 조용히 남는다
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
        <div class="hero-time-row">
          <span class="hero-time-tap">
            <p class="hero-time">${clockHtml(clock12Parts(atTime(trip.direction === "toWork" ? s.commute.arriveAt : s.commute.leaveAt)))}</p>
            <input
              type="time"
              class="field-value-input-native"
              data-commute-quick="${trip.direction === "toWork" ? "arriveAt" : "leaveAt"}"
              value="${escapeHtml(trip.direction === "toWork" ? s.commute.arriveAt : s.commute.leaveAt)}"
            />
          </span>
          <button class="status-chip status-chip--ok" type="button" data-act="edit-time">
            <span class="status-chip__dot" aria-hidden="true"></span>변경
          </button>
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
                <button class="chip" data-origin="" aria-pressed="${!s.trip.originId}"><span class="icon icon--pin" aria-hidden="true"></span> 현재 위치</button>
                ${getHome() ? `<button class="chip" data-origin="${escapeHtml(getHome().id)}" aria-pressed="${s.trip.originId === getHome().id}"><span class="icon icon--home" aria-hidden="true"></span> 집</button>` : ""}
                ${getWork() ? `<button class="chip" data-origin="${escapeHtml(getWork().id)}" aria-pressed="${s.trip.originId === getWork().id}"><span class="icon icon--work" aria-hidden="true"></span> 회사</button>` : ""}
              </div>`
        }`
      : "";

    const readyDisabled = isWeekday ? false : !destination || pickerOpen;

    root.innerHTML = `
      ${heroTimeBlock(new Date())}
      ${
        trip.origin && trip.destination
          ? `<div id="weather-slot" style="margin-top:12px"><div class="card"><div class="skeleton" style="height:90px"></div></div></div>`
          : ""
      }
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
  loadWeatherOnce();

  delegate(root, "click", "[data-dir]", (_e, el) => {
    if (state.trip.weekdayDirection === el.dataset.dir) return;
    setTrip({ weekdayDirection: el.dataset.dir });
    ctx.refresh?.();
  });

  // iOS는 시/분을 따로따로 커밋할 때마다 change를 쏜다 — 그때마다 다시 그리면 휠 피커가
  // 아직 열려 있는 input을 통째로 갈아치우게 돼 시만 고치고 튕겨나온다. 포커스가 완전히
  // 빠져나갔을 때(focusout)만 반영한다.
  delegate(root, "focusout", "[data-commute-quick]", (_e, el) => {
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

  delegate(root, "focusout", "#arriveBy", (_e, el) => {
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

// 평일 카운트다운 라벨을 방향별 기분으로 랜덤하게 — 출근은 가기 싫은 마음, 퇴근은 신난 마음
const WORK_MOOD_LABELS = [
  "무거운 발걸음 떼기까지",
  "이불 밖 탈출 성공까지",
  "현실 자각 타임까지",
  "오늘도 출근 강행까지",
  "사원증 목에 걸기까지",
  "월급 벌러 가기까지",
  "커피 수혈 완료까지",
  "출근길 눈물 닦기까지",
  "지각 방어 출발까지",
  "오늘 하루치 버티기까지",
  "사회인 코스프레 시작까지",
  "오늘의 노동 개시까지",
  "정신줄 부여잡기까지",
  "자본주의 출근까지",
  "억지 미소 장착까지",
  "출근길 한숨 3회까지",
  "오늘도 을의 자세까지",
  "월급루팡 출근까지",
  "지옥철 탑승까지",
  "오늘 하루 시작 버튼까지",
];
const HOME_MOOD_LABELS = [
  "퇴근 버튼 누르기까지",
  "자유의 문 열기까지",
  "소파와 재회하기까지",
  "오늘 고생 끝나기까지",
  "야근 탈출 성공까지",
  "집으로 순간이동까지",
  "침대 다이빙까지",
  "저녁 메뉴 고민 시작까지",
  "행복 회로 가동까지",
  "오늘의 미션 클리어까지",
  "퇴근각 완성까지",
  "오늘도 살아남기 성공까지",
  "상사 안녕히 가세요까지",
  "자유 시민 복귀까지",
  "넷플릭스 접속까지",
  "치맥 소환까지",
  "오늘의 해방까지",
  "사복 갈아입기까지",
  "집밥 냄새 맡기까지",
  "오늘의 엔딩크레딧까지",
];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function renderActive(root, ctx, trip, now0, isWeekday) {
  const view = { plans: [], selectedId: null, busExpanded: false };
  // 평일 출퇴근일 때만 방향별 기분 문구를 랜덤으로 뽑는다 — 주말 여행 모드는 기존 기본 문구 그대로
  const countdownNormalLabel = isWeekday
    ? pickRandom(trip.direction === "toHome" ? HOME_MOOD_LABELS : WORK_MOOD_LABELS)
    : undefined;

  async function load() {
    const s = getState();
    const now = new Date();
    const planNow = trip.planNow > now ? trip.planNow : now;

    const plans = await planTrip({
      origin: trip.origin,
      destination: trip.destination,
      arriveBy: trip.arriveBy,
      now: planNow,
      bufferMin: s.settings.bufferMin,
      walkPace: s.settings.walkPace,
      prefer: isWeekday ? s.settings.preferredMode : s.trip.mode,
    });

    view.plans = plans;
    // 처음 진입할 땐(선택된 플랜이 아직 없으면) 선호 수단이 아니라 실제로 가장 빨리 가는 쪽을 고른다
    if (!plans.some((p) => p.id === view.selectedId)) {
      const fastest = plans.reduce((min, p) => (p.totalSec < min.totalSec ? p : min), plans[0]);
      view.selectedId = fastest?.id ?? null;
    }
  }

  function selected() {
    return view.plans.find((p) => p.id === view.selectedId) || view.plans[0] || null;
  }

  function paint() {
    const s = getState();
    const plan = selected();

    root.innerHTML = `
      ${headerLine(new Date(), isWeekday)}

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

      ${
        plan
          ? `${recommendedHeader(plan)}
             <div class="card" style="margin-top:8px">
               ${legsTimeline(plan)}${legsList(plan)}${planNotes(plan)}${approachLine(plan)}
               <div class="row" style="gap:8px;margin-top:12px">
                 <button class="btn btn--sm btn--ghost" data-act="share"><span class="icon icon--share" aria-hidden="true"></span> ETA 공유</button>
                 ${
                   plan.kind === "drive"
                     ? `<button class="btn btn--sm btn--ghost" data-act="tmap"><span class="icon icon--navigate" aria-hidden="true"></span> T맵으로 길안내</button>`
                     : ""
                 }
                 ${
                   plan.kind === "subway"
                     ? `<button class="btn btn--sm btn--primary" data-act="start-guide"><span class="icon icon--navigate" aria-hidden="true"></span> 이 경로로 안내 시작</button>`
                     : ""
                 }
               </div>
             </div>`
          : ""
      }
      ${plan ? liveArrivals(plan) : ""}

      ${otherOptionsList(view.plans, view.selectedId, { expandedBus: view.busExpanded })}

      <!-- 홈 화면 위젯 미리보기: 실제 OS 위젯 연동 전까지 노출하지 않음 (widgetCard는 ui/parts.js에 남겨둠) -->

      <p class="app-footer">
        ReadyToGo v${escapeHtml(APP_VERSION)} (dev) · ${escapeHtml(buildTimeLabel())} Update
      </p>`;

    tickCountdown(root, plan, new Date(), countdownNormalLabel);

    if (s.settings.notify) scheduleDepartureAlerts(plan, trip.destination.name);
  }

  /** "경로 상세"로 넘어갈 때 쓰는 trip patch — 상단 버튼과 옵션 카드별 CTA가 공유한다 */
  function goToDetail(plan) {
    const patch = {
      destinationId: trip.destination.id,
      originId: trip.origin.id || null,
      mode: plan?.kind === "drive" ? "driving" : "transit",
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
  }

  // 옵션 카드 자체의 "상세" CTA — 카드를 고르고 바로 넘어간다. [data-plan]보다 먼저 등록해서
  // 여기서 stopImmediatePropagation()하면 [data-plan]의 재렌더링(paint)이 안 끼어든다
  delegate(root, "click", "[data-detail-plan]", (e, el) => {
    e.stopImmediatePropagation();
    const plan = view.plans.find((p) => p.id === el.dataset.detailPlan);
    if (!plan) return;
    view.selectedId = plan.id;
    goToDetail(plan);
  });

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
    if (act === "share") {
      const plan = selected();
      if (!plan) return;
      const text = buildShareText({ plan, destination: trip.destination, tone: "now" });
      const result = await shareText(text);
      if (result === "copied") toast("공유 문구를 클립보드에 복사했어요");
      else if (result === "failed") toast("공유에 실패했어요");
      return;
    }
    if (act === "more-bus") {
      view.busExpanded = true;
      paint();
      return;
    }
    if (act === "tmap") {
      openTmap(trip.destination);
      return;
    }
    if (act === "start-guide") {
      const plan = selected();
      if (!plan) return;
      const completeMessage = isWeekday
        ? trip.direction === "toWork"
          ? "출근하느라 수고하셨어요! 오늘 하루도 힘내세요 💪"
          : "퇴근하느라 수고하셨어요! 푹 쉬세요 🌙"
        : "목적지에 도착했어요! 오늘도 수고하셨어요.";
      setTrip({
        guidance: {
          active: true,
          startedAt: new Date().toISOString(),
          planSnapshot: {
            legs: plan.legs,
            totalSec: plan.totalSec,
            destination: { lat: trip.destination.lat, lng: trip.destination.lng },
            destinationName: trip.destination.name,
            completeMessage,
          },
          alertedGetOff: false,
        },
      });
      location.hash = "#/guide";
    }
  });

  let disposed = false;

  await load();
  if (disposed) return () => {};
  root.classList.add("view-enter"); // 설정 화면이 접힌 자리에서 카운트다운 데이터가 나타나는 연출
  paint();

  const ticker = setInterval(() => {
    if (disposed) return;
    tickCountdown(root, selected(), new Date(), countdownNormalLabel);
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
