/**
 * GET /api/weather — 기상청 단기예보 조회서비스 프록시.
 *
 * 요청: ?lat=37.5&lng=127.0
 * 응답: src/js/api/weather.js가 기대하는 정규화 형태
 *   { source, observedAt, temp, tempMin, tempMax, pop, popMax6h, sky,
 *     humidity, windMs, hourly: [{ at, hour, temp, pop, sky }] }
 *
 * 필요한 환경변수:
 *   KMA_SERVICE_KEY (공공데이터포털 "기상청_단기예보 조회서비스" 일반 인증키)
 *   → 인코딩/디코딩 키 어느 쪽을 넣어도 동작하도록 처리한다.
 */

import { UpstreamError, coord, env, fail, fetchJson, handler, sendJson } from "./_lib/http.js";

const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const KST_OFFSET = 9 * 60 * 60 * 1000;

/** 단기예보 발표 시각(KST) — 발표 후 약 10분 뒤부터 조회 가능 */
const VILAGE_SLOTS = [23, 20, 17, 14, 11, 8, 5, 2];

const pad = (n) => String(n).padStart(2, "0");
/** KST로 shift된 Date에서 UTC 게터를 KST 값으로 사용한다 */
const ymd = (k) => `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}`;

/**
 * 위경도 → 기상청 격자(nx, ny). 기상청이 배포한 DFS LCC 변환식 그대로.
 */
function toGrid(lat, lon) {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/** 초단기실황 기준시각 — 매시 정시 발표, 40분 이후 조회 가능 */
function ncstBase(nowMs) {
  const k = new Date(nowMs + KST_OFFSET);
  if (k.getUTCMinutes() < 40) k.setUTCHours(k.getUTCHours() - 1);
  return { base_date: ymd(k), base_time: `${pad(k.getUTCHours())}00` };
}

/** 단기예보 기준시각 — 3시간 간격 발표 중 조회 가능한 가장 최신 회차 */
function vilageBase(nowMs) {
  const k = new Date(nowMs + KST_OFFSET - 10 * 60 * 1000);
  const slot = VILAGE_SLOTS.find((s) => s <= k.getUTCHours());
  if (slot === undefined) {
    k.setUTCDate(k.getUTCDate() - 1);
    return { base_date: ymd(k), base_time: "2300" };
  }
  return { base_date: ymd(k), base_time: `${pad(slot)}00` };
}

/**
 * SKY(하늘상태) + PTY(강수형태) → 프런트엔드 sky 열거값.
 * PTY: 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 4 소나기 · 5 빗방울 · 6 빗방울눈날림 · 7 눈날림
 * SKY: 1 맑음 · 3 구름많음 · 4 흐림
 */
function toSky(sky, pty) {
  const p = Number(pty);
  if (p === 4) return "shower";
  if (p === 3 || p === 6 || p === 7) return "snow";
  if (p === 1 || p === 2 || p === 5) return "rain";

  const s = Number(sky);
  if (s === 1) return "clear";
  if (s === 3) return "cloudy";
  if (s === 4) return "overcast";
  return "cloudy";
}

function buildUrl(path, serviceKey, params) {
  // 인코딩 키(%가 포함된 형태)가 들어오면 한 번 풀어서 넣는다 — 이중 인코딩 방지
  const key = serviceKey.includes("%") ? decodeURIComponent(serviceKey) : serviceKey;
  const qs = new URLSearchParams({ serviceKey: key, dataType: "JSON", pageNo: "1", ...params });
  return `${BASE}/${path}?${qs}`;
}

/** 공공데이터포털 공통 응답 껍데기를 벗기고 item 배열만 반환 */
function unwrap(json, label) {
  const header = json?.response?.header;
  if (!header) throw new UpstreamError(`${label} 응답 형식이 예상과 다릅니다`, { detail: json });
  if (header.resultCode !== "00") {
    throw new UpstreamError(`${label} 실패: ${header.resultMsg || header.resultCode}`, {
      detail: { resultCode: header.resultCode, resultMsg: header.resultMsg },
    });
  }
  const item = json.response.body?.items?.item;
  return Array.isArray(item) ? item : item ? [item] : [];
}

export default handler(async (req, res) => {
  const serviceKey = env("KMA_SERVICE_KEY", "DATA_GO_KR_SERVICE_KEY");
  if (!serviceKey) {
    fail(res, 501, "not_configured", "KMA_SERVICE_KEY 환경변수가 없습니다");
    return;
  }

  const at = coord(req.query, "lat", "lng");
  if (!at) {
    fail(res, 400, "bad_request", "lat / lng 좌표가 필요합니다");
    return;
  }

  const nowMs = Date.now();
  const { nx, ny } = toGrid(at.lat, at.lng);
  const grid = { nx: String(nx), ny: String(ny) };

  const ncstUrl = buildUrl("getUltraSrtNcst", serviceKey, { numOfRows: "100", ...ncstBase(nowMs), ...grid });
  const fcstUrl = buildUrl("getVilageFcst", serviceKey, { numOfRows: "1000", ...vilageBase(nowMs), ...grid });

  // 실황이 아직 안 올라온 시간대에도 예보만으로 응답할 수 있게 개별 처리
  const [ncstResult, fcstResult] = await Promise.allSettled([
    fetchJson(ncstUrl, { label: "기상청 초단기실황", timeoutMs: 7000 }).then((j) => unwrap(j, "기상청 초단기실황")),
    fetchJson(fcstUrl, { label: "기상청 단기예보", timeoutMs: 9000 }).then((j) => unwrap(j, "기상청 단기예보")),
  ]);

  if (fcstResult.status === "rejected") {
    const err = fcstResult.reason;
    throw err instanceof UpstreamError ? err : new UpstreamError(err?.message || "기상청 단기예보 호출 실패");
  }

  const ncst = {};
  if (ncstResult.status === "fulfilled") {
    ncstResult.value.forEach((it) => {
      ncst[it.category] = Number(it.obsrValue);
    });
  }

  /* ── 예보를 (날짜+시각) 단위로 접어서 시간별 배열 만들기 ── */
  const slots = new Map();
  let tmn = null;
  let tmx = null;
  const todayYmd = ymd(new Date(nowMs + KST_OFFSET));

  fcstResult.value.forEach((it) => {
    const key = `${it.fcstDate}${it.fcstTime}`;
    if (!slots.has(key)) slots.set(key, { date: it.fcstDate, time: it.fcstTime });
    slots.get(key)[it.category] = it.fcstValue;

    if (it.fcstDate === todayYmd) {
      if (it.category === "TMN") tmn = Number(it.fcstValue);
      if (it.category === "TMX") tmx = Number(it.fcstValue);
    }
  });

  const nowKey = (() => {
    const k = new Date(nowMs + KST_OFFSET);
    return `${ymd(k)}${pad(k.getUTCHours())}00`;
  })();

  const hourly = [...slots.entries()]
    .filter(([key, slot]) => key >= nowKey && slot.TMP !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(0, 12)
    .map(([, slot]) => {
      const hour = Number(slot.time.slice(0, 2));
      return {
        at: `${slot.date.slice(0, 4)}-${slot.date.slice(4, 6)}-${slot.date.slice(6, 8)}T${pad(hour)}:00:00+09:00`,
        hour,
        temp: Number(slot.TMP),
        pop: Number(slot.POP ?? 0),
        sky: toSky(slot.SKY, slot.PTY),
      };
    });

  if (!hourly.length) {
    throw new UpstreamError("예보 데이터가 비어 있습니다", { detail: { nx, ny } });
  }

  // TMN/TMX가 회차에 포함되지 않는 시간대(예: 오후 발표)엔 오늘 예보 기온으로 대체
  const todayTemps = [...slots.values()]
    .filter((s) => s.date === todayYmd && s.TMP !== undefined)
    .map((s) => Number(s.TMP));
  const fallbackMin = todayTemps.length ? Math.min(...todayTemps) : hourly[0].temp;
  const fallbackMax = todayTemps.length ? Math.max(...todayTemps) : hourly[0].temp;

  const current = hourly[0];
  const temp = Number.isFinite(ncst.T1H) ? ncst.T1H : current.temp;

  sendJson(
    res,
    200,
    {
      source: "kma",
      observedAt: new Date(nowMs).toISOString(),
      temp,
      tempMin: tmn ?? Math.min(fallbackMin, temp),
      tempMax: tmx ?? Math.max(fallbackMax, temp),
      pop: current.pop,
      popMax6h: Math.max(...hourly.slice(0, 6).map((h) => h.pop)),
      // 실황 PTY가 있으면 현재 강수를 우선 반영하고, 하늘상태는 예보값을 쓴다
      sky: Number.isFinite(ncst.PTY) ? toSky(slots.get(nowKey)?.SKY ?? 3, ncst.PTY) : current.sky,
      humidity: Number.isFinite(ncst.REH) ? ncst.REH : Number(slots.get(nowKey)?.REH ?? 60),
      windMs: Number.isFinite(ncst.WSD) ? ncst.WSD : Number(slots.get(nowKey)?.WSD ?? 1),
      hourly,
      grid: { nx, ny },
    },
    { cacheSec: 300 },
  );
});
