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
 * [TODO — 역코드 필터가 아직 안 먹는다]
 * getTrainSch는 원래 역코드(stnCd)로 필터링하도록 만들어졌다. 역명 -> 역코드
 * 변환은 찾았다 — `SearchInfoBySubwayNameService/1/5/강남` 호출하면
 * `{STATION_CD:"0222", STATION_NM:"강남", LINE_NUM:"02호선", FR_CODE:"222"}`가
 * 온다(같은 역명이 여러 노선에 있으면 row가 여러 개 오니 LINE_NUM으로 골라야 함).
 * 그런데 이 STATION_CD("0222")를 getTrainSch의 역코드 자리에 넣어봐도 필터링이
 * 안 되고 여전히 노선 전체(을지로입구부터 순서대로) 데이터가 온다 — 파라미터
 * 순서/포맷이 다른 것으로 보이는데 아직 원인을 못 찾았다. 다음에 이어서 풀 것.
 *
 * 그래서 지금은 역코드 자리를 비워 호선+방향+요일 데이터를 받아온 뒤 역명(stnNm)으로
 * 직접 필터링한다. 이 API는 한 번에 최대 1000건까지만 주므로(START=1, END=1000
 * 고정), 이른 아침 시간대의 열차만 그 1000건 안에 들어온다 — 즉 지금 방식은
 * "새벽에만 맞는 시간표"만 나와서 아직 실사용 가능한 상태가 아니다. 역코드 필터가
 * 되면 이 문제가 자연히 풀린다(호선 전체가 아니라 그 역만 오니까).
 *
 * [상행/하행 vs 내선/외선]
 * 대부분 노선은 "상행"/"하행"을 쓰지만, 2호선은 순환선이라 "내선"/"외선"을 쓴다
 * (실제로 호출해서 확인함 — 2호선에 상행/하행을 보내면 0건이 온다).
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
/** 대부분 노선은 상행/하행이지만, 2호선은 순환선이라 내선/외선 용어를 쓴다(실측 확인함) */
const DIRECTION_TAG = {
  up: (line) => (line === "2호선" ? "내선" : "상행"),
  down: (line) => (line === "2호선" ? "외선" : "하행"),
};

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
  const directionFn = DIRECTION_TAG[req.query.direction];
  if (!station || !line || !directionFn) {
    fail(res, 400, "bad_request", "station / line / direction(up|down)이 필요합니다");
    return;
  }
  const dayTag = DAY_TAG[req.query.day] || DAY_TAG[defaultDayType()];
  const directionTag = directionFn(line);

  // 이 API는 한 번에 최대 1000건까지만 허용한다
  const url = buildUrl(key, ["1", "1000", "", "N", directionTag, dayTag, line]);

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

  const parsed = parseItems(text);
  const nowClock = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(11, 19);
  const items = parsed
    .filter((it) => it.stnNm === station && it.trainDptreTm)
    .filter((it) => it.trainDptreTm >= nowClock)
    .sort((a, b) => (a.trainDptreTm < b.trainDptreTm ? -1 : 1))
    .slice(0, 5)
    .map((it) => ({ departAt: it.trainDptreTm, destination: it.arvlStnNm || null }));

  if (req.query.debug) {
    sendJson(res, 200, {
      items,
      _debug: {
        url,
        directionTag,
        dayTag,
        line,
        station,
        nowClock,
        parsedCount: parsed.length,
        uniqueStations: [...new Set(parsed.map((it) => it.stnNm))],
      },
    });
    return;
  }

  // 시간표는 보통 ~2개월 단위로만 바뀌므로 30분 캐싱해도 안전하다 — 자동 새로고침마다
  // 매번 원 API를 다시 부르지 않게 하는 게 이 엔드포인트를 만든 이유다
  sendJson(res, 200, { items }, { cacheSec: 1800 });
});
