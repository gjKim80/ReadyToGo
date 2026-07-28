/** 설정 — 출퇴근 경로, 개인 여유시간, 알림, 데이터 관리, API 연동 상태 */

import { config, isMock } from "../api/config.js";
import { canNotify, clearAlerts, requestPermission } from "../core/notify.js";
import {
  getHome,
  getState,
  getWork,
  listPlaces,
  resetAll,
  setCommute,
  setSettings,
  setState,
} from "../store.js";
import { confirmSheet, openSheet, toast } from "../ui/components.js";
import { delegate, escapeHtml } from "../util.js";

const PACE = [
  { value: 0.8, label: "느긋하게" },
  { value: 1, label: "보통" },
  { value: 1.2, label: "빠르게" },
];

function pickerRows(selectedId) {
  return listPlaces()
    .map(
      (p) => `
      <button class="place" data-pick="${escapeHtml(p.id)}">
        <span class="place__mark">${p.icon || "📍"}</span>
        <span class="grow" style="text-align:left">
          <span class="place__name">${escapeHtml(p.name)}</span>
          <span class="place__addr truncate" style="display:block">${escapeHtml(p.address || "")}</span>
        </span>
        ${p.id === selectedId ? "<span>✓</span>" : ""}
      </button>`,
    )
    .join("");
}

export async function render(root, ctx = {}) {
  function paint() {
    const s = getState();
    const home = getHome();
    const work = getWork();

    root.innerHTML = `
      <p class="section-title">출퇴근 경로 (평일 모드)</p>
      <div class="card stack">
        <button class="row row--between" data-slot="home" style="width:100%">
          <span style="font-size:14.5px;font-weight:700">🏠 집</span>
          <span class="muted truncate" style="font-size:13.5px;font-weight:600;max-width:60%">
            ${escapeHtml(home ? home.name : "설정 안 됨")}
          </span>
        </button>
        <button class="row row--between" data-slot="work" style="width:100%">
          <span style="font-size:14.5px;font-weight:700">🏢 회사</span>
          <span class="muted truncate" style="font-size:13.5px;font-weight:600;max-width:60%">
            ${escapeHtml(work ? work.name : "설정 안 됨")}
          </span>
        </button>
        <label class="field">
          <span class="field__label">출근 · 회사 도착 희망 시각</span>
          <input class="input" type="time" data-commute="arriveAt" value="${escapeHtml(s.commute.arriveAt)}" />
        </label>
        <label class="field">
          <span class="field__label">퇴근 · 회사에서 나서는 시각</span>
          <input class="input" type="time" data-commute="leaveAt" value="${escapeHtml(s.commute.leaveAt)}" />
        </label>
      </div>

      <p class="section-title" style="margin-top:20px">출발 계산</p>
      <div class="card stack">
        <label class="field">
          <span class="field__label">개인 여유시간 · ${s.settings.bufferMin}분</span>
          <input type="range" min="0" max="20" step="1" value="${s.settings.bufferMin}"
                 data-set="bufferMin" style="width:100%" />
          <span class="muted" style="font-size:12px;font-weight:600">
            정류장에 미리 도착해 있을 시간. 값이 클수록 더 일찍 나서라고 안내합니다.
          </span>
        </label>

        <div>
          <span class="field__label">도보 속도</span>
          <div class="seg">
            ${PACE.map(
              (p) =>
                `<button class="seg__btn" data-pace="${p.value}" aria-pressed="${s.settings.walkPace === p.value}">${p.label}</button>`,
            ).join("")}
          </div>
        </div>

        <div>
          <span class="field__label">기본 이동수단</span>
          <div class="seg">
            <button class="seg__btn" data-prefer="transit" aria-pressed="${s.settings.preferredMode === "transit"}">🚇 대중교통</button>
            <button class="seg__btn" data-prefer="driving" aria-pressed="${s.settings.preferredMode === "driving"}">🚗 자차</button>
          </div>
        </div>
      </div>

      <p class="section-title" style="margin-top:20px">알림</p>
      <div class="card">
        <div class="row row--between">
          <div class="grow">
            <p style="font-size:14.5px;font-weight:700">출발 알림</p>
            <p class="muted" style="font-size:12px;font-weight:600;margin-top:3px;line-height:1.5">
              출발 10분 전과 출발 시각에 알립니다.${canNotify() ? "" : " (이 브라우저는 지원하지 않아요)"}
            </p>
          </div>
          <label class="switch">
            <input type="checkbox" data-set="notify" ${s.settings.notify ? "checked" : ""} ${canNotify() ? "" : "disabled"} />
            <span class="switch__track"></span>
          </label>
        </div>
        <p class="muted" style="font-size:11.5px;font-weight:600;line-height:1.6;margin-top:10px">
          앱(탭)이 열려 있는 동안 동작합니다. 완전한 백그라운드 알림은 Web Push 서버 연동이 필요합니다.
        </p>
      </div>

      <p class="section-title" style="margin-top:20px">데이터 연동</p>
      <div class="card">
        <div class="row row--between">
          <span style="font-size:14.5px;font-weight:700">API 모드</span>
          <span class="badge ${isMock() ? "badge--warn" : "badge--ok"}">${isMock() ? "목 데이터" : "실 API"}</span>
        </div>
        <p class="muted" style="font-size:12px;font-weight:600;line-height:1.6;margin-top:10px">
          ${
            isMock()
              ? `기상청·공공데이터포털·NAVER API 키가 없어 결정론적 샘플 데이터로 동작 중입니다.
                 <code>src/js/api/config.js</code>의 <code>proxyBase</code>에 서버 프록시 주소를 넣으면
                 실시간 데이터로 전환됩니다.`
              : `프록시: <code>${escapeHtml(config.proxyBase)}</code>`
          }
        </p>
        <label class="field" style="margin-top:12px">
          <span class="field__label">자동 새로고침 주기 · ${s.settings.autoRefreshSec}초</span>
          <input type="range" min="20" max="300" step="10" value="${s.settings.autoRefreshSec}"
                 data-set="autoRefreshSec" style="width:100%" />
        </label>
      </div>

      <p class="section-title" style="margin-top:20px">앱</p>
      <div class="card stack">
        <button class="btn btn--ghost btn--block" data-act="install">홈 화면에 추가하는 방법</button>
        <button class="btn btn--ghost btn--block" data-act="reset" style="color:var(--c-danger)">
          모든 데이터 초기화
        </button>
      </div>
      <p class="muted" style="font-size:11.5px;font-weight:600;text-align:center;margin-top:16px">
        ReadyToGo · 저장 데이터는 이 브라우저에만 보관됩니다
      </p>`;
  }

  paint();

  /* ---------- 이벤트 ---------- */

  delegate(root, "click", "[data-slot]", (_e, el) => {
    const slot = el.dataset.slot;
    const s = getState();
    openSheet({
      title: slot === "home" ? "집으로 지정할 장소" : "회사로 지정할 장소",
      body: `<div class="card" style="padding:4px 12px">${pickerRows(slot === "home" ? s.homeId : s.workId)}</div>
             <a class="btn btn--primary btn--block" style="margin-top:12px" href="#/route">새 장소 검색하기</a>`,
      onMount(body, close) {
        body.addEventListener("click", (event) => {
          const id = event.target.closest("[data-pick]")?.dataset.pick;
          if (!id) return;
          setState(slot === "home" ? { homeId: id } : { workId: id });
          close();
          paint();
          toast("변경했어요");
        });
      },
    });
  });

  delegate(root, "change", "[data-commute]", (_e, el) => {
    if (!el.value) return;
    setCommute({ [el.dataset.commute]: el.value });
    toast("출퇴근 시각을 저장했어요");
  });

  delegate(root, "input", '[data-set="bufferMin"]', (_e, el) => {
    setSettings({ bufferMin: Number(el.value) });
    el.closest(".field").querySelector(".field__label").textContent = `개인 여유시간 · ${el.value}분`;
  });

  delegate(root, "input", '[data-set="autoRefreshSec"]', (_e, el) => {
    setSettings({ autoRefreshSec: Number(el.value) });
    el.closest(".field").querySelector(".field__label").textContent = `자동 새로고침 주기 · ${el.value}초`;
  });

  delegate(root, "change", '[data-set="notify"]', async (_e, el) => {
    if (!el.checked) {
      setSettings({ notify: false });
      clearAlerts();
      return;
    }
    const permission = await requestPermission();
    if (permission === "granted") {
      setSettings({ notify: true });
      toast("출발 알림을 켰어요");
    } else {
      el.checked = false;
      setSettings({ notify: false });
      toast("브라우저에서 알림이 차단되어 있어요");
    }
  });

  delegate(root, "click", "[data-pace]", (_e, el) => {
    setSettings({ walkPace: Number(el.dataset.pace) });
    paint();
  });

  delegate(root, "click", "[data-prefer]", (_e, el) => {
    setSettings({ preferredMode: el.dataset.prefer });
    paint();
  });

  delegate(root, "click", '[data-act="install"]', () => {
    openSheet({
      title: "홈 화면에 추가",
      body: `
        <ul class="stack" style="font-size:14px;font-weight:600;line-height:1.6;color:var(--c-ink-2)">
          <li><b>iOS Safari</b><br />공유 버튼 → &lsquo;홈 화면에 추가&rsquo;</li>
          <li><b>Android Chrome</b><br />⋮ 메뉴 → &lsquo;홈 화면에 추가&rsquo; / &lsquo;앱 설치&rsquo;</li>
          <li><b>데스크톱 Chrome/Edge</b><br />주소창 오른쪽 설치 아이콘 클릭</li>
        </ul>
        <p class="muted" style="font-size:12px;font-weight:600;line-height:1.6;margin-top:14px">
          설치하면 전체화면으로 실행되고, 홈 화면 아이콘에서 바로 카운트다운을 확인할 수 있습니다.
        </p>`,
    });
  });

  delegate(root, "click", '[data-act="reset"]', async () => {
    const ok = await confirmSheet({
      title: "모든 데이터 초기화",
      message: "저장된 장소, 즐겨찾기, 설정이 모두 삭제됩니다. 되돌릴 수 없어요.",
      confirmLabel: "초기화",
      danger: true,
    });
    if (!ok) return;
    resetAll();
    toast("초기화했어요");
    ctx.refresh?.();
  });

  return () => {};
}
