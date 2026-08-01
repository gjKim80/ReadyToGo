/**
 * GET /api/timetable — 서울교통공사 역코드로 지하철 열차 시간표 검색(getTrainSch) 프록시.
 *
 * 요청: ?station=강남&line=2호선&direction=up|down[&day=weekday|saturday|sunday]
 * 응답: { items: [{ departAt: "HH:MM:SS", destination: "성수" }, ...] }
 *
 * 필요한 환경변수: SEOUL_SUBWAY_TIMETABLE_KEY
 *   (서울 열린데이터광장에서 "서울교통공사_역코드로 지하철 열차 시간표 검색"을
 *    별도로 활용신청해야 한다 — 실시간 도착용 SEOUL_SUBWAY_API_KEY와는 다른 승인 항목이다)
 *
 * [알아둘 것 — 역코드를 아직 안 쓴다]
 * getTrainSch는 원래 역코드(stnCd)로 필터링하도록 만들어졌지만, 역명 -> 역코드
 * 변환 API를 아직 못 찾았다(추정 서비스명 2개를 호출해봤지만 둘 다 실패).
 * 그래서 지금은 역코드 자리를 비워 호선+방향+요일 전체를 받아온 뒤 역명(stnNm)으로
 * 직접 필터링한다 — 한 호선 전체 데이터라 응답이 크지만(호선당 수만 건),
 * 서버에서 station으로 걸러 필요한 것만 돌려주므로 프런트엔드가 받는 양은 작다.
 * 나중에 역코드 매핑을 확보하면 station 자리에 코드를 넣어 요청 자체를 가볍게 할 수 있다.
 *
 * [방향(상행/하행) 자동판별은 아직 안 한다]
 * ODsay 응답에 상행/하행 플래그가 없어서 direction은 호출부가 넘겨줘야 한다.
 * 지금은 백엔드만 준비해 둔 상태 — 프런트엔드 연결(departure.js)은 다음 단계.
 *
 * [시간표 vs 실시간]
 * 이 시간표는 정적 데이터(유효기간 보통 ~2개월)라 자주 안 바뀐다. 그래서 응답을
 * 넉넉하게 캐싱해도 되고(cacheSec), 이게 원래 목적이었던 "자동 새로고침마다
 * 실시간 도착 API를 다시 부르지 않기" 최적화의 핵심이다.
 */

import { UpstreamError, env, fail, handler, requireEnv, sendJson } from "./_lib/http.js";

const BASE = "http://openapi.seoul.go.kr:8088";

const DAY_TAG = { weekday: "평일", saturday: "토요일", sunday: "일요일" };
const DIRECTION_TAG = { up: "상행", down: "하행" };

/** 오늘(KST) 요일 -> weekday/saturday/sunday. 공휴일은 반영하지 않는다(알려줄 데이터가 없음). */
function defaultDayType() {
  const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay();
  if (kstDay === 0) return "sunday";
  if (kstDay === 6) return "saturday";
  return "weekday";
}

/**
 * 이 API는 퍼센트 인코딩된 한글을 그대로 되돌려주지 않고 다른 데이터로 응답한다
 * (인코딩 문자셋이 서버 기대치와 안 맞는 것으로 보인다) — 그래서 한글 세그먼트는
 * 인코딩하지 않고 UTF-8 원문 그대로 URL에 넣는다. fetch()는 이를 그대로 보낸다.
 */
function buildUrl(key, segments) {
  return `${BASE}/${key}/xml/getTrainSch/${segments.join("/")}`;
}

/** 태그 하나의 텍스트 내용만 뽑는다 — 이 응답은 얕은 평면 구조라 정규식으로 충분하다 */
/** 값이 <![CDATA[...]]>로 감싸져 오는 태그(에러 메시지 등)도 함께 처리한다 */
function tagText(block, tag) {
  const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`).exec(block);
  return m ? m[1].trim() : "";
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    items.push({
      stnNm: tagText(block, "stnNm"),
      trainDptreTm: tagText(block, "trainDptreTm"),
      arvlStnNm: tagText(block, "arvlStnNm"),
    });
  }
  return items;
}

export default handler(async (req, res) => {
  const key = env("SEOUL_SUBWAY_TIMETABLE_KEY");
  if (requireEnv(res, { SEOUL_SUBWAY_TIMETABLE_KEY: key })) return;

  const station = String(req.query.station || "").trim();
  // ODsay 등은 "수도권 2호선"처럼 접두어를 붙여 줄 수 있다 — 이 API는 "2호선"만 받는다
  const line = String(req.query.line || "").replace(/^수도권\s*/, "").trim();
  const directionTag = DIRECTION_TAG[req.query.direction];
  if (!station || !line || !directionTag) {
    fail(res, 400, "bad_request", "station / line / direction(up|down)이 필요합니다");
    return;
  }
  const dayTag = DAY_TAG[req.query.day] || DAY_TAG[defaultDayType()];

  const url = buildUrl(key, ["1", "9999", "", "N", directionTag, dayTag, line]);

  let text;
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(9000) });
    text = await upstream.text();
  } catch (err) {
    throw new UpstreamError(`서울교통공사 시간표 호출 실패: ${err.message}`, { status: 504 });
  }

  // 인증/파라미터 오류는 <response> 대신 <RESULT><CODE>...</CODE></RESULT> 형태로 온다
  if (!/<response>/.test(text)) {
    const code = tagText(text, "CODE");
    const message = tagText(text, "MESSAGE").trim();
    throw new UpstreamError(`서울교통공사 시간표 오류(${code || "unknown"}): ${message}`, { detail: text.slice(0, 400) });
  }

  const resultCode = tagText(text, "resultCode");
  if (resultCode && resultCode !== "00") {
    throw new UpstreamError(`서울교통공사 시간표 실패: ${tagText(text, "resultMsg")}`, { detail: { resultCode } });
  }

  const nowClock = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(11, 19);
  const items = parseItems(text)
    .filter((it) => it.stnNm === station && it.trainDptreTm)
    .filter((it) => it.trainDptreTm >= nowClock)
    .sort((a, b) => (a.trainDptreTm < b.trainDptreTm ? -1 : 1))
    .slice(0, 5)
    .map((it) => ({ departAt: it.trainDptreTm, destination: it.arvlStnNm || null }));

  // 시간표는 보통 ~2개월 단위로만 바뀌므로 30분 캐싱해도 안전하다 — 자동 새로고침마다
  // 매번 원 API를 다시 부르지 않게 하는 게 이 엔드포인트를 만든 이유다
  sendJson(res, 200, { items }, { cacheSec: 1800 });
});
