/**
 * Flat 2D 미니맵 (canvas).
 *
 * NAVER Maps SDK 키가 없는 환경에서도 "지도에서 핀을 드래그해 목적지 지정"
 * 기능이 동작하도록 하는 내장 렌더러다. 좌표 → 화면 투영, 드래그 패닝,
 * 경로 폴리라인, 마커를 지원한다. config.naverMapClientId가 채워지면
 * 이 모듈 대신 실제 SDK를 붙이면 된다 (동일한 onChange 인터페이스).
 */

import { seededRandom } from "../util.js";

const METERS_PER_DEG_LAT = 111320;
const BLOCK_M = 190; // 가로 블록 한 변
const ROAD_M = 22; // 도로 폭

const metersPerDegLng = (lat) => METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

const readVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export function createMap(container, options = {}) {
  const {
    center = { lat: 37.5665, lng: 126.978 },
    metersPerPixel = 2.6,
    draggable = true,
    onChange = null,
    onChangeEnd = null,
  } = options;

  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const state = {
    center: { ...center },
    mpp: metersPerPixel,
    route: null,
    markers: [],
    width: 0,
    height: 0,
  };

  /* ---------- 투영 ---------- */

  function toScreen(coord) {
    const mLng = metersPerDegLng(state.center.lat);
    return {
      x: state.width / 2 + ((coord.lng - state.center.lng) * mLng) / state.mpp,
      y: state.height / 2 - ((coord.lat - state.center.lat) * METERS_PER_DEG_LAT) / state.mpp,
    };
  }

  function panByPixels(dx, dy) {
    const mLng = metersPerDegLng(state.center.lat);
    state.center = {
      lat: state.center.lat + (dy * state.mpp) / METERS_PER_DEG_LAT,
      lng: state.center.lng - (dx * state.mpp) / mLng,
    };
  }

  /* ---------- 렌더 ---------- */

  function blockColor(ix, iy) {
    const r = seededRandom(`blk:${ix}:${iy}`);
    if (r > 0.94) return readVar("--c-ok-weak", "#E5F5ED"); // 공원
    if (r > 0.9) return readVar("--c-rain-weak", "#E4F2FB"); // 수변
    return readVar("--c-bg", "#FFFFFF");
  }

  function draw() {
    const { width: w, height: h } = state;
    if (!w || !h) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, w, h);

    // 배경 = 도로면
    ctx.fillStyle = readVar("--c-fill", "#F4F5F7");
    ctx.fillRect(0, 0, w, h);

    // 중심 좌표의 월드 미터 위치
    const mLng = metersPerDegLng(state.center.lat);
    const cx = state.center.lng * mLng;
    const cy = state.center.lat * METERS_PER_DEG_LAT;

    const halfW = (w / 2) * state.mpp;
    const halfH = (h / 2) * state.mpp;
    const startX = Math.floor((cx - halfW) / BLOCK_M) - 1;
    const endX = Math.ceil((cx + halfW) / BLOCK_M) + 1;
    const startY = Math.floor((cy - halfH) / BLOCK_M) - 1;
    const endY = Math.ceil((cy + halfH) / BLOCK_M) + 1;

    const size = (BLOCK_M - ROAD_M) / state.mpp;
    for (let ix = startX; ix <= endX; ix += 1) {
      for (let iy = startY; iy <= endY; iy += 1) {
        const px = w / 2 + (ix * BLOCK_M + ROAD_M / 2 - cx) / state.mpp;
        const py = h / 2 - (iy * BLOCK_M + BLOCK_M - ROAD_M / 2 - cy) / state.mpp;
        ctx.fillStyle = blockColor(ix, iy);
        ctx.fillRect(px, py, size, size);
      }
    }

    // 간선도로 하이라이트 (5블록마다)
    ctx.strokeStyle = readVar("--c-line", "#E3E5EA");
    ctx.lineWidth = ROAD_M / state.mpp;
    ctx.beginPath();
    for (let ix = startX; ix <= endX; ix += 1) {
      if (ix % 5 !== 0) continue;
      const px = w / 2 + (ix * BLOCK_M - cx) / state.mpp;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let iy = startY; iy <= endY; iy += 1) {
      if (iy % 5 !== 0) continue;
      const py = h / 2 - (iy * BLOCK_M - cy) / state.mpp;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    // 경로 폴리라인
    if (state.route?.length > 1) {
      ctx.strokeStyle = readVar("--c-primary", "#1B64DA");
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      state.route.forEach(([lat, lng], i) => {
        const p = toScreen({ lat, lng });
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    // 마커
    state.markers.forEach((marker) => {
      const p = toScreen(marker);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = marker.color || readVar("--c-primary", "#1B64DA");
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = readVar("--c-bg", "#FFFFFF");
      ctx.stroke();

      if (marker.label) {
        ctx.font = "700 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = readVar("--c-ink", "#16181D");
        ctx.fillText(marker.label, p.x, p.y - 14);
      }
    });
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    state.width = rect.width;
    state.height = rect.height;
    canvas.width = Math.round(rect.width * devicePixelRatio);
    canvas.height = Math.round(rect.height * devicePixelRatio);
    draw();
  }

  /* ---------- 드래그 ---------- */

  let dragging = false;
  let last = null;

  function onPointerDown(event) {
    if (!draggable) return;
    dragging = true;
    last = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging) return;
    panByPixels(event.clientX - last.x, event.clientY - last.y);
    last = { x: event.clientX, y: event.clientY };
    draw();
    onChange?.({ ...state.center });
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* 캡처가 이미 해제된 경우 무시 */
    }
    onChangeEnd?.({ ...state.center });
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  return {
    get center() {
      return { ...state.center };
    },
    setCenter(coord, { silent = true } = {}) {
      state.center = { ...coord };
      draw();
      if (!silent) onChange?.({ ...state.center });
    },
    setRoute(path) {
      state.route = path;
      draw();
    },
    setMarkers(markers) {
      state.markers = markers || [];
      draw();
    },
    /** 두 지점이 모두 보이도록 축척/중심 조정 */
    fit(a, b, padding = 40) {
      const mLng = metersPerDegLng((a.lat + b.lat) / 2);
      const dx = Math.abs(a.lng - b.lng) * mLng;
      const dy = Math.abs(a.lat - b.lat) * METERS_PER_DEG_LAT;
      const availW = Math.max(40, state.width - padding * 2);
      const availH = Math.max(40, state.height - padding * 2);
      state.mpp = Math.max(1.2, Math.max(dx / availW, dy / availH));
      state.center = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      draw();
    },
    redraw: draw,
    destroy() {
      observer.disconnect();
      canvas.remove();
    },
  };
}
