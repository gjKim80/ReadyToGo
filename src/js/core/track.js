/**
 * 탑승 중 실시간 안내용 위치 추적 — watchPosition 대신 간격 폴링을 쓴다.
 * 배터리를 덜 쓰고, 터널 진입/이탈 같은 실패를 매 틱 독립적으로 다루기 쉽다.
 * 지하철 터널 안에서는 대부분 실패하는 게 정상이므로, 실패(서울시청 폴백)는
 * 조용히 건너뛰고 다음 틱을 기다린다 — guidance.js의 시간 기반 추정이 그동안 대신한다.
 */

import { getCurrentPosition } from "../api/places.js";

/**
 * @param {(pos: {lat:number,lng:number}) => void} onUpdate 신호가 잡혔을 때만 호출된다
 * @returns {() => void} 중지 함수
 */
export function pollPosition(onUpdate, { intervalMs = 15000 } = {}) {
  let cancelled = false;

  const tick = async () => {
    const pos = await getCurrentPosition({ timeout: 8000, enableHighAccuracy: true });
    if (!cancelled && !pos.approximate) onUpdate(pos);
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
