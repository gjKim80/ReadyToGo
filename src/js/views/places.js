/** 장소 — 즐겨찾기(상단 고정) / 최근 방문 히스토리 관리 */

import {
  clearHistory,
  getState,
  getPlace,
  listFavorites,
  listHistory,
  listPlaces,
  pushHistory,
  removePlace,
  setState,
  setTrip,
  toggleFavorite,
} from "../store.js";
import { confirmSheet, openSheet, toast } from "../ui/components.js";
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

export async function render(root) {
  function paint() {
    const s = getState();
    const favorites = listFavorites();
    const history = listHistory().filter((p) => !p.favorite);
    const shown = new Set([...favorites, ...history].map((p) => p.id));
    const others = listPlaces().filter((p) => !shown.has(p.id));
    const meta = { home: s.homeId, work: s.workId };

    root.innerHTML = `
      <div class="row row--between" style="margin-bottom:12px">
        <p class="section-title" style="margin:0">저장한 장소</p>
        <a class="btn btn--sm btn--primary" href="#/route">+ 장소 추가</a>
      </div>

      <p class="section-title">⭐ 즐겨찾기</p>
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
  }

  paint();

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

  return () => {};
}
