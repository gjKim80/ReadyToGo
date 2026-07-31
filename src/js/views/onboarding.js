/**
 * 최초 실행 온보딩 — 집/회사 위치, 출퇴근 희망 시각, 여유시간, 도보 속도, 선호 이동수단을
 * 한 번에 받는다. 예전에는 "장소" 탭에서 장소를 추가한 뒤 다시 그 장소의 메뉴를 열어
 * 집/회사로 지정해야 했는데, 그 두 단계짜리 왕복을 없애기 위해 처음 한 번만 순서대로 받는다.
 */

import { importBackup, setCommute, setSettings, setState, toggleFavorite, upsertPlace } from "../store.js";
import { openSheet, toast } from "../ui/components.js";
import { mountPlacePicker } from "../ui/placePicker.js";
import { delegate, escapeHtml } from "../util.js";
import { APP_VERSION, buildTimeLabel } from "../version.js";

const BRAND_HTML = `
  <div class="onboard-brand">
    <span class="onboard-brand__logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round">
        <circle cx="12" cy="12" r="7" />
        <line x1="12" y1="12" x2="12" y2="6" />
        <line x1="12" y1="12" x2="16" y2="8" />
      </svg>
    </span>
    <span class="onboard-brand__title">ReadyToGo</span>
  </div>`;

const FOOTER_HTML = `
  <p class="app-footer">
    ReadyToGo v${escapeHtml(APP_VERSION)} (dev) · ${escapeHtml(buildTimeLabel())} Update
  </p>`;

const PACE = [
  { value: 0.8, label: "느긋하게" },
  { value: 1, label: "보통" },
  { value: 1.2, label: "빠르게" },
];

const STEPS = ["home", "work", "commute", "buffer", "pace", "mode"];

export async function render(root, ctx = {}) {
  let stepIndex = 0;
  let disposed = false;
  let pickerDispose = null;

  // 마지막 단계에서 한 번에 커밋한다 — 중간에 "이전"으로 왔다갔다 해도 저장은 끝에서만 일어난다
  const draft = {
    arriveAt: "09:00",
    leaveAt: "18:30",
    bufferMin: 5,
    walkPace: 1,
    preferredMode: "transit",
  };

  function progressDots() {
    return `<div class="onboard-dots">
      ${STEPS.map(
        (_, i) =>
          `<span class="onboard-dot${i === stepIndex ? " onboard-dot--active" : ""}${i < stepIndex ? " onboard-dot--done" : ""}"></span>`,
      ).join("")}
    </div>`;
  }

  function shell(bodyHtml, { nextLabel = "다음" } = {}) {
    root.innerHTML = `
      <div class="onboard">
        ${BRAND_HTML}
        ${progressDots()}
        <div class="onboard-body">${bodyHtml}</div>
        <div class="onboard-actions">
          ${stepIndex > 0 ? `<button class="btn btn--ghost" data-act="back">이전</button>` : ""}
          <button class="btn btn--primary grow" data-act="next">${escapeHtml(nextLabel)}</button>
        </div>
        ${FOOTER_HTML}
      </div>`;
  }

  function paint() {
    pickerDispose?.();
    pickerDispose = null;
    const step = STEPS[stepIndex];

    if (step === "home" || step === "work") {
      const isHome = step === "home";
      root.innerHTML = `
        <div class="onboard">
          ${BRAND_HTML}
          ${progressDots()}
          ${
            isHome
              ? `<p class="onboard-welcome">👋 처음 오셨군요!! 반가워요!!<br />몇 가지만 알려주시면 <b>ReadyToGo</b>가<br />매일 늦지 않게 딱 맞춰 챙겨드릴게요!!</p>`
              : ""
          }
          <p class="eyebrow">${isHome ? "집" : "회사"} 위치</p>
          <p class="onboard-title">${isHome ? "집 위치를 알려주세요" : "회사 위치를 알려주세요"}</p>
          <p class="onboard-desc">${isHome ? "출근 경로 계산에 사용해요." : "퇴근 경로 계산에 사용해요."}</p>
          <div id="onboard-picker" style="margin-top:16px"></div>
          <div class="onboard-actions">
            ${stepIndex > 0 ? `<button class="btn btn--ghost" data-act="back">이전</button>` : ""}
            ${isHome ? `<button class="btn btn--primary grow" style="text-align:center" data-act="import">다른 기기에 설정이 있어요</button>` : ""}
          </div>
          ${FOOTER_HTML}
        </div>`;
      pickerDispose = mountPlacePicker(root.querySelector("#onboard-picker"), {
        onSelect(place) {
          const saved = upsertPlace(place);
          if (!saved.favorite) toggleFavorite(saved.id);
          setState(isHome ? { homeId: saved.id } : { workId: saved.id });
          goNext();
        },
      });
      return;
    }

    if (step === "commute") {
      shell(`
        <p class="eyebrow">출퇴근 희망 시각</p>
        <p class="onboard-title">평소 언제 출근하고 퇴근하나요?</p>
        <label class="field" style="margin-top:20px">
          <span class="field__label">출근 · 회사 도착 희망 시각</span>
          <input class="input" type="time" id="arriveAt" value="${escapeHtml(draft.arriveAt)}" />
        </label>
        <label class="field" style="margin-top:14px">
          <span class="field__label">퇴근 · 회사에서 나서는 시각</span>
          <input class="input" type="time" id="leaveAt" value="${escapeHtml(draft.leaveAt)}" />
        </label>`);
      return;
    }

    if (step === "buffer") {
      shell(`
        <p class="eyebrow">여유시간</p>
        <p class="onboard-title">출발 전 얼마나 여유를 둘까요?</p>
        <p class="onboard-desc">정류장에 미리 도착해 있을 시간이에요. 값이 클수록 더 일찍 나서라고 안내해요.</p>
        <label class="field" style="margin-top:20px">
          <span class="field__label" id="bufferLabel">개인 여유시간 · ${draft.bufferMin}분</span>
          <input type="range" min="0" max="20" step="1" value="${draft.bufferMin}" id="bufferMin" style="width:100%" />
        </label>`);
      return;
    }

    if (step === "pace") {
      shell(`
        <p class="eyebrow">도보 속도</p>
        <p class="onboard-title">평소 걷는 속도는 어느 정도인가요?</p>
        <div class="seg" style="margin-top:20px">
          ${PACE.map(
            (p) =>
              `<button class="seg__btn" data-pace="${p.value}" aria-pressed="${draft.walkPace === p.value}">${p.label}</button>`,
          ).join("")}
        </div>`);
      return;
    }

    if (step === "mode") {
      shell(
        `
        <p class="eyebrow">이동수단</p>
        <p class="onboard-title">자주 쓰는 이동수단은 무엇인가요?</p>
        <div class="seg" style="margin-top:20px">
          <button class="seg__btn" data-prefer="transit" aria-pressed="${draft.preferredMode === "transit"}">🚇 대중교통</button>
          <button class="seg__btn" data-prefer="driving" aria-pressed="${draft.preferredMode === "driving"}">🚗 마이카</button>
        </div>`,
        { nextLabel: "시작하기" },
      );
      return;
    }
  }

  function goNext() {
    if (disposed) return;
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    stepIndex += 1;
    paint();
  }

  function goBack() {
    if (stepIndex === 0) return;
    stepIndex -= 1;
    paint();
  }

  function finish() {
    setCommute({ arriveAt: draft.arriveAt, leaveAt: draft.leaveAt });
    setSettings({
      bufferMin: draft.bufferMin,
      walkPace: draft.walkPace,
      preferredMode: draft.preferredMode,
    });
    setState({ onboarded: true });
    location.hash = "#/home";
    ctx.refresh?.();
  }

  paint();

  delegate(root, "click", '[data-act="back"]', goBack);
  delegate(root, "click", '[data-act="next"]', goNext);

  delegate(root, "change", "#arriveAt", (_e, el) => {
    if (el.value) draft.arriveAt = el.value;
  });
  delegate(root, "change", "#leaveAt", (_e, el) => {
    if (el.value) draft.leaveAt = el.value;
  });
  delegate(root, "input", "#bufferMin", (_e, el) => {
    draft.bufferMin = Number(el.value);
    const label = root.querySelector("#bufferLabel");
    if (label) label.textContent = `개인 여유시간 · ${el.value}분`;
  });
  delegate(root, "click", "[data-pace]", (_e, el) => {
    draft.walkPace = Number(el.dataset.pace);
    paint();
  });
  delegate(root, "click", "[data-prefer]", (_e, el) => {
    draft.preferredMode = el.dataset.prefer;
    paint();
  });

  delegate(root, "click", '[data-act="import"]', () => {
    openSheet({
      title: "다른 기기에서 가져오기",
      body: `
        <p class="muted" style="font-size:12.5px;font-weight:600;line-height:1.6;margin-bottom:10px">
          다른 기기의 설정 화면에서 &lsquo;내보내기&rsquo;로 받은 코드를 붙여넣으세요.
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
            location.hash = "#/home";
            ctx.refresh?.();
          } catch (err) {
            toast(err.message || "올바른 코드가 아니에요");
          }
        });
      },
    });
  });

  return () => {
    disposed = true;
    pickerDispose?.();
  };
}
