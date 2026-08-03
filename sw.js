/**
 * ReadyToGo 서비스 워커.
 * - 앱 셸: stale-while-revalidate — 캐시로 즉시 띄우고 백그라운드에서 갱신
 * - 그 외 요청: 네트워크 우선(Network First) — 실시간성이 중요
 */

const CACHE = "readytogo-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/css/styles.css",
  "./src/js/main.js",
  "./src/js/store.js",
  "./src/js/util.js",
  "./src/js/api/config.js",
  "./src/js/api/weather.js",
  "./src/js/api/transit.js",
  "./src/js/api/directions.js",
  "./src/js/api/places.js",
  "./src/js/core/departure.js",
  "./src/js/core/advice.js",
  "./src/js/core/share.js",
  "./src/js/core/notify.js",
  "./src/js/core/guidance.js",
  "./src/js/core/track.js",
  "./src/js/ui/components.js",
  "./src/js/ui/icons.js",
  "./src/js/ui/map.js",
  "./src/js/ui/parts.js",
  "./src/js/views/home.js",
  "./src/js/views/route.js",
  "./src/js/views/places.js",
  "./src/js/views/settings.js",
  "./src/js/views/guide.js",
  "./assets/icon.svg",
  "./assets/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 일부 파일이 실패해도 설치는 진행 (addAll은 하나라도 실패하면 전체 실패)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // 외부 API는 그대로 통과

  // 앱 셸 이외(=데이터성 요청)는 네트워크 우선
  const isShell = APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "/")));

  if (!isShell) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // 앱 셸: 캐시를 즉시 응답하고, 네트워크 응답으로 캐시를 갱신해 다음 실행에 반영
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
