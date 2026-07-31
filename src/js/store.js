/**
 * 앱 전역 상태 + 로컬 영속화.
 *
 * 기획서상 Local DB는 SQLite지만, 웹앱에서는 동일한 역할을
 * localStorage(구조화된 단일 문서)로 대체한다. save/load 지점이
 * 한 곳으로 모여 있어 추후 IndexedDB/서버 동기화로 교체하기 쉽다.
 */

import { uid } from "./util.js";

const STORAGE_KEY = "readytogo.v1";
const HISTORY_LIMIT = 20;
const BACKUP_PREFIX = "RTG1:";

const DEFAULT_STATE = {
  version: 1,
  onboarded: false,
  mode: "weekday",
  settings: {
    /** 문 앞으로 나가기까지의 개인 여유시간(분) */
    bufferMin: 5,
    /** 도보 속도 배율 (느림 0.8 / 보통 1 / 빠름 1.2) */
    walkPace: 1,
    /** 주말 모드 기본 이동수단 */
    preferredMode: "transit",
    notify: false,
    autoRefreshSec: 60,
  },
  /** 온보딩에서 채워지기 전까지는 비어있다 */
  homeId: null,
  workId: null,
  commute: {
    /** 평일 출근: 회사 도착 희망 시각 */
    arriveAt: "09:00",
    /** 평일 퇴근: 회사에서 나서는 시각 */
    leaveAt: "18:00",
  },
  places: [],
  history: [],
  trip: {
    destinationId: null,
    /** null이면 현재 위치(Geolocation) 사용 */
    originId: null,
    mode: "transit",
    /** 경로 화면의 시각 기준 — "now"(지금 출발) | "arrive"(도착 희망) | "depart"(출발 희망) */
    timeMode: "now",
    /** "HH:MM" 또는 null — timeMode가 "arrive"일 때만 사용 */
    arriveBy: null,
    /** "HH:MM" 또는 null — timeMode가 "depart"일 때만 사용 */
    departAt: null,
    /** Ready를 눌러 카운트다운을 "시작"했는지 — 꺼지기 전까지 탭 전환/재실행에도 유지 */
    active: false,
    /** 평일 모드에서 active 상태로 고정된 방향. null이면 시간대 기준 자동판단 */
    weekdayDirection: null,
  },
};

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || parsed.version !== DEFAULT_STATE.version) return structuredClone(DEFAULT_STATE);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      commute: { ...DEFAULT_STATE.commute, ...(parsed.commute || {}) },
      trip: { ...DEFAULT_STATE.trip, ...(parsed.trip || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let state = load();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 용량 초과/프라이빗 모드 — 메모리 상태로만 동작 */
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 부분 갱신 후 저장 + 구독자 통지 */
export function setState(patch) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  persist();
  listeners.forEach((fn) => fn(state));
  return state;
}

/* ---------- 장소 셀렉터 ---------- */

export const getPlace = (id) => state.places.find((p) => p.id === id) || null;
export const getHome = () => getPlace(state.homeId);
export const getWork = () => getPlace(state.workId);

/** 즐겨찾기 우선, 그 다음 최근 방문순 */
export function listPlaces() {
  return [...state.places].sort((a, b) => {
    if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1;
    return (b.visitedAt || 0) - (a.visitedAt || 0);
  });
}

export const listFavorites = () => listPlaces().filter((p) => p.favorite);

export function listHistory() {
  return state.history
    .map((id) => getPlace(id))
    .filter(Boolean)
    .slice(0, HISTORY_LIMIT);
}

/** 좌표가 거의 같고 이름이 같으면 동일 장소로 본다. */
function findSame(place) {
  return state.places.find(
    (p) =>
      p.id === place.id ||
      (p.name === place.name &&
        Math.abs(p.lat - place.lat) < 0.0002 &&
        Math.abs(p.lng - place.lng) < 0.0002),
  );
}

/** 장소를 저장(또는 갱신)하고 저장된 레코드를 반환 */
export function upsertPlace(place) {
  const existing = findSame(place);
  const record = existing
    ? { ...existing, ...place, id: existing.id }
    : { ...place, id: place.id || uid() };

  setState((s) => ({
    ...s,
    places: existing
      ? s.places.map((p) => (p.id === record.id ? record : p))
      : [...s.places, record],
  }));
  return record;
}

export function toggleFavorite(id) {
  setState((s) => ({
    ...s,
    places: s.places.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
  }));
  return getPlace(id);
}

export function removePlace(id) {
  setState((s) => ({
    ...s,
    places: s.places.filter((p) => p.id !== id),
    history: s.history.filter((h) => h !== id),
    homeId: s.homeId === id ? null : s.homeId,
    workId: s.workId === id ? null : s.workId,
    trip: {
      ...s.trip,
      // 둘 중 하나라도 지운 장소를 가리키고 있었다면 정리한다 — 안 그러면 존재하지 않는
      // 장소 id가 그대로 남아 getPlace()가 null을 반환하고, 그 null이 좌표 취급되며 퍼진다.
      destinationId: s.trip.destinationId === id ? null : s.trip.destinationId,
      originId: s.trip.originId === id ? null : s.trip.originId,
    },
  }));
}

/** 방문/검색 이력 기록 — 중복은 최신으로 끌어올린다. */
export function pushHistory(id) {
  setState((s) => ({
    ...s,
    places: s.places.map((p) => (p.id === id ? { ...p, visitedAt: Date.now() } : p)),
    history: [id, ...s.history.filter((h) => h !== id)].slice(0, HISTORY_LIMIT),
  }));
}

export function clearHistory() {
  setState((s) => ({ ...s, history: [] }));
}

/* ---------- 기타 셀렉터 ---------- */

export const setMode = (mode) => setState({ mode });
export const setTrip = (patch) => setState((s) => ({ ...s, trip: { ...s.trip, ...patch } }));
export const setSettings = (patch) =>
  setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
export const setCommute = (patch) =>
  setState((s) => ({ ...s, commute: { ...s.commute, ...patch } }));

export function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  persist();
  listeners.forEach((fn) => fn(state));
}

/* ---------- 다른 기기로 내보내기/가져오기 ---------- */
/**
 * 서버 계정이 없는 앱이라 실시간 동기화 대신, 저장된 장소·출퇴근 설정을 코드로 내보내고
 * 다른 기기에서 그대로 붙여넣어 복원하는 방식을 쓴다. trip(진행 중 상태)·onboarded 여부처럼
 * 기기별로 달라도 되는 값은 제외한다.
 */

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64Utf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function exportBackup() {
  const payload = {
    places: state.places,
    homeId: state.homeId,
    workId: state.workId,
    commute: state.commute,
    settings: state.settings,
  };
  return `${BACKUP_PREFIX}${toBase64Utf8(JSON.stringify(payload))}`;
}

/** 코드가 올바르지 않으면 던진다 — 호출부에서 사용자에게 메시지를 보여준다 */
export function importBackup(code) {
  const raw = String(code || "").trim();
  const b64 = raw.startsWith(BACKUP_PREFIX) ? raw.slice(BACKUP_PREFIX.length) : raw;

  let payload;
  try {
    payload = JSON.parse(fromBase64Utf8(b64));
  } catch {
    throw new Error("올바른 코드가 아니에요");
  }
  if (!payload || !Array.isArray(payload.places)) {
    throw new Error("올바른 코드가 아니에요");
  }

  setState((s) => ({
    ...s,
    places: payload.places,
    homeId: payload.homeId ?? null,
    workId: payload.workId ?? null,
    commute: { ...DEFAULT_STATE.commute, ...(payload.commute || {}) },
    settings: { ...DEFAULT_STATE.settings, ...(payload.settings || {}) },
    onboarded: true,
  }));
}
