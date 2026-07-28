/** 공용 유틸리티 — DOM, 시간 포맷, 좌표 계산, 결정론적 난수 */

/* ---------- DOM ---------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

/** 값을 이스케이프하며 조립하는 태그드 템플릿. raw()로 감싼 값은 그대로 삽입한다. */
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    let piece;
    if (v === null || v === undefined || v === false) piece = "";
    else if (v && v.__raw) piece = v.value;
    else if (Array.isArray(v)) piece = v.map((x) => (x && x.__raw ? x.value : escapeHtml(x))).join("");
    else piece = escapeHtml(v);
    return out + piece + str;
  });
}

export const raw = (value) => ({ __raw: true, value: value ?? "" });

/** 위임 방식 이벤트 바인딩: root 내부에서 selector에 매칭되는 요소의 이벤트를 처리 */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

/* ---------- 시간 ---------- */

export const MIN = 60;
export const HOUR = 3600;

export const pad2 = (n) => String(n).padStart(2, "0");

/** Date → "19:10" */
export function fmtClock(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Date → "오후 7:10" */
export function fmtClockKo(date) {
  const h = date.getHours();
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${pad2(date.getMinutes())}`;
}

/** 초 → "1시간 5분" / "12분" / "40초" */
export function fmtDur(sec) {
  const total = Math.max(0, Math.round(sec));
  if (total < 60) return `${total}초`;
  const m = Math.round(total / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}시간 ${rest}분` : `${h}시간`;
}

/** 밀리초 → { sign, h, m, s } */
export function splitDuration(ms) {
  const sign = ms < 0 ? -1 : 1;
  const total = Math.floor(Math.abs(ms) / 1000);
  return {
    sign,
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

export const addSec = (date, sec) => new Date(date.getTime() + sec * 1000);
export const addMin = (date, min) => addSec(date, min * 60);

/** "08:50" + 기준일 → Date (기준일의 해당 시각) */
export function atTime(hhmm, base = new Date()) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** 오늘 기준 hhmm이 이미 지났으면 내일로 넘긴다. */
export function nextOccurrence(hhmm, now = new Date()) {
  const d = atTime(hhmm, now);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

export const isWeekend = (date = new Date()) => [0, 6].includes(date.getDay());

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

export function fmtDateKo(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_KO[date.getDay()]})`;
}

/* ---------- 좌표 ---------- */

/** 두 좌표 사이 직선거리(m) */
export function haversine(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 미터 → "1.2km" / "480m" */
export function fmtDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`;
}

/* ---------- 기타 ---------- */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 문자열 → 0~1 결정론적 난수. 목 데이터가 새로고침마다 튀지 않도록 사용. */
export function seededRandom(seed) {
  let h = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return ((h >>> 0) % 100000) / 100000;
}

/** seed 기반 정수 범위 값 */
export const seededInt = (seed, min, max) =>
  min + Math.floor(seededRandom(seed) * (max - min + 1));

export const pick = (seed, arr) => arr[Math.floor(seededRandom(seed) * arr.length) % arr.length];

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
