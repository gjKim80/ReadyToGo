# ReadyToGo API 프록시 (Vercel)

브라우저에서 기상청·NAVER REST API를 직접 부르면 **CORS 차단 + 키 노출**이 발생한다.
그래서 이 폴더의 서버리스 함수가 키를 들고 대신 호출하고, 앱이 기대하는 형태로 정규화해 돌려준다.

| 엔드포인트 | 데이터 원본 | 필요한 키 | 상태 |
| --- | --- | --- | --- |
| `GET /api/directions` | NAVER Directions 5 | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 구현 완료 |
| `GET /api/weather` | 기상청 단기예보 | `KMA_SERVICE_KEY` | 구현 완료 |
| `GET /api/places` | NAVER Geocoding (+지역검색) | `NAVER_CLIENT_ID/SECRET` (+`NAVER_SEARCH_*`) | 구현 완료 |
| `GET /api/transit` | ODsay 대중교통 길찾기 + 서울 지하철/TAGO 버스 실시간 오버레이 | `ODSAY_API_KEY` (+선택 `SEOUL_SUBWAY_API_KEY`, `TAGO_SERVICE_KEY`) | 구현 완료 |
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

### 4. 대중교통 경로 (ODsay)
1. https://lab.odsay.com 회원가입 → **API 관리** → 애플리케이션 등록
2. **대중교통 길찾기**(`searchPubTransPathT`) 사용 설정 → API Key 복사
3. 무료 플랜은 일 1,000회. 웹 서비스 URL 등록이 필요할 수 있다.

```bash
vercel env add ODSAY_API_KEY production
```

ODsay는 경로(승차 정류장·환승·하차 정류장)만 주고 **실시간 도착시각은 주지 않는다.**
아래 두 키가 없으면 도착 목록은 배차간격 기반 예정 시각(`live: false`)으로 폴백한다.

### 5. 지하철 실시간 도착 (서울 열린데이터광장)
1. https://data.seoul.go.kr 회원가입 → **실시간 지하철 인증키 신청** (일반 인증키 아님, 별도 항목)
2. ODsay가 준 승차역 이름으로 조회하므로 **서울 지하철에서만** 동작한다(수도권 타 지자체 역은 폴백).

```bash
vercel env add SEOUL_SUBWAY_API_KEY production
```

### 6. 버스 실시간 도착 (TAGO, 공공데이터포털)
1. https://www.data.go.kr 에서 "국토교통부_(TAGO)_버스도착정보"와 **"국토교통부_(TAGO)_버스정류소정보"
   둘 다** 활용신청한다 — 좌표로 정류소(nodeId)를 찾은 뒤 그 정류소의 도착정보를 조회하는 2단계라
   두 데이터셋이 모두 승인되어 있어야 한다.
2. 승인 상태는 마이페이지 > 개발계정 > **활용신청 현황**에서 확인. "승인" 전에는 호출이
   `403 Forbidden`으로 막힌다(일부 TAGO 데이터셋은 자동승인이 아니라 며칠 걸릴 수 있다).

```bash
vercel env add TAGO_SERVICE_KEY production
```

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
