/**
 * 장소 검색 / 역지오코딩 어댑터.
 * 실 연동 시 NAVER 지역 검색 + Reverse Geocoding 프록시를 사용한다.
 */

import { config, isMock, proxyGet } from "./config.js";
import { haversine, seededInt, sleep } from "../util.js";

/** 목 POI 데이터셋 (서울/수도권 주요 지점) */
const POIS = [
  { name: "강남역", address: "서울 강남구 강남대로 396", lat: 37.4979, lng: 127.0276, icon: "🚇", category: "지하철역" },
  { name: "서울역", address: "서울 중구 한강대로 405", lat: 37.5547, lng: 126.9707, icon: "🚉", category: "기차역" },
  { name: "홍대입구역", address: "서울 마포구 양화로 160", lat: 37.5568, lng: 126.9237, icon: "🚇", category: "지하철역" },
  { name: "여의도역", address: "서울 영등포구 여의나루로 40", lat: 37.5215, lng: 126.9243, icon: "🚇", category: "지하철역" },
  { name: "잠실역", address: "서울 송파구 올림픽로 265", lat: 37.5133, lng: 127.1001, icon: "🚇", category: "지하철역" },
  { name: "성수역", address: "서울 성동구 아차산로 100", lat: 37.5446, lng: 127.0559, icon: "🚇", category: "지하철역" },
  { name: "판교역", address: "경기 성남시 분당구 판교역로 160", lat: 37.3947, lng: 127.1112, icon: "🚇", category: "지하철역" },
  { name: "광화문광장", address: "서울 종로구 세종대로 172", lat: 37.5726, lng: 126.9769, icon: "🏛️", category: "관광" },
  { name: "코엑스", address: "서울 강남구 영동대로 513", lat: 37.5115, lng: 127.0595, icon: "🏬", category: "복합몰" },
  { name: "더현대 서울", address: "서울 영등포구 여의대로 108", lat: 37.5259, lng: 126.9284, icon: "🏬", category: "백화점" },
  { name: "롯데월드타워", address: "서울 송파구 올림픽로 300", lat: 37.5126, lng: 127.1025, icon: "🗼", category: "관광" },
  { name: "북서울꿈의숲", address: "서울 강북구 월계로 173", lat: 37.6206, lng: 127.0417, icon: "🌳", category: "공원" },
  { name: "서울숲", address: "서울 성동구 뚝섬로 273", lat: 37.5444, lng: 127.0374, icon: "🌳", category: "공원" },
  { name: "한강공원 반포지구", address: "서울 서초구 신반포로11길 40", lat: 37.5100, lng: 126.9959, icon: "🌊", category: "공원" },
  { name: "올림픽공원", address: "서울 송파구 올림픽로 424", lat: 37.5202, lng: 127.1216, icon: "🌳", category: "공원" },
  { name: "남산서울타워", address: "서울 용산구 남산공원길 105", lat: 37.5512, lng: 126.9882, icon: "🗼", category: "관광" },
  { name: "경복궁", address: "서울 종로구 사직로 161", lat: 37.5796, lng: 126.9770, icon: "🏯", category: "관광" },
  { name: "이태원역", address: "서울 용산구 이태원로 177", lat: 37.5345, lng: 126.9946, icon: "🚇", category: "지하철역" },
  { name: "김포공항", address: "서울 강서구 하늘길 112", lat: 37.5586, lng: 126.7944, icon: "✈️", category: "공항" },
  { name: "인천공항 제1터미널", address: "인천 중구 공항로 272", lat: 37.4491, lng: 126.4509, icon: "✈️", category: "공항" },
  { name: "고속터미널역", address: "서울 서초구 신반포로 194", lat: 37.5049, lng: 127.0048, icon: "🚌", category: "터미널" },
  { name: "동대문디자인플라자", address: "서울 중구 을지로 281", lat: 37.5665, lng: 127.0092, icon: "🏛️", category: "전시" },
  { name: "국립중앙박물관", address: "서울 용산구 서빙고로 137", lat: 37.5240, lng: 126.9803, icon: "🏛️", category: "전시" },
  { name: "예술의전당", address: "서울 서초구 남부순환로 2406", lat: 37.4795, lng: 127.0113, icon: "🎭", category: "공연" },
  { name: "세브란스병원", address: "서울 서대문구 연세로 50-1", lat: 37.5622, lng: 126.9410, icon: "🏥", category: "병원" },
  { name: "서울대학교", address: "서울 관악구 관악로 1", lat: 37.4601, lng: 126.9520, icon: "🎓", category: "대학" },
  { name: "연세대학교", address: "서울 서대문구 연세로 50", lat: 37.5665, lng: 126.9388, icon: "🎓", category: "대학" },
  { name: "스타필드 하남", address: "경기 하남시 미사대로 750", lat: 37.5450, lng: 127.2229, icon: "🏬", category: "복합몰" },
  { name: "일산호수공원", address: "경기 고양시 일산동구 호수로 595", lat: 37.6584, lng: 126.7699, icon: "🌳", category: "공원" },
  { name: "수원화성", address: "경기 수원시 팔달구 정조로 910", lat: 37.2856, lng: 127.0119, icon: "🏯", category: "관광" },
];

/** 역지오코딩 목: 좌표 → 구/동 근사 */
const DISTRICTS = [
  { gu: "종로구", dong: "청운효자동", lat: 37.5866, lng: 126.9700 },
  { gu: "중구", dong: "명동", lat: 37.5636, lng: 126.9827 },
  { gu: "용산구", dong: "한남동", lat: 37.5347, lng: 127.0016 },
  { gu: "성동구", dong: "성수동", lat: 37.5445, lng: 127.0557 },
  { gu: "광진구", dong: "자양동", lat: 37.5340, lng: 127.0820 },
  { gu: "동대문구", dong: "회기동", lat: 37.5894, lng: 127.0570 },
  { gu: "성북구", dong: "안암동", lat: 37.5860, lng: 127.0290 },
  { gu: "강북구", dong: "미아동", lat: 37.6265, lng: 127.0257 },
  { gu: "노원구", dong: "상계동", lat: 37.6543, lng: 127.0568 },
  { gu: "은평구", dong: "불광동", lat: 37.6103, lng: 126.9294 },
  { gu: "서대문구", dong: "신촌동", lat: 37.5596, lng: 126.9370 },
  { gu: "마포구", dong: "상암동", lat: 37.5794, lng: 126.8894 },
  { gu: "마포구", dong: "서교동", lat: 37.5533, lng: 126.9200 },
  { gu: "양천구", dong: "목동", lat: 37.5265, lng: 126.8756 },
  { gu: "강서구", dong: "화곡동", lat: 37.5416, lng: 126.8404 },
  { gu: "구로구", dong: "구로동", lat: 37.4954, lng: 126.8874 },
  { gu: "영등포구", dong: "여의도동", lat: 37.5216, lng: 126.9243 },
  { gu: "동작구", dong: "사당동", lat: 37.4765, lng: 126.9816 },
  { gu: "관악구", dong: "봉천동", lat: 37.4784, lng: 126.9516 },
  { gu: "서초구", dong: "서초동", lat: 37.4837, lng: 127.0324 },
  { gu: "강남구", dong: "역삼동", lat: 37.5006, lng: 127.0366 },
  { gu: "송파구", dong: "잠실동", lat: 37.5133, lng: 127.1001 },
  { gu: "강동구", dong: "천호동", lat: 37.5385, lng: 127.1237 },
];

const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

/**
 * 키워드로 장소를 검색한다.
 * @param {string} keyword
 * @param {{near?: {lat:number,lng:number}}} options 근처 좌표 지정 시 거리순 정렬
 */
export async function searchPlaces(keyword, { near, signal } = {}) {
  const q = normalize(keyword);
  if (!q) return [];

  if (!isMock()) {
    try {
      const data = await proxyGet(
        config.endpoints.places,
        { query: keyword, lat: near?.lat, lng: near?.lng },
        { signal },
      );
      return data.items || [];
    } catch (err) {
      console.warn("[places] 프록시 실패 — 목 데이터로 폴백", err);
    }
  }

  await sleep(config.mockLatencyMs);
  const hits = POIS.filter(
    (p) => normalize(p.name).includes(q) || normalize(p.address).includes(q) || normalize(p.category).includes(q),
  );

  return hits
    .map((p) => ({
      ...p,
      id: `poi-${normalize(p.name)}`,
      distance: near ? haversine(near, p) : null,
    }))
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    .slice(0, 12);
}

/** 좌표 → 주소 문자열 (지도 핀 드래그 시 사용) */
export async function reverseGeocode(coord, { signal } = {}) {
  if (!isMock()) {
    try {
      const data = await proxyGet(
        config.endpoints.places,
        { mode: "reverse", lat: coord.lat, lng: coord.lng },
        { signal },
      );
      if (data.address) return data;
    } catch (err) {
      console.warn("[places] 역지오코딩 실패 — 목으로 폴백", err);
    }
  }

  await sleep(80);

  // 반경 250m 내에 알려진 POI가 있으면 그 이름을 그대로 쓴다.
  const nearPoi = POIS.map((p) => ({ p, d: haversine(coord, p) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearPoi && nearPoi.d < 250) {
    return { name: nearPoi.p.name, address: nearPoi.p.address, icon: nearPoi.p.icon };
  }

  const near = DISTRICTS.map((d) => ({ d, dist: haversine(coord, d) })).sort(
    (a, b) => a.dist - b.dist,
  )[0].d;
  const bunji = seededInt(`${coord.lat.toFixed(4)}${coord.lng.toFixed(4)}`, 1, 480);
  const address = `서울 ${near.gu} ${near.dong} ${bunji}`;
  return { name: `${near.dong} 인근`, address, icon: "📍" };
}

/** 브라우저 위치 권한 기반 현재 위치. 거부/실패 시 기본 좌표(서울시청) 반환. */
export function getCurrentPosition({ timeout = 6000 } = {}) {
  const fallback = { lat: 37.5665, lng: 126.9780, approximate: true };
  if (!navigator.geolocation) return Promise.resolve(fallback);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, approximate: false }),
      () => resolve(fallback),
      { timeout, maximumAge: 120000, enableHighAccuracy: false },
    );
  });
}

export const samplePlaces = POIS;
