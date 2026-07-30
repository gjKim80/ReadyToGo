/** 경로 — 목적지 검색/핀 지정, 이동수단 비교, 출발 시각 역산 결과 */

import { getWeather } from "../api/weather.js";
import { planTrip } from "../core/departure.js";
import { buildAdvice } from "../core/advice.js";
import { buildShareText, shareText } from "../core/share.js";
import {
  getHome,
  getPlace,
  getState,
  getWork,
  pushHistory,
  setTrip,
  toggleFavorite,
  upsertPlace,
} from "../store.js";
import { toast } from "../ui/components.js";
import { createMap } from "../ui/map.js";
import { currentOrigin, mountPlacePicker } from "../ui/placePicker.js";
import {
  adviceBanners,
  approachLine,
  countdownBlock,
  groupedOptionList,
  legsList,
  liveArrivals,
  planNotes,
  tickCountdown,
} from "../ui/parts.js";
import { delegate, escapeHtml, nextOccurrence } from "../util.js";

/* ---------- 검색 화면(목적지가 아직 없을 때) ---------- */

function searchScreen(root, ctx) {
  return mountPlacePicker(root, {
    onSelect(place) {
      pushHistory(place.id);
      setTrip({ destinationId: place.id });
      ctx.refresh?.();
    },
  });
}

/* ---------- 결과 화면 ---------- */

async function resultScreen(root, ctx, destination) {
  const view = { plans: [], selectedId: null, weather: null, destWeather: null, origin: null, map: null, pickerOpen: false };
  let disposed = false;
  let pickerDispose = null;

  root.innerHTML = `<div class="card"><div class="skeleton" style="height:220px"></div></div>`;

  async function load() {
    const s = getState();
    const now = new Date();
    const origin = s.trip.originId ? getPlace(s.trip.originId) : await currentOrigin();
    const timeMode = s.trip.timeMode || "now";
    const arriveBy = timeMode === "arrive" && s.trip.arriveBy ? nextOccurrence(s.trip.arriveBy, now) : null;
    const departTarget = timeMode === "depart" && s.trip.departAt ? nextOccurrence(s.trip.departAt, now) : null;
    const planNow = departTarget && departTarget > now ? departTarget : now;

    const [plans, weather, destWeather] = await Promise.all([
      planTrip({
        origin,
        destination,
        arriveBy,
        now: planNow,
        bufferMin: s.settings.bufferMin,
        walkPace: s.settings.walkPace,
        prefer: s.trip.mode,
      }),
      getWeather(origin, { now: planNow }),
      getWeather(destination, { now: planNow }),
    ]);

    view.origin = origin;
    view.plans = plans;
    view.weather = weather;
    view.destWeather = destWeather;
    if (!plans.some((p) => p.id === view.selectedId)) view.selectedId = plans[0]?.id ?? null;
  }

  const selected = () => view.plans.find((p) => p.id === view.selectedId) || view.plans[0] || null;

  function paint() {
    const s = getState();
    const plan = selected();
    const fav = getPlace(destination.id)?.favorite;
    const timeMode = s.trip.timeMode || "now";

    if (view.pickerOpen) {
      // 목적지 검색을 그 자리에서 바로 띄운다 — "변경" 누르고 별도 화면으로 넘어가지 않는다
      root.innerHTML = `
        <div class="row row--between" style="margin-bottom:10px">
          <p class="muted" style="font-size:12.5px;font-weight:700">
            현재 목적지: ${escapeHtml(destination.name)}
          </p>
          <button class="btn btn--sm btn--ghost" data-act="cancel-change">취소</button>
        </div>
        <div id="picker-slot"></div>`;

      pickerDispose?.();
      pickerDispose = mountPlacePicker(root.querySelector("#picker-slot"), {
        onSelect(place) {
          pickerDispose?.();
          pickerDispose = null;
          pushHistory(place.id);
          setTrip({ destinationId: place.id });
          ctx.refresh?.();
        },
      });
      return;
    }

    root.innerHTML = `
      <div class="card">
        <div class="row row--between" style="gap:8px">
          <button class="row grow" data-act="change" style="text-align:left;min-width:0">
            <span class="grow" style="min-width:0">
              <span style="display:block;font-size:17px;font-weight:800" class="truncate">${escapeHtml(destination.name)}</span>
              <span class="muted truncate" style="display:block;font-size:12.5px;font-weight:600;margin-top:2px">
                ${escapeHtml(destination.address || "")}
              </span>
            </span>
            <span class="muted" style="font-size:12px;font-weight:700;flex:none">변경 ›</span>
          </button>
          <button class="place__act" data-act="fav" aria-label="즐겨찾기" style="flex:none">${fav ? "⭐" : "☆"}</button>
        </div>
      </div>

      <div class="card" style="padding:12px">
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <span class="muted" style="font-size:12.5px;font-weight:700">출발지</span>
          <button class="chip" data-origin="" aria-pressed="${!s.trip.originId}">📍 현재 위치</button>
          ${getHome() ? `<button class="chip" data-origin="${escapeHtml(getHome().id)}" aria-pressed="${s.trip.originId === getHome().id}">🏠 집</button>` : ""}
          ${getWork() ? `<button class="chip" data-origin="${escapeHtml(getWork().id)}" aria-pressed="${s.trip.originId === getWork().id}">🏢 회사</button>` : ""}
        </div>
        <div class="seg" style="margin-top:10px">
          <button class="seg__btn" data-mode="transit" aria-pressed="${s.trip.mode === "transit"}">🚇 대중교통</button>
          <button class="seg__btn" data-mode="driving" aria-pressed="${s.trip.mode === "driving"}">🚗 마이카</button>
        </div>
        <div class="seg" style="margin-top:10px">
          <button class="seg__btn" data-time-mode="now" aria-pressed="${timeMode === "now"}">지금 출발</button>
          <button class="seg__btn" data-time-mode="arrive" aria-pressed="${timeMode === "arrive"}">도착 희망</button>
          <button class="seg__btn" data-time-mode="depart" aria-pressed="${timeMode === "depart"}">출발 희망</button>
        </div>
        ${
          timeMode !== "now"
            ? `<label class="field" style="margin-top:10px">
                 <span class="field__label">${timeMode === "arrive" ? "도착 희망 시각" : "출발 희망 시각"}</span>
                 <input class="input" type="time" id="planTime"
                        value="${escapeHtml((timeMode === "arrive" ? s.trip.arriveBy : s.trip.departAt) || "")}" />
               </label>`
            : ""
        }
      </div>

      <div class="map" style="height:190px;margin-top:12px" id="route-map">
        <span class="map__hint">경로 미리보기</span>
      </div>

      ${plan ? `<div class="card" style="margin-top:12px">${countdownBlock(plan)}</div>` : ""}
      ${adviceBanners(buildAdvice(view.weather, view.destWeather, plan))}

      ${groupedOptionList(view.plans, view.selectedId)}

      ${plan ? `<div class="card" style="margin-top:12px">${legsList(plan)}${planNotes(plan)}${approachLine(plan)}</div>` : ""}
      ${plan ? liveArrivals(plan) : ""}

      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn btn--primary grow" data-act="share">🔗 ETA 공유</button>
        <button class="btn btn--ghost grow" data-act="pin-home">홈에 고정</button>
      </div>`;

    tickCountdown(root, plan);
    drawMap(plan);
  }

  function drawMap(plan) {
    const container = root.querySelector("#route-map");
    if (!container || !view.origin) return;
    view.map?.destroy();
    view.map = createMap(container, { center: view.origin, draggable: false });
    view.map.fit(view.origin, destination, 46);
    view.map.setMarkers([
      { ...view.origin, label: "출발", color: "#17A05F" },
      { ...destination, label: "도착", color: "#E0483C" },
    ]);
    // 자차는 NAVER Directions 폴리라인, 대중교통은 ODsay가 준 실제 경유 정류장/역 좌표를 잇는다
    const path = plan?.meta?.route?.path || plan?.meta?.itinerary?.path;
    view.map.setRoute(path || [[view.origin.lat, view.origin.lng], [destination.lat, destination.lng]]);
  }

  await load();
  if (disposed) return () => {};
  paint();

  /* ---------- 이벤트 ---------- */

  delegate(root, "click", "[data-plan]", (_e, el) => {
    view.selectedId = el.dataset.plan;
    paint();
  });

  delegate(root, "click", "[data-origin]", async (_e, el) => {
    setTrip({ originId: el.dataset.origin || null });
    await load();
    paint();
  });

  delegate(root, "click", "[data-mode]", async (_e, el) => {
    setTrip({ mode: el.dataset.mode });
    await load();
    paint();
  });

  delegate(root, "change", "#planTime", async (_e, el) => {
    const timeMode = getState().trip.timeMode || "now";
    if (timeMode === "arrive") setTrip({ arriveBy: el.value || null });
    else if (timeMode === "depart") setTrip({ departAt: el.value || null });
    await load();
    paint();
  });

  delegate(root, "click", "[data-time-mode]", async (_e, el) => {
    setTrip({ timeMode: el.dataset.timeMode });
    await load();
    paint();
  });

  delegate(root, "click", "[data-act]", async (_e, el) => {
    const act = el.dataset.act;
    if (act === "change") {
      view.pickerOpen = true;
      paint();
    } else if (act === "cancel-change") {
      view.pickerOpen = false;
      paint();
    } else if (act === "fav") {
      const next = toggleFavorite(destination.id);
      toast(next?.favorite ? "즐겨찾기에 추가했어요" : "즐겨찾기에서 제외했어요");
      paint();
    } else if (act === "pin-home") {
      setTrip({ destinationId: destination.id });
      toast("홈 화면에서 이 목적지로 카운트다운이 표시됩니다");
      location.hash = "#/home";
    } else if (act === "share") {
      const plan = selected();
      if (!plan) return;
      const result = await shareText(
        buildShareText({ plan, destination, tone: (getState().trip.timeMode || "now") !== "now" ? "plan" : "now" }),
      );
      if (result === "copied") toast("공유 문구를 클립보드에 복사했어요");
      else if (result === "failed") toast("공유에 실패했어요");
    }
  });

  const ticker = setInterval(() => {
    if (!disposed) tickCountdown(root, selected());
  }, 1000);

  const refresher = setInterval(async () => {
    // 백그라운드 탭에서 계속 돌면 API 호출 한도만 축낸다 — 보이지 않을 땐 건너뛴다
    // 목적지 검색 중일 땐 입력 중인 화면을 갈아엎지 않는다
    if (disposed || document.hidden || view.pickerOpen) return;
    await load();
    if (!disposed) paint();
  }, Math.max(20, getState().settings.autoRefreshSec) * 1000);

  return () => {
    disposed = true;
    clearInterval(ticker);
    clearInterval(refresher);
    view.map?.destroy();
    pickerDispose?.();
  };
}

/* ---------- 진입점 ---------- */

export async function render(root, ctx = {}) {
  // 공유 딥링크(#/route?name=&lat=&lng=)로 진입한 경우 목적지를 즉시 세팅
  const query = ctx.query || {};
  if (query.lat && query.lng) {
    const saved = upsertPlace({
      name: query.name || "공유된 위치",
      address: query.address || "",
      lat: Number(query.lat),
      lng: Number(query.lng),
      icon: "📍",
    });
    pushHistory(saved.id);
    setTrip({ destinationId: saved.id });
    location.replace(`${location.pathname}${location.search}#/route`);
  }

  const destination = getPlace(getState().trip.destinationId);
  return destination ? resultScreen(root, ctx, destination) : searchScreen(root, ctx);
}
