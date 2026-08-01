/** 설정 — 출퇴근 경로, 개인 여유시간, 알림, 데이터 관리 */

import { canNotify, clearAlerts, requestPermission } from "../core/notify.js";
import { shareText } from "../core/share.js";
import {
  exportBackup,
  getHome,
  getState,
  getWork,
  importBackup,
  listPlaces,
  resetAll,
  setCommute,
  setSettings,
  setState,
} from "../store.js";
import { confirmSheet, openSheet, toast } from "../ui/components.js";
import { APP_VERSION } from "../version.js";
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
        ${p.id === selectedId ? `<span class="icon icon--check" aria-hidden="true"></span>` : ""}
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
          <span style="font-size:14.5px;font-weight:700"><span class="icon icon--home" aria-hidden="true"></span> 집</span>
          <span class="muted truncate" style="font-size:13.5px;font-weight:600;max-width:60%">
            ${escapeHtml(home ? home.name : "설정 안 됨")}
          </span>
        </button>
        <button class="row row--between" data-slot="work" style="width:100%">
          <span style="font-size:14.5px;font-weight:700"><span class="icon icon--work" aria-hidden="true"></span> 회사</span>
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
            <button class="seg__btn" data-prefer="transit" aria-pressed="${s.settings.preferredMode === "transit"}"><span class="icon icon--subway" aria-hidden="true"></span> 대중교통</button>
            <button class="seg__btn" data-prefer="driving" aria-pressed="${s.settings.preferredMode === "driving"}"><span class="icon icon--car" aria-hidden="true"></span> 마이카</button>
          </div>
        </div>

        <label class="field">
          <span class="field__label">자동 새로고침 주기 · ${s.settings.autoRefreshSec}초</span>
          <input type="range" min="20" max="300" step="10" value="${s.settings.autoRefreshSec}"
                 data-set="autoRefreshSec" style="width:100%" />
          <span class="muted" style="font-size:12px;font-weight:600">
            홈 화면이 열려 있는 동안 경로·날씨를 다시 불러오는 주기입니다.
          </span>
        </label>
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

      <p class="section-title" style="margin-top:20px">다른 기기와 동기화</p>
      <div class="card stack">
        <p class="muted" style="font-size:12px;font-weight:600;line-height:1.6">
          계정 서버 없이, 저장된 장소·출퇴근 설정을 코드로 내보내고 다른 기기에서 붙여넣어 그대로 가져올 수 있어요.
        </p>
        <button class="btn btn--ghost btn--block" data-act="export">다른 기기로 내보내기</button>
        <button class="btn btn--ghost btn--block" data-act="import">다른 기기에서 가져오기</button>
      </div>

      <p class="section-title" style="margin-top:20px">앱</p>
      <div class="card stack">
        <button class="btn btn--ghost btn--block" data-act="update">최신 버전으로 업데이트</button>
        <button class="btn btn--ghost btn--block" data-act="install">홈 화면에 추가하는 방법</button>
        <button class="btn btn--ghost btn--block" data-act="reset" style="color:var(--c-danger)">
          모든 데이터 초기화
        </button>
      </div>
      <p class="app-footer">
        ReadyToGo v${escapeHtml(APP_VERSION)} · 저장 데이터는 이 브라우저에만 보관됩니다
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

  delegate(root, "click", '[data-act="export"]', () => {
    const code = exportBackup();
    openSheet({
      title: "다른 기기로 내보내기",
      body: `
        <p class="muted" style="font-size:12.5px;font-weight:600;line-height:1.6;margin-bottom:10px">
          아래 코드를 복사하거나 공유해서 다른 기기의 &lsquo;가져오기&rsquo;에 붙여넣으세요.
          저장된 장소와 출퇴근 설정이 그대로 전달됩니다.
        </p>
        <textarea class="input" readonly rows="6"
          style="height:auto;font-size:11px;font-family:var(--font-mono);resize:none" id="export-code"
        >${escapeHtml(code)}</textarea>
        <button class="btn btn--primary btn--block" style="margin-top:12px" data-act="copy-export">복사 · 공유하기</button>`,
      onMount(body) {
        body.querySelector('[data-act="copy-export"]').addEventListener("click", async () => {
          const result = await shareText(code, "ReadyToGo 설정 코드");
          if (result === "copied") toast("코드를 복사했어요");
          else if (result === "shared") toast("공유했어요");
          else if (result === "failed") toast("복사에 실패했어요");
        });
      },
    });
  });

  delegate(root, "click", '[data-act="import"]', () => {
    openSheet({
      title: "다른 기기에서 가져오기",
      body: `
        <p class="muted" style="font-size:12.5px;font-weight:600;line-height:1.6;margin-bottom:10px">
          다른 기기의 &lsquo;내보내기&rsquo;에서 받은 코드를 붙여넣으세요.
          <b style="color:var(--c-danger)">이 기기의 저장된 장소와 설정을 덮어씁니다.</b>
        </p>
        <textarea class="input" rows="6"
          style="height:auto;font-size:11px;font-family:var(--font-mono);resize:none" id="import-code"
          placeholder="RTG1:..."></textarea>
        <button class="btn btn--primary btn--block" style="margin-top:12px" data-act="apply-import">적용하기</button>`,
      onMount(body, close) {
        body.querySelector('[data-act="apply-import"]').addEventListener("click", () => {
          const code = body.querySelector("#import-code").value;
          try {
            importBackup(code);
            close();
            toast("설정을 가져왔어요");
            ctx.refresh?.();
          } catch (err) {
            toast(err.message || "올바른 코드가 아니에요");
          }
        });
      },
    });
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

  delegate(root, "click", '[data-act="update"]', async () => {
    toast("최신 버전으로 업데이트 중…");
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await window.caches?.keys?.()) || [];
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    } catch {
      /* 서비스워커/캐시 API가 없는 환경(사생활 모드 등) — 새로고침만 진행해도 무방 */
    }
    // 캐시된 index.html까지 확실히 건너뛰도록 쿼리를 붙여 새로고침한다
    location.href = `${location.pathname}?u=${Date.now()}${location.hash}`;
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
