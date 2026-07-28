/**
 * NAVER Maps JS SDK 로더 (지도 렌더링 + geocoder 서브모듈 공용).
 *
 * Directions 5(자차 경로)와 달리 Dynamic Map/Geocoding은 Client ID만으로
 * 브라우저에서 직접 호출하도록 설계된 API라 별도 서버 프록시나 Secret이 필요 없다.
 */

import { config } from "./config.js";

let sdkPromise = null;

/** SDK 스크립트를 최초 1회만 로드하고 이후엔 캐시된 Promise를 반환한다. */
export function loadNaverMapsSdk() {
  if (!config.naverMapClientId) {
    return Promise.reject(new Error("naverMapClientId가 설정되지 않았습니다"));
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (window.naver?.maps?.Service) {
      resolve(window.naver.maps);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${encodeURIComponent(config.naverMapClientId)}&submodules=geocoder`;
    script.async = true;
    script.onload = () => {
      if (window.naver?.maps) resolve(window.naver.maps);
      else reject(new Error("NAVER Maps SDK 로드 실패"));
    };
    script.onerror = () => reject(new Error("NAVER Maps SDK 스크립트 로드 실패"));
    document.head.appendChild(script);
  });

  return sdkPromise;
}

/**
 * 좌표 → 주소 (Reverse Geocoding).
 * geocoder 서브모듈은 지도 SDK에 내장된 클라이언트용 호출이라 CORS/Secret 문제가 없다.
 */
export async function reverseGeocodeNaver(coord) {
  const maps = await loadNaverMapsSdk();

  return new Promise((resolve, reject) => {
    maps.Service.reverseGeocode(
      {
        coords: new maps.LatLng(coord.lat, coord.lng),
        orders: [maps.Service.OrderType.ROAD_ADDR, maps.Service.OrderType.ADDR].join(","),
      },
      (status, response) => {
        if (status !== maps.Service.Status.OK) {
          reject(new Error(`NAVER reverseGeocode 실패 (status=${status})`));
          return;
        }

        const results = response.v2?.results || [];
        // 도로명 주소를 우선하고, 없으면 지번 주소로 대체한다.
        const result = results.find((r) => r.name === "roadaddr") || results[0];
        if (!result) {
          reject(new Error("주소를 찾을 수 없습니다"));
          return;
        }

        const region = result.region || {};
        const areaNames = [region.area1, region.area2, region.area3, region.area4]
          .map((a) => a?.name)
          .filter(Boolean);

        const land = result.land;
        const roadName = land ? [land.name, land.number1, land.number2 ? `-${land.number2}` : ""].filter(Boolean).join(" ").trim() : "";

        resolve({
          name: roadName || `${areaNames[areaNames.length - 1] || "선택 위치"} 인근`,
          address: [...areaNames, roadName].filter(Boolean).join(" "),
          icon: "📍",
        });
      },
    );
  });
}
