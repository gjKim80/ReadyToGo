/**
 * GET /api/transit — 대중교통 경로 프록시 (미구현 · 목 데이터 폴백용 스텁).
 *
 * ⚠️ 구조적 제약
 *   공공데이터포털(TAGO)·서울 열린데이터광장 API는 "이미 알고 있는 특정 정류장/역의
 *   실시간 도착정보"만 제공한다. "출발지 → 목적지" 대중교통 경로 탐색(승차 정류장 선정,
 *   환승, 하차 정류장 선정)은 별도의 길찾기 API가 필요하며, 국내에서는 통상
 *   ODsay 대중교통 길찾기 API를 사용한다.
 *
 *   또한 ODsay는 경로만 주고 실시간 도착시각은 주지 않으므로, 실사용 품질을 맞추려면
 *   ODsay(경로) + TAGO/서울시(해당 정류장 실시간 도착)를 조합해야 한다.
 *
 * 따라서 지금은 빈 배열을 반환하고, 프런트엔드가 자체 추정(목) 데이터를 사용한다.
 * 200으로 응답하는 이유: 프런트엔드가 조용히 폴백하도록 하기 위함이다.
 */

import { coord, handler, sendJson } from "./_lib/http.js";

export default handler(async (req, res) => {
  const origin = coord(req.query, "sy", "sx");
  const destination = coord(req.query, "ey", "ex");

  sendJson(
    res,
    200,
    {
      itineraries: [],
      source: "not_implemented",
      reason:
        "대중교통 경로 탐색은 ODsay 등 길찾기 API 연동이 필요합니다. 현재는 앱 내 추정 로직을 사용합니다.",
      echo: origin && destination ? { origin, destination } : null,
    },
    { cacheSec: 0 },
  );
});
