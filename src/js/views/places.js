/** 장소 — 즐겨찾기(상단 고정) / 최근 방문 히스토리 관리 */

import {
  clearHistory,
  getHome,
  getState,
  getPlace,
  getWork,
  listFavorites,
  listHistory,
  listPlaces,
  pushHistory,
  removePlace,
  setState,
  setTrip,
  toggleFavorite,
  upsertPlace,
} from "../store.js";
import { confirmSheet, openSheet, toast } from "../ui/components.js";
import { mountPlacePicker } from "../ui/placePicker.js";
import { delegate, escapeHtml } from "../util.js";

function row(place, { home, work }) {
  const rawTag = place.id === home ? "집" : place.id === work ? "회사" : null;
  // 이름 자체가 이미 "집"/"회사"면 중복 배지를 굳이 붙이지 않는다
  const tag = rawTag && place.name !== rawTag ? rawTag : null;
  return `
    <li class="place">
      <button class="place__act" data-fav="${escapeHtml(place.id)}" aria-label="즐겨찾기 전환">
        ${place.favorite ? "⭐" : "☆"}
      </button>
      <button class="grow row" data-go="${escapeHtml(place.id)}" style="text-align:left;gap:10px">
        <span class="place__mark">${place.icon || "📍"}</span>
        <span class="grow" style="min-width:0">
          <span class="place__name">
            ${escapeHtml(place.name)}
            ${tag ? `<span class="badge" style="margin-left:6px">${tag}</span>` : ""}
          </span>
          <span class="place__addr truncate" style="display:block">${escapeHtml(place.address || "")}</span>
        </span>
      </button>
      <button class="place__act" data-menu="${escapeHtml(place.id)}" aria-label="더보기">⋯</button>
    </li>`;
}

/** 집/회사는 목록 맨 위에 항상 고정 — 지정 안 됐으면 그 자리에서 바로 검색해서 지정한다 */
function pinnedRow(slot, icon, label, place) {
  if (place) {
    return `
      <button class="route-row" data-pinned-change="${slot}" aria-pressed="true">
        <span class="route-row__bar" aria-hidden="true"></span>
        <span class="route-row__body grow" style="min-width:0">
          <span class="route-row__sub truncate">${icon} ${label}</span>
          <span class="route-row__title truncate">${escapeHtml(place.name)}</span>
        </span>
        <span class="link-btn" style="flex:none;align-self:center">변경</span>
      </button>`;
  }
  return `
    <button class="route-row" data-pinned-change="${slot}" aria-pressed="false">
      <span class="route-row__bar" aria-hidden="true"></span>
      <span class="route-row__body grow" style="min-width:0">
        <span class="route-row__sub">${icon} ${label}</span>
        <span class="route-row__title" style="color:var(--c-ink-3)">설정 안 됨</span>
      </span>
      <span class="link-btn" style="flex:none;align-self:center">설정</span>
    </button>`;
}

export async function render(root) {
  let pickerSlot = null; // null | "home" | "work"
  let addOpen = false;
  let pickerDispose = null;

  function paint() {
    const s = getState();
    const pinnedIds = new Set([s.homeId, s.workId].filter(Boolean));
    const favorites = listFavorites().filter((p) => !pinnedIds.has(p.id));
    const history = listHistory().filter((p) => !p.favorite && !pinnedIds.has(p.id));
    const shown = new Set([...favorites.map((p) => p.id), ...history.map((p) => p.id), ...pinnedIds]);
    const others = listPlaces().filter((p) => !shown.has(p.id));
    const meta = { home: s.homeId, work: s.workId };

    const pinnedSection = pickerSlot
      ? `
        <div class="row row--between" style="margin-bottom:8px">
          <p class="section-title" style="margin:0">${pickerSlot === "home" ? "집" : "회사"} 설정</p>
          <button class="btn btn--sm btn--ghost" data-act="cancel-pin">취소</button>
        </div>
        <div id="pinned-picker-slot"></div>`
      : `
        <p class="section-title">집 · 회사</p>
        <div class="route-row-list">
          ${pinnedRow("home", "🏠", "집", getHome())}
          ${pinnedRow("work", "🏢", "회사", getWork())}
        </div>`;

    const addSection = addOpen
      ? `
        <div class="row row--between" style="margin-bottom:8px">
          <p class="section-title" style="margin:0">장소 추가</p>
          <button class="btn btn--sm btn--ghost" data-act="cancel-add">취소</button>
        </div>
        <div id="add-picker-slot" style="margin-bottom:20px"></div>`
      : "";

    root.innerHTML = `
      <div class="row row--between" style="margin-bottom:12px">
        <p class="section-title" style="margin:0">저장한 장소</p>
        ${addOpen ? "" : `<button class="btn btn--sm btn--primary" data-act="add-place">+ 장소 추가</button>`}
      </div>

      ${addSection}

      ${pinnedSection}

      <p class="section-title" style="margin-top:20px">⭐ 즐겨찾기</p>
      <div class="card" style="padding:4px 12px">
        ${favorites.length ? `<ul>${favorites.map((p) => row(p, meta)).join("")}</ul>` : `<p class="empty">즐겨찾기한 장소가 없어요.<br />별표를 눌러 상단에 고정하세요.</p>`}
      </div>

      <div class="row row--between" style="margin:20px 0 8px">
        <p class="section-title" style="margin:0">최근 방문</p>
        ${history.length ? `<button class="btn btn--sm btn--ghost" data-act="clear">기록 삭제</button>` : ""}
      </div>
      <div class="card" style="padding:4px 12px">
        ${history.length ? `<ul>${history.map((p) => row(p, meta)).join("")}</ul>` : `<p class="empty">최근 방문한 장소가 없어요.</p>`}
      </div>

      ${
        others.length
          ? `<p class="section-title" style="margin-top:20px">그 외 저장된 장소</p>
             <div class="card" style="padding:4px 12px"><ul>${others.map((p) => row(p, meta)).join("")}</ul></div>`
          : ""
      }`;

    if (addOpen) {
      pickerDispose?.();
      pickerDispose = mountPlacePicker(root.querySelector("#add-picker-slot"), {
        onSelect(place) {
          const saved = upsertPlace(place);
          pickerDispose?.();
          pickerDispose = null;
          addOpen = false;
          paint();
          toast(`${saved.name}을(를) 추가했어요`);
        },
      });
    } else if (pickerSlot) {
      const slot = pickerSlot;
      pickerDispose?.();
      pickerDispose = mountPlacePicker(root.querySelector("#pinned-picker-slot"), {
        onSelect(place) {
          const saved = upsertPlace(place);
          if (!saved.favorite) toggleFavorite(saved.id);
          setState(slot === "home" ? { homeId: saved.id } : { workId: saved.id });
          pickerDispose?.();
          pickerDispose = null;
          pickerSlot = null;
          paint();
          toast(`${slot === "home" ? "집" : "회사"}으로 지정했어요`);
        },
      });
    }
  }

  paint();

  delegate(root, "click", '[data-act="add-place"]', () => {
    addOpen = true;
    paint();
  });

  delegate(root, "click", '[data-act="cancel-add"]', () => {
    addOpen = false;
    paint();
  });

  delegate(root, "click", "[data-pinned-change]", (_e, el) => {
    pickerSlot = el.dataset.pinnedChange;
    paint();
  });

  delegate(root, "click", '[data-act="cancel-pin"]', () => {
    pickerSlot = null;
    paint();
  });

  delegate(root, "click", "[data-fav]", (_e, el) => {
    toggleFavorite(el.dataset.fav);
    paint();
  });

  delegate(root, "click", "[data-go]", (_e, el) => {
    pushHistory(el.dataset.go);
    setTrip({ destinationId: el.dataset.go });
    location.hash = "#/route";
  });

  delegate(root, "click", '[data-act="clear"]', async () => {
    if (await confirmSheet({ title: "최근 기록 삭제", message: "최근 방문 기록을 모두 지울까요? 즐겨찾기는 유지됩니다.", confirmLabel: "삭제", danger: true })) {
      clearHistory();
      paint();
      toast("최근 기록을 삭제했어요");
    }
  });

  delegate(root, "click", "[data-menu]", (_e, el) => {
    const place = getPlace(el.dataset.menu);
    if (!place) return;

    openSheet({
      title: place.name,
      body: `
        <div class="stack">
          <button class="btn btn--primary btn--block" data-m="go">이 장소로 경로 보기</button>
          <button class="btn btn--ghost btn--block" data-m="home">🏠 집으로 지정</button>
          <button class="btn btn--ghost btn--block" data-m="work">🏢 회사로 지정</button>
          <button class="btn btn--ghost btn--block" data-m="del" style="color:var(--c-danger)">삭제</button>
        </div>`,
      onMount(body, close) {
        body.addEventListener("click", async (event) => {
          const action = event.target.closest("[data-m]")?.dataset.m;
          if (!action) return;
          close();

          if (action === "go") {
            pushHistory(place.id);
            setTrip({ destinationId: place.id });
            location.hash = "#/route";
          } else if (action === "home") {
            setState({ homeId: place.id });
            toast(`${place.name}을(를) 집으로 지정했어요`);
            paint();
          } else if (action === "work") {
            setState({ workId: place.id });
            toast(`${place.name}을(를) 회사로 지정했어요`);
            paint();
          } else if (action === "del") {
            const ok = await confirmSheet({
              title: "장소 삭제",
              message: `'${place.name}'을(를) 삭제할까요?`,
              confirmLabel: "삭제",
              danger: true,
            });
            if (ok) {
              removePlace(place.id);
              paint();
              toast("삭제했어요");
            }
          }
        });
      },
    });
  });

  return () => {
    pickerDispose?.();
  };
}
