# ReadyToGo API 프록시 (Vercel)

브라우저에서 기상청·NAVER REST API를 직접 부르면 **CORS 차단 + 키 노출**이 발생한다.
그래서 이 폴더의 서버리스 함수가 키를 들고 대신 호출하고, 앱이 기대하는 형태로 정규화해 돌려준다.

| 엔드포인트 | 데이터 원본 | 필요한 키 | 상태 |
| --- | --- | --- | --- |
| `GET /api/directions` | NAVER Directions 5 | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 구현 완료 |
| `GET /api/weather` | 기상청 단기예보 | `KMA_SERVICE_KEY` | 구현 완료 |
| `GET /api/places` | NAVER Geocoding (+지역검색) | `NAVER_CLIENT_ID/SECRET` (+`NAVER_SEARCH_*`) | 구현 완료 |
| `GET /api/transit` | — | — | 미구현(앱 내 추정으로 폴백) |
| `GET /api/health` | — | — | 키 설정/동작 점검용 |

## 키 발급 순서

### 1. NAVER Directions 5 (자차 경로) — 이미 가진 키 사용
지도에 쓰고 있는 NCP Maps 애플리케이션에 **Directions 5**가 체크되어 있어야 한다.
NCP 콘솔 > Maps(AI·NAVER API) > Application > 해당 앱 편집 > Directions 5 선택 후 저장.
Client ID / Client Secret을 그대로 사용한다.

```bash
vercel env add NAVER_CLIENT_ID production
vercel env add NAVER_CLIENT_SECRET production
```

### 2. 기상청 단기예보 (날씨)
1. https://www.data.go.kr 로그인 → "기상청_단기예보 조회서비스" 검색
2. **활용신청** (자동 승인, 일 10,000회) → 마이페이지 > 개발계정 > 일반 인증키 복사
3. 승인 직후에는 키 반영에 최대 1시간이 걸릴 수 있다.

```bash
vercel env add KMA_SERVICE_KEY production
```

### 3. NAVER 지역 검색 (상호명 검색 · 선택)
NCP 키와 **별개**로 https://developers.naver.com 에서 애플리케이션을 등록하고
"검색" API를 추가한다. 없어도 주소 검색은 동작한다.

```bash
vercel env add NAVER_SEARCH_CLIENT_ID production
vercel env add NAVER_SEARCH_CLIENT_SECRET production
```

### 4. 대중교통 경로
공공데이터포털/서울시 API는 "특정 정류장의 실시간 도착"만 제공하고, 출발지→목적지
경로 탐색은 하지 못한다. 실제 길찾기에는 ODsay 같은 별도 API가 필요하다.
현재는 `/api/transit`이 빈 결과를 반환하고 앱이 자체 추정 로직을 사용한다.

## 확인

```bash
# 키가 들어갔는지
curl https://<배포주소>/api/health

# 실제로 호출되는지 (샘플 요청을 서버가 직접 보냄)
curl "https://<배포주소>/api/health?probe=1"
```

## 프런트엔드 연결

`src/js/api/config.js`의 `proxyBase`에 `https://<배포주소>/api`를 넣으면 실 API로 전환된다.
커밋 전에 빠르게 테스트하려면 브라우저 콘솔에서:

```js
localStorage.setItem("rtg:proxyBase", "https://<배포주소>/api");
location.reload();
```

## 로컬 개발

```bash
cp .env.example .env.local   # 값 채우기
vercel dev                   # http://localhost:3000/api/health
```
