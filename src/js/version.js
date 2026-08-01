/**
 * 개발 버전 표시용 상수.
 *
 * 빌드 파이프라인이 없는 정적 사이트라 자동 생성 대신 배포할 때마다 수동으로 갱신한다.
 * (배포 = git 커밋 + push 시점 기준으로 올린다)
 */

export const APP_VERSION = "0.28.0";
export const BUILD_TIME = "2026-08-01T14:10:37+09:00";

/** BUILD_TIME(ISO) → "2026.07.28 23:43" */
export function buildTimeLabel() {
  const d = new Date(BUILD_TIME);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
