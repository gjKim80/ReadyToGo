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

/** 첫 실행 시 시드되는 예시 장소 — 설정에서 언제든 변경 가능 */
const SEED = {
  home: {
    id: "seed-home",
    name: "집",
    address: "서울 마포구 월드컵북로 400",
    lat: 37.5683,
    lng: 126.8974,
    icon: "🏠",
    favorite: true,
  },
  work: {
    id: "seed-work",
    name: "회사",
    address: "서울 강남구 테헤란로 152",
    lat: 37.5006,
    lng: 127.0366,
    icon: "🏢",
    favorite: true,
  },
};

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
  homeId: "seed-home",
  workId: "seed-work",
  commute: {
    /** 평일 출근: 회사 도착 희망 시각 */
    arriveAt: "09:00",
    /** 평일 퇴근: 회사에서 나서는 시각 */
    leaveAt: "18:30",
  },
  places: [SEED.home, SEED.work],
  history: [],
  trip: {
    destinationId: null,
    /** null이면 현재 위치(Geolocation) 사용 */
    originId: null,
    mode: "transit",
    /** "HH:MM" 또는 null(=지금 출발) */
    arriveBy: null,
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
