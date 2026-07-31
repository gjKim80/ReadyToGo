/** 앱 부트스트랩 — 해시 라우터, 모드 전환, 뷰 생명주기 */

import { getState, setMode, setTrip, subscribe } from "./store.js";
import { applyIcons } from "./ui/icons.js";
import { $, $$ } from "./util.js";

const ROUTES = {
  "/home": () => import("./views/home.js"),
  "/route": () => import("./views/route.js"),
  "/places": () => import("./views/places.js"),
  "/settings": () => import("./views/settings.js"),
  "/onboarding": () => import("./views/onboarding.js"),
};

let cleanup = null;
let renderToken = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/home";
  const [path, qs] = raw.split("?");
  return {
    path: ROUTES[path] ? path : "/home",
    query: Object.fromEntries(new URLSearchParams(qs || "")),
  };
}

function syncChrome(path) {
  $$(".tabbar__item").forEach((el) => {
    const active = el.getAttribute("href") === `#${path}`;
    el.toggleAttribute("aria-current", active);
    if (active) el.setAttribute("aria-current", "page");
  });

  const state = getState();
  const mode = state.mode;
  $$(".mode-switch__btn[data-mode]").forEach((el) => {
    el.setAttribute("aria-selected", String(el.dataset.mode === mode));
  });

  // 로고의 "Ready"/"Go" 글자를 실제 진행 상태에 맞춰 물들인다
  const topbar = $(".topbar");
  if (topbar) topbar.dataset.trip = state.trip.active ? "go" : "ready";

  // 온보딩 중엔 상단바/하단 탭을 숨겨 마법사에만 집중하게 한다
  document.body.classList.toggle("onboarding-active", path === "/onboarding");
}

/** 뷰 컨테이너를 새 요소로 교체해 이전 화면의 이벤트 리스너를 함께 폐기한다. */
function freshViewRoot() {
  const old = $("#view");
  const next = document.createElement("main");
  next.id = "view";
  next.className = "view";
  next.tabIndex = -1;
  old.replaceWith(next);
  return next;
}

async function renderRoute() {
  const token = ++renderToken;
  let { path, query } = parseHash();

  // 집/회사가 아직 없으면(최초 실행, 혹은 둘 다 지운 경우) 온보딩부터 보여준다
  const needsOnboarding = !getState().homeId && !getState().workId;
  if (needsOnboarding && path !== "/onboarding") {
    path = "/onboarding";
    history.replaceState(null, "", "#/onboarding");
  }

  cleanup?.();
  cleanup = null;

  const root = freshViewRoot();
  syncChrome(path);

  const module = await ROUTES[path]();
  if (token !== renderToken) return; // 렌더 중 라우트가 또 바뀐 경우 폐기

  const dispose = await module.render(root, { query, refresh: renderRoute });
  if (token !== renderToken) {
    dispose?.();
    return;
  }
  cleanup = dispose;
  window.scrollTo({ top: 0 });
}

function bindChrome() {
  $$(".mode-switch__btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (getState().mode === btn.dataset.mode) return;
      setMode(btn.dataset.mode);
      // 다른 모드에서 "진행중"이던 상태가 그대로 넘어와 Ready 없이 바로 카운트다운으로
      // 점프하지 않도록, 모드를 바꾸면 항상 설정 화면부터 다시 보여준다
      setTrip({ active: false });
      syncChrome(parseHash().path);
      renderRoute();
    });
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!["http:", "https:"].includes(location.protocol)) return; // file:// 에서는 미등록
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("[sw] 등록 실패", err);
    });
  });
}

function boot() {
  applyIcons(document);
  bindChrome();

  // 온보딩을 마치기 전까지는(집/회사 미설정) 요일에 맞는 모드를 매번 자동 선택해둔다 —
  // onboarded는 온보딩 마법사가 끝날 때 store.js에서 직접 true로 바뀐다
  if (!getState().onboarded) {
    setMode([0, 6].includes(new Date().getDay()) ? "weekend" : "weekday");
  }

  window.addEventListener("hashchange", renderRoute);
  subscribe(() => syncChrome(parseHash().path));

  if (!location.hash) history.replaceState(null, "", "#/home");
  renderRoute();
  registerServiceWorker();
}

boot();
