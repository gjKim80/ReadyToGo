# ReadyToGo API 프록시 (Vercel)

브라우저에서 기상청·NAVER REST API를 직접 부르면 **CORS 차단 + 키 노출**이 발생한다.
그래서 이 폴더의 서버리스 함수가 키를 들고 대신 호출하고, 앱이 기대하는 형태로 정규화해 돌려준다.

| 엔드포인트 | 데이터 원본 | 필요한 키 | 상태 |
| --- | --- | --- | --- |
| `GET /api/directions` | NAVER Directions 5 | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 구현 완료 |
| `GET /api/weather` | 기상청 단기예보 | `KMA_SERVICE_KEY` | 구현 완료 |
| `GET /api/places` | NAVER Geocoding (+지역검색) | `NAVER_CLIENT_ID/SECRET` (+`NAVER_SEARCH_*`) | 구현 완료 |
| `GET /api/transit` | ODsay 대중교통 길찾기 | `ODSAY_API_KEY` | 구현 완료(실시간 도착 제외) |
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

ODsay는 경로(승차 정류장·환승·하차 정류장)와 평균 배차간격만 주고 **실시간 도착시각은
주지 않는다.** 그래서 도착 목록은 배차간격 기반 예정 시각이며 `live: false`로 표시되고,
UI도 '실시간' 대신 '배차 기준 예정' 배지를 보여준다. 실시간까지 필요하면 서울 열린데이터광장
또는 TAGO의 정류장 도착정보 API를 추가로 붙여야 한다.

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
