/** 탭바 아이콘 — Flat 2D 라인 아이콘을 mask-image로 적용 (색은 CSS currentColor) */

const PATHS = {
  home: "<path d='M3 10.6 12 3l9 7.6'/><path d='M5.5 9.6V21h13V9.6'/><path d='M10 21v-5.5h4V21'/>",
  route:
    "<circle cx='6' cy='18' r='2.6'/><circle cx='18' cy='6' r='2.6'/><path d='M8.6 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h2.4'/>",
  star: "<path d='m12 3.2 2.75 5.6 6.15.9-4.45 4.35 1.05 6.15L12 17.3l-5.5 2.9 1.05-6.15L3.1 9.7l6.15-.9Z'/>",
  gear:
    "<circle cx='12' cy='12' r='3.2'/><path d='M12 2.2v2.6M12 19.2v2.6M2.2 12h2.6M19.2 12h2.6M5.1 5.1l1.9 1.9M17 17l1.9 1.9M18.9 5.1 17 7M7 17l-1.9 1.9'/>",
};

function dataUri(inner) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" ` +
    `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** [data-icon] 요소에 마스크 이미지를 주입한다. */
export function applyIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const path = PATHS[el.dataset.icon];
    if (!path) return;
    const uri = dataUri(path);
    el.style.maskImage = uri;
    el.style.webkitMaskImage = uri;
  });
}
