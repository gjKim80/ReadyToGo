/** 공용 UI 컴포넌트 — 토스트, 바텀시트, 확인 다이얼로그, 지도 핀 */

import { $, escapeHtml } from "../util.js";

let toastTimer = null;

export function toast(message, ms = 2200) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.dataset.show = "false";
  }, ms);
}

/**
 * 바텀시트를 연다.
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openSheet({ title, body = "", onMount, onClose } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title || "")}">
      <div class="sheet__grip"></div>
      ${title ? `<h2 class="sheet__title">${escapeHtml(title)}</h2>` : ""}
      <div class="sheet__body"></div>
    </div>`;

  const sheet = backdrop.querySelector(".sheet");
  const bodyEl = backdrop.querySelector(".sheet__body");
  bodyEl.innerHTML = body;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    onClose?.();
  }

  function onKey(event) {
    if (event.key === "Escape") close();
  }

  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  document.body.appendChild(backdrop);

  onMount?.(bodyEl, close);
  sheet.querySelector("input, button, select")?.focus({ preventScroll: true });

  return { el: bodyEl, close };
}

/** 되돌릴 수 없는 동작 확인용 시트 */
export function confirmSheet({ title, message, confirmLabel = "확인", danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      body: `
        <p style="font-size:14.5px;font-weight:600;line-height:1.6;color:var(--c-ink-2);margin-bottom:18px">
          ${escapeHtml(message)}
        </p>
        <div class="row" style="gap:8px">
          <button class="btn btn--ghost grow" data-act="cancel">취소</button>
          <button class="btn ${danger ? "" : "btn--primary"} grow" data-act="ok"
            ${danger ? 'style="background:var(--c-danger);color:#fff"' : ""}>${escapeHtml(confirmLabel)}</button>
        </div>`,
      onMount(el, closeFn) {
        el.addEventListener("click", (event) => {
          const act = event.target.closest("[data-act]")?.dataset.act;
          if (!act) return;
          answered = true;
          closeFn();
          resolve(act === "ok");
        });
      },
      // 백드롭 클릭/ESC로 닫히면 취소로 처리
      onClose() {
        if (!answered) resolve(false);
      },
    });
  });
}

/** 지도 중앙 고정 핀 (Flat 2D) */
export function pinSvg(color = "var(--c-primary)") {
  return `<svg width="28" height="40" viewBox="0 0 28 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 39c0-9 11-14 11-24A11 11 0 1 0 3 15c0 10 11 15 11 24Z" fill="${color}"/>
    <circle cx="14" cy="14.5" r="4.4" fill="#fff"/>
  </svg>`;
}
