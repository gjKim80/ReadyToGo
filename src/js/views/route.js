/** 경로 — 목적지 검색/핀 지정, 이동수단 비교, 출발 시각 역산 결과 */

import { getCurrentPosition, reverseGeocode, searchPlaces } from "../api/places.js";
import { getWeather } from "../api/weather.js";
import { planTrip } from "../core/departure.js";
import { buildAdvice } from "../core/advice.js";
import { buildShareText, shareText } from "../core/share.js";
import {
  getHome,
  getPlace,
  getState,
  getWork,
  listFavorites,
  listHistory,
  pushHistory,
  setTrip,
  toggleFavorite,
  upsertPlace,
} from "../store.js";
import { openSheet, pinSvg, toast } from "../ui/components.js";
import { createMap } from "../ui/map.js";
import {
  adviceBanners,
  countdownBlock,
  legsList,
  liveArrivals,
  optionCard,
  planNotes,
  tickCountdown,
} from "../ui/parts.js";
import { delegate, escapeHtml, fmtDistance, nextOccurrence } from "../util.js";

let cachedOrigin = null;

async function currentOrigin() {
  if (cachedOrigin) return cachedOrigin;
  const coord = await getCurrentPosition();
  const geo = await reverseGeocode(coord);
  cachedOrigin = { id: null, name: "현재 위치", address: geo.address, ...coord, icon: "📍" };
  return cachedOrigin;
}

function placeRow(place, { action = "select" } = {}) {
  return `
    <button class="place" data-${action}="${escapeHtml(place.id)}">
      <span class="place__mark">${place.icon || "📍"}</span>
      <span class="grow" style="text-align:left">
        <span class="place__name">${escapeHtml(place.name)}</span>
        <span class="place__addr truncate" style="display:block">${escapeHtml(place.address || "")}</span>
      </span>
      ${place.distance ? `<span class="muted" style="font-size:12px;font-weight:700">${fmtDistance(place.distance)}</span>` : ""}
    </button>`;
}

/* ---------- 검색 화면 ---------- */

function searchScreen(root, ctx) {
  const favorites = listFavorites();
  const history = listHistory();

  root.innerHTML = `
    <div class="row" style="gap:8px">
      <input class="input grow" id="q" type="search" placeholder="목적지를 검색하세요 (예: 강남역)"
             autocomplete="off" enterkeyhint="search" />
    </div>
    <button class="btn btn--ghost btn--block" data-act="pin" style="margin-top:8px">🗺️ 지도에서 핀으로 지정</button>

    <div id="results" style="margin-top:16px"></div>

    <div id="shortcuts">
      ${
        favorites.length
          ? `<p class="section-title" style="margin-top:20px">⭐ 즐겨찾기</p>
             <div class="card" style="padding:4px 12px">${favorites.map((p) => placeRow(p)).join("")}</div>`
          : ""
      }
      ${
        history.length
          ? `<p class="section-title" style="margin-top:20px">최근 검색</p>
             <div class="card" style="padding:4px 12px">${history.map((p) => placeRow(p)).join("")}</div>`
          : ""
      }
      ${
        !favorites.length && !history.length
          ? `<p class="empty">검색하거나 지도에서 핀을 찍어<br />목적지를 지정해 보세요.</p>`
          : ""
      }
    </div>`;

  const input = root.querySelector("#q");
  const results = root.querySelector("#results");
  const shortcuts = root.querySelector("#shortcuts");
  let timer = null;
  let hits = [];

  async function runSearch(keyword) {
    if (!keyword.trim()) {
      results.innerHTML = "";
      shortcuts.hidden = false;
      return;
    }
    shortcuts.hidden = true;
    results.innerHTML = `<div class="card"><div class="skeleton" style="height:56px"></div></div>`;
    const near = await currentOrigin();
    hits = await searchPlaces(keyword, { near });
    results.innerHTML = hits.length
      ? `<div class="card" style="padding:4px 12px">${hits.map((p) => placeRow(p, { action: "hit" })).join("")}</div>`
      : `<p class="empty">검색 결과가 없어요.<br />다른 키워드로 시도해 보세요.</p>`;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), 250);
  });
  input.focus({ preventScroll: true });

  function choose(place) {
    const saved = upsertPlace(place);
    pushHistory(saved.id);
    setTrip({ destinationId: saved.id });
    ctx.refresh?.();
  }

  delegate(root, "click", "[data-hit]", (_e, el) => {
    const place = hits.find((p) => p.id === el.dataset.hit);
    if (place) choose(place);
  });

  delegate(root, "click", "[data-select]", (_e, el) => {
    const place = getPlace(el.dataset.select);
    if (place) choose(place);
  });

  delegate(root, "click", '[data-act="pin"]', async () => {
    const start = await currentOrigin();
    openPinPicker(start, choose);
  });

  return () => clearTimeout(timer);
}

/** 지도 핀 드래그로 목적지를 지정하는 바텀시트 */
function openPinPicker(start, onPick) {
  let map = null;
  let coord = { lat: start.lat, lng: start.lng };
  let label = { name: "지도에서 선택한 위치", address: "" };
  let geoTimer = null;

  openSheet({
    title: "지도에서 목적지 지정",
    body: `
      <div class="map" id="pick-map" style="height:280px">
        <div class="map__pin">${pinSvg()}</div>
        <span class="map__hint">지도를 끌어 핀을 맞추세요</span>
      </div>
      <div class="card" style="margin-top:12px">
        <p style="font-size:15px;font-weight:800" id="pick-name">위치 확인 중…</p>
        <p class="muted" style="font-size:12.5px;font-weight:600;margin-top:3px" id="pick-addr"></p>
      </div>
      <button class="btn btn--primary btn--block" style="margin-top:12px" id="pick-ok">이 위치로 목적지 설정</button>`,
    onMount(el, close) {
      const container = el.querySelector("#pick-map");
      const nameEl = el.querySelector("#pick-name");
      const addrEl = el.querySelector("#pick-addr");

      async function refreshLabel(next) {
        const geo = await reverseGeocode(next);
        label = geo;
        nameEl.textContent = geo.name;
        addrEl.textContent = geo.address;
      }

      map = createMap(container, {
        center: coord,
        metersPerPixel: 1.8,
        onChange(next) {
          coord = next;
          nameEl.textContent = "위치 확인 중…";
          addrEl.textContent = `${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`;
          clearTimeout(geoTimer);
          geoTimer = setTimeout(() => refreshLabel(next), 220);
        },
      });
      refreshLabel(coord);

      el.querySelector("#pick-ok").addEventListener("click", () => {
        close();
        onPick({
          name: label.name || "선택한 위치",
          address: label.address || `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`,
          icon: label.icon || "📍",
          lat: coord.lat,
          lng: coord.lng,
        });
      });
    },
    onClose() {
      clearTimeout(geoTimer);
      map?.destroy();
    },
  });
}

/* ---------- 결과 화면 ---------- */

async function resultScreen(root, ctx, destination) {
  const view = { plans: [], selectedId: null, weather: null, destWeather: null, origin: null, map: null };
  let disposed = false;

  root.innerHTML = `<div class="card"><div class="skeleton" style="height:220px"></div></div>`;

  async function load() {
    const s = getState();
    const now = new Date();
    const origin = s.trip.originId ? getPlace(s.trip.originId) : await currentOrigin();
    const arriveBy = s.trip.arriveBy ? nextOccurrence(s.trip.arriveBy, now) : null;

    const [plans, weather, destWeather] = await Promise.all([
      planTrip({
        origin,
        destination,
        arriveBy,
        now,
        bufferMin: s.settings.bufferMin,
        walkPace: s.settings.walkPace,
        prefer: s.trip.mode,
      }),
      getWeather(origin, { now }),
      getWeather(destination, { now }),
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

    root.innerHTML = `
      <div class="card">
        <div class="row row--between">
          <div class="grow">
            <p style="font-size:17px;font-weight:800" class="truncate">${escapeHtml(destination.name)}</p>
            <p class="muted truncate" style="font-size:12.5px;font-weight:600;margin-top:2px">
              ${escapeHtml(destination.address || "")}
            </p>
          </div>
          <button class="place__act" data-act="fav" aria-label="즐겨찾기">${fav ? "⭐" : "☆"}</button>
          <button class="btn btn--sm btn--ghost" data-act="change">변경</button>
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
          <button class="seg__btn" data-mode="driving" aria-pressed="${s.trip.mode === "driving"}">🚗 자차</button>
        </div>
        <div class="row" style="gap:8px;margin-top:10px">
          <label class="field grow">
            <span class="field__label">도착 희망 시각</span>
            <input class="input" type="time" id="arriveBy" value="${escapeHtml(s.trip.arriveBy || "")}" />
          </label>
          <button class="btn btn--ghost" data-act="now" style="margin-top:22px">지금 출발</button>
        </div>
      </div>

      <div class="map" style="height:190px;margin-top:12px" id="route-map">
        <span class="map__hint">경로 미리보기</span>
      </div>

      ${plan ? `<div class="card" style="margin-top:12px">${countdownBlock(plan)}</div>` : ""}
      ${adviceBanners(buildAdvice(view.weather, view.destWeather, plan))}

      <p class="section-title" style="margin-top:20px">이동수단 비교</p>
      <div class="stack">
        ${view.plans.map((p) => optionCard(p, { selected: p.id === view.selectedId })).join("")}
      </div>

      ${plan ? `<div class="card" style="margin-top:12px">${legsList(plan)}${planNotes(plan)}</div>` : ""}
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
    const path = plan?.meta?.route?.path;
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

  delegate(root, "change", "#arriveBy", async (_e, el) => {
    setTrip({ arriveBy: el.value || null });
    await load();
    paint();
  });

  delegate(root, "click", "[data-act]", async (_e, el) => {
    const act = el.dataset.act;
    if (act === "change") {
      setTrip({ destinationId: null });
      ctx.refresh?.();
    } else if (act === "now") {
      setTrip({ arriveBy: null });
      await load();
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
        buildShareText({ plan, destination, tone: getState().trip.arriveBy ? "plan" : "now" }),
      );
      if (result === "copied") toast("공유 문구를 클립보드에 복사했어요");
      else if (result === "failed") toast("공유에 실패했어요");
    }
  });

  const ticker = setInterval(() => {
    if (!disposed) tickCountdown(root, selected());
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
    view.map?.destroy();
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
