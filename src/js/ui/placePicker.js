/**
 * 검색 + 즐겨찾기/최근 방문 + 지도 핀 지정을 한 컨테이너에 마운트하는 공용 장소 선택 UI.
 *
 * route.js의 목적지 검색과 home.js의 주말 모드 설정 화면이 이 모듈을 함께 쓴다 — 예전엔
 * route.js에만 있어서, 다른 화면에서 장소를 바꾸려면 "변경" 버튼으로 전체 화면을 다시
 * 띄워야 했다. 이제는 컨테이너 하나만 있으면 그 자리에서 즉시 검색이 뜬다.
 */

import { getCurrentPosition, reverseGeocode, searchPlaces } from "../api/places.js";
import { listFavorites, listHistory, pushHistory, upsertPlace, getPlace } from "../store.js";
import { openSheet, pinSvg } from "./components.js";
import { createMap } from "./map.js";
import { delegate, escapeHtml, fmtDistance } from "../util.js";

let cachedOrigin = null;

/** 현재 위치(세션 캐시) — 검색 거리순 정렬과 핀 피커 시작 위치에 쓴다 */
export async function currentOrigin() {
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

/**
 * container 안에 검색 UI 전체를 그리고 이벤트를 연결한다.
 * @param {HTMLElement} container
 * @param {{ onSelect: (place: object) => void, autofocus?: boolean, title?: string, placeholder?: string }} opts
 * @returns {() => void} dispose — 컨테이너를 다른 내용으로 교체하기 전에 호출
 */
export function mountPlacePicker(container, { onSelect, autofocus = true, title = "", placeholder = "목적지를 검색하세요 (예: 강남역)" } = {}) {
  const favorites = listFavorites();
  const history = listHistory();

  container.innerHTML = `
    ${title ? `<p class="section-title" style="margin-top:0">${escapeHtml(title)}</p>` : ""}
    <div class="row" style="gap:8px">
      <input class="input grow" id="q" type="search" placeholder="${escapeHtml(placeholder)}"
             autocomplete="off" enterkeyhint="search" />
    </div>
    <button class="btn btn--ghost btn--block" data-act="pin" style="margin-top:8px"><span class="icon icon--pin" aria-hidden="true"></span> 지도에서 핀으로 지정</button>

    <div id="results" style="margin-top:16px"></div>

    <div id="shortcuts">
      ${
        favorites.length
          ? `<p class="section-title" style="margin-top:20px"><span class="icon icon--star-filled" aria-hidden="true"></span> 즐겨찾기</p>
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

  const input = container.querySelector("#q");
  const results = container.querySelector("#results");
  const shortcuts = container.querySelector("#shortcuts");
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
  if (autofocus) input.focus({ preventScroll: true });

  function choose(place) {
    const saved = upsertPlace(place);
    pushHistory(saved.id);
    onSelect(saved);
  }

  delegate(container, "click", "[data-hit]", (_e, el) => {
    const place = hits.find((p) => p.id === el.dataset.hit);
    if (place) choose(place);
  });

  delegate(container, "click", "[data-select]", (_e, el) => {
    const place = getPlace(el.dataset.select);
    if (place) choose(place);
  });

  delegate(container, "click", '[data-act="pin"]', async () => {
    const start = await currentOrigin();
    openPinPicker(start, choose);
  });

  return () => clearTimeout(timer);
}
