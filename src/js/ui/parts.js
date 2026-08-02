/** 화면 간 공유되는 렌더 조각들 (홈 / 경로 상세에서 함께 사용) */

import { SKY_LABEL, skyGlyph } from "../api/weather.js";
import { TRAFFIC_LABEL } from "../api/directions.js";
import { urgency } from "../core/departure.js";
import { adviceSummary } from "../core/advice.js";
import {
  clamp,
  escapeHtml,
  fmtClock,
  fmtDistance,
  fmtDur,
  pad2,
  splitDuration,
} from "../util.js";

/* ---------- 날씨 ---------- */

export function adviceBanners(tips) {
  if (!tips?.length) return "";
  return `<div class="stack">${tips
    .map(
      (tip) => `
      <div class="banner banner--${tip.tone}">
        <span class="banner__icon"><span class="icon icon--${tip.icon}" aria-hidden="true"></span></span>
        <span class="banner__text">${escapeHtml(tip.text)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

/** 날씨 요약 + 준비물 안내를 한 카드에 좌우로 배치한다(안내 쪽이 더 좁게) */
export function weatherAdviceRow(weather, locationLabel, tips) {
  if (!weather) {
    return `<div class="card"><div class="skeleton" style="height:52px"></div></div>`;
  }

  const advice = tips?.length
    ? `<div class="weather-row__divider"></div>
       <div class="weather-row__advice">
         ${tips
           .map(
             (tip) => `
           <div class="banner banner--compact banner--${tip.tone}">
             <span class="banner__icon"><span class="icon icon--${tip.icon}" aria-hidden="true"></span></span>
             <span class="banner__text">${escapeHtml(tip.text)}</span>
           </div>`,
           )
           .join("")}
       </div>`
    : "";

  return `
    <div class="card weather-row">
      <div class="weather-row__weather">
        <span class="weather__glyph">${skyGlyph(weather.sky)}</span>
        <div class="grow">
          <div class="row" style="gap:8px;align-items:baseline">
            <span class="weather__temp">${Math.round(weather.temp)}°</span>
            <span class="badge">${escapeHtml(SKY_LABEL[weather.sky] || "")}</span>
          </div>
          <p class="weather__meta">
            ${escapeHtml(locationLabel)}<br />
            최저 ${Math.round(weather.tempMin)}° | 최고 ${Math.round(weather.tempMax)}°, 강수확률 ${weather.pop}%<br />
            습도 ${weather.humidity}% | 바람 ${weather.windMs}m/s
          </p>
        </div>
      </div>
      ${advice}
    </div>`;
}

/* ---------- 카운트다운 ---------- */

const URGENCY_LABEL = {
  late: "이미 출발했어야 해요",
  urgent: "지금 나가세요!",
  soon: "곧 출발해야 해요",
  normal: "문 앞 출발까지",
};

/** 카운트다운 블록의 정적 골격 — 값은 tickCountdown()이 갱신한다. */
export function countdownBlock(plan, { footNote = "" } = {}) {
  return `
    <div class="countdown" data-countdown>
      <p class="countdown__label" data-cd-label></p>
      <p class="countdown__time" data-cd-time>--:--</p>
      <p class="countdown__depart" data-cd-depart></p>
      <div class="progress"><div class="progress__bar" data-cd-bar style="width:0%"></div></div>
      ${footNote ? `<p class="muted" style="font-size:12.5px;font-weight:600;margin-top:10px">${escapeHtml(footNote)}</p>` : ""}
    </div>`;
}

/**
 * 1초마다 호출되는 카운트다운 갱신.
 * @param {HTMLElement} root  countdownBlock을 포함한 컨테이너
 * @param {string} [normalLabel] "여유" 단계 라벨 대체 문구 — 퇴근처럼 "문 앞"이 아니라
 *   "회사 문을 나서기"가 더 맞는 맥락에서 home.js가 넘겨준다. 안 주면 기본 문구를 쓴다.
 */
export function tickCountdown(root, plan, now = new Date(), normalLabel) {
  const box = root.querySelector("[data-countdown]");
  if (!box || !plan) return;

  // 도착 목표가 없어 "지금 출발"이 기준인 경우: 남은 시간 대신 소요시간/ETA를 강조
  if (plan.immediate) {
    const arriveAt = new Date(now.getTime() + plan.totalSec * 1000);
    box.classList.remove("countdown--urgent", "countdown--soon", "countdown--late");
    box.classList.add("countdown--eta");
    box.querySelector("[data-cd-label]").textContent = "지금 출발하면";
    box.querySelector("[data-cd-time]").innerHTML = `${fmtDur(plan.totalSec)} <small>소요</small>`;
    box.querySelector("[data-cd-depart]").innerHTML =
      `<b>${fmtClock(arriveAt)}</b> 도착 예정 · ${escapeHtml(plan.label)}`;
    box.querySelector("[data-cd-bar]").style.width = "100%";
    return;
  }

  box.classList.remove("countdown--eta");
  const remainMs = plan.leaveAt.getTime() - now.getTime();
  const level = urgency(Math.round(remainMs / 1000));
  const { h, m, s } = splitDuration(remainMs);

  box.classList.toggle("countdown--urgent", level === "urgent");
  box.classList.toggle("countdown--soon", level === "soon");
  box.classList.toggle("countdown--late", level === "late");

  const timeEl = box.querySelector("[data-cd-time]");
  if (level === "late") {
    timeEl.innerHTML = `${h ? `${h}시간 ` : ""}${m}분 <small>지남</small>`;
  } else if (h > 0) {
    timeEl.innerHTML = `${h}<small>시간</small> ${pad2(m)}<small>분</small>`;
  } else {
    timeEl.innerHTML = `${pad2(m)}:${pad2(s)}`;
  }

  const isMoodLabel = level === "normal" && !!normalLabel;
  const labelEl = box.querySelector("[data-cd-label]");
  labelEl.classList.toggle("countdown__label--mood", isMoodLabel);
  labelEl.textContent = isMoodLabel ? `"${normalLabel}"` : URGENCY_LABEL[level];

  const arriveAt = plan.arriveAt;
  box.querySelector("[data-cd-depart]").innerHTML =
    `<b>${fmtClock(plan.leaveAt)}</b> 출발 · ${fmtClock(arriveAt)} 도착 예정`;

  // 1시간 전부터 채워지는 진행 바
  const ratio = clamp(1 - remainMs / (60 * 60 * 1000), 0, 1);
  box.querySelector("[data-cd-bar]").style.width = `${(ratio * 100).toFixed(1)}%`;
}

/* ---------- 노선 배지 (지하철/버스는 이모지 대신 실제 노선 컬러+번호) ---------- */

/**
 * "수도권 2호선" -> "2", "9호선" -> "9", "신분당선" -> "신분" (숫자가 없는 노선은 앞 2글자)
 * @param {{kind:string, label?:string}} info plan 전체를 줘도 되고, 환승 구간처럼 그
 *   구간만의 {kind, label}을 만들어 줘도 된다 — legsList가 구간별 배지를 이렇게 쓴다.
 */
function badgeText(info) {
  const name = info.label || "";
  if (info.kind === "bus") return name.replace(/번$/, "");
  const stripped = name.replace(/^수도권\s*/, "");
  return stripped.match(/^(\d+)호선/)?.[1] || stripped.slice(0, 2);
}

/** 자차/도보는 이모지 그대로, 지하철/버스는 실제 노선 색 배지로 표시한다 */
const NON_TRANSIT_ICON = { walk: "walk", drive: "car" };

function lineBadge(info, { size = "md" } = {}) {
  if (info.kind !== "subway" && info.kind !== "bus") {
    const icon = NON_TRANSIT_ICON[info.kind];
    return icon ? `<span class="icon icon--${icon}" aria-hidden="true"></span>` : info.icon;
  }
  const cls = size === "lg" ? "line-badge line-badge--lg" : "line-badge";
  return `<span class="${cls}" style="background:${escapeHtml(info.color || "#3D5BAB")}">${escapeHtml(badgeText(info))}</span>`;
}

/* ---------- 경로 상세 ---------- */

const LEG_ICON = { walk: "walk", wait: "wait", subway: "subway", bus: "bus", drive: "car" };

/**
 * 구간별 소요시간을 하나의 가로 바에 비례해서 보여준다 — legsList가 각 구간을
 * 세로로 나열하는 "상세"라면, 이건 "전체 중 도보/탑승 비중"을 한눈에 보는 "요약".
 * 구간이 하나뿐이면(예: 마이카 단독) 비교할 게 없어서 생략한다.
 */
export function legsTimeline(plan) {
  const legs = plan.legs.filter((l) => l.sec > 0);
  if (legs.length < 2) return "";

  return `
    <div class="legs-timeline">
      <div class="legs-timeline__labels">
        ${legs
          .map(
            (l) =>
              `<span class="legs-timeline__seg" style="flex-grow:${l.sec}">${LEG_ICON[l.kind] ? `<span class="icon icon--${LEG_ICON[l.kind]}" aria-hidden="true"></span> ` : ""}${fmtDur(l.sec)}</span>`,
          )
          .join("")}
      </div>
      <div class="legs-timeline__bar">
        ${legs.map((l) => `<span class="legs-timeline__fill" data-kind="${l.kind}" style="flex-grow:${l.sec}"></span>`).join("")}
      </div>
    </div>`;
}

export function legsList(plan) {
  return `
    <ul class="legs">
      ${plan.legs
        .map((leg) => {
          const isRideLeg = leg.kind === "subway" || leg.kind === "bus";
          return `
        <li class="leg" data-kind="${leg.kind}">
          <div class="grow">
            <p class="leg__title">${isRideLeg ? `${lineBadge({ kind: leg.kind, color: leg.line?.color, label: leg.line?.name })} ` : ""}${escapeHtml(leg.title)}</p>
            ${leg.sub ? `<p class="leg__sub">${escapeHtml(leg.sub)}</p>` : ""}
          </div>
          <span class="leg__dur">${fmtDur(leg.sec)}</span>
        </li>`;
        })
        .join("")}
    </ul>`;
}

export function planNotes(plan) {
  if (!plan.notes?.length) return "";
  return `<p class="muted" style="font-size:12.5px;font-weight:600;line-height:1.6;margin-top:10px">
    ${plan.notes.map((n) => escapeHtml(n)).join(" · ")}
  </p>`;
}

/**
 * 승차 예정 버스/지하철이 승강장 기준 몇 정거장 전에 있는지 보여주는 라인 시각화.
 * 실시간 도착 문구에서 정거장 수를 못 뽑아낸 경우(배차 추정, 운행종료 등)엔 조용히 생략한다.
 */
export function approachLine(plan) {
  const arrival = plan.meta?.nextArrivals?.[0];
  const away = arrival?.stationsAway;
  if (away === null || away === undefined) return "";

  const MAX = 6;
  const capped = clamp(away, 0, MAX);
  const vehiclePct = ((MAX - capped) / MAX) * 100;
  const boardName = plan.meta?.itinerary?.board?.name || "승차 지점";

  const dots = Array.from({ length: MAX + 1 }, (_, i) => {
    const pct = (i / MAX) * 100;
    const isBoard = i === MAX;
    return `<span class="approach__dot${isBoard ? " approach__dot--board" : ""}" style="left:${pct}%"></span>`;
  }).join("");

  const label =
    away === 0
      ? `${escapeHtml(boardName)} 도착!`
      : `${away > MAX ? `${MAX}+` : away}정거장 전 · ${escapeHtml(boardName)} 방면`;

  return `
    <div class="approach">
      <div class="approach__track">
        ${dots}
        <span class="approach__vehicle" style="left:${vehiclePct}%">${lineBadge(plan, { size: "lg" })}</span>
      </div>
      <p class="approach__label">${label}</p>
    </div>`;
}

/**
 * 도착 정보 스트립 (대중교통 플랜 전용).
 * 지하철은 탑승 예정 열차를 중심으로 앞뒤 2대씩(급행/일반 포함) 보여줘서
 * "이 차를 놓치면/한 대 일찍 타면"을 바로 판단할 수 있게 한다.
 * 버스는 실시간 도착을 제공하는 소스일 때만 '실시간' 배지를 달고,
 * 배차간격으로 계산한 예정 시각은 그렇게 표시한다.
 */
export function liveArrivals(plan) {
  const isSubway = plan.kind === "subway";
  const arrivals = isSubway ? plan.meta?.boardingWindow : plan.meta?.nextArrivals;
  if (!arrivals?.length) return "";
  const line = plan.meta.itinerary.line;
  const isLive = arrivals.some((a) => a.live);

  const chips = isSubway
    ? arrivals
        .map((a) => {
          const rel = a.isChosen ? "탑승 예정" : a.inSec >= 0 ? `${fmtDur(a.inSec)} 후` : `${fmtDur(-a.inSec)} 전`;
          // express가 undefined면 배차간격 추정 열차라 급행/일반을 알 수 없다는 뜻 — 태그를 생략한다
          const tagParts = [];
          if (a.express !== undefined) tagParts.push(a.express ? "급행" : "일반");
          if (a.isLast) tagParts.push("막차");
          const tag = tagParts.length
            ? `<span class="arrival-chip__tag${a.express ? " arrival-chip__tag--express" : ""}${a.isLast ? " arrival-chip__tag--last" : ""}">${tagParts.join(" · ")}</span>`
            : "";
          return `
            <span class="arrival-chip${a.isChosen ? " arrival-chip--chosen" : ""}">
              <span class="arrival-chip__time">${fmtClock(a.at)}</span>
              ${tag}
              <span class="arrival-chip__rel">${rel}</span>
            </span>`;
        })
        .join("")
    : arrivals
        .map((a) => {
          const detail = a.label || a.crowdingLabel;
          return `<span class="chip">${fmtDur(a.inSec)} 후${detail ? ` · ${escapeHtml(detail)}` : ""}</span>`;
        })
        .join("");

  return `
    <div class="card" style="padding:13px 14px">
      <div class="row row--between" style="margin-bottom:8px">
        <span style="font-size:13.5px;font-weight:800;color:${escapeHtml(line.color)}">${escapeHtml(line.name)}</span>
        ${
          isLive
            ? `<span class="badge badge--live"><span class="live-dot"></span>실시간</span>`
            : `<span class="badge badge--warn">배차 기준 예정</span>`
        }
      </div>
      <div class="${isSubway ? "arrival-chips" : "row"}" style="${isSubway ? "" : "gap:8px;flex-wrap:wrap"}">${chips}</div>
    </div>`;
}

/** 이동수단 후보 카드
 * @param {boolean} showDetailCta 카드 안에 "경로 상세 →" 바로가기를 보여줄지 — 이미 경로
 *   상세 화면(route.js)에서 쓰는 경우엔 "지금 보고 있는 화면으로 다시 가기"가 되어
 *   의미가 없으므로 false로 끈다.
 * @param {string} [boardLabel] 버스처럼 "어디서 타는지"부터 알려주고 싶을 때 상단에 얹는 정류장 이름. */
export function optionCard(plan, { selected = false, showDetailCta = true, boardLabel } = {}) {
  const slack = plan.slackSec;
  const badge = plan.late
    ? `<span class="badge badge--live">도착 지연</span>`
    : slack !== null && slack < 5 * 60
      ? `<span class="badge badge--warn">여유 ${fmtDur(Math.max(0, slack))}</span>`
      : slack !== null
        ? `<span class="badge badge--ok">여유 ${fmtDur(slack)}</span>`
        : "";

  // label이 이미 노선명(예: 수도권 2호선/421번)을 보여주므로 여기선 도로 상황만 보충한다
  const traffic = plan.meta?.route ? ` · 도로 ${TRAFFIC_LABEL[plan.meta.route.trafficLevel]}` : "";

  return `
    <button class="option" data-plan="${escapeHtml(plan.id)}" aria-pressed="${selected}">
      ${boardLabel ? `<span class="option__board"><span class="icon icon--bus-stop" aria-hidden="true"></span> ${escapeHtml(boardLabel)}에서 승차</span>` : ""}
      <span class="option__head">
        <span class="option__mode">${lineBadge(plan)} ${escapeHtml(plan.label)}</span>
        ${badge}
        <span class="option__dur">${fmtDur(plan.totalSec)}</span>
      </span>
      <span class="option__desc">
        ${fmtClock(plan.leaveAt)} 출발 → ${fmtClock(plan.arriveAt)} 도착${traffic} · ${fmtDistance(plan.distance)}
      </span>
      ${showDetailCta ? `<span class="option__cta" data-detail-plan="${escapeHtml(plan.id)}">경로 상세 →</span>` : ""}
    </button>`;
}

const KIND_ICON = { subway: "subway", bus: "bus", drive: "car", walk: "walk" };
const KIND_LABEL = { subway: "지하철", bus: "버스", drive: "마이카", walk: "도보" };

/** "🚇 지하철"처럼 아이콘 + 이름을 한 조각으로 — 그룹 헤더/추천 헤더가 함께 쓴다 */
function kindTag(kind) {
  const icon = KIND_ICON[kind] ? `<span class="icon icon--${KIND_ICON[kind]}" aria-hidden="true"></span> ` : "";
  return `${icon}${KIND_LABEL[kind] || kind}`;
}

/** 이동수단 후보를 지하철/버스/마이카/도보로 묶어서 보여준다(플랜 순서는 그대로 유지) */
export function groupedOptionList(plans, selectedId, { showDetailCta = true } = {}) {
  const order = [];
  plans.forEach((p) => {
    if (!order.includes(p.kind)) order.push(p.kind);
  });

  return order
    .map((kind) => {
      const items = plans.filter((p) => p.kind === kind);
      return `
        <p class="section-title" style="margin-top:16px">${kindTag(kind)}</p>
        <div class="stack">
          ${items.map((p) => optionCard(p, { selected: p.id === selectedId, showDetailCta })).join("")}
        </div>`;
    })
    .join("");
}

/** 홈 화면 상단에 "지하철 추천 · 56분"처럼 지금 뽑힌 플랜을 한 줄로 요약한다 */
export function recommendedHeader(plan) {
  return `<p class="section-title section-title--recommend">${kindTag(plan.kind)} 추천 · ${fmtDur(plan.totalSec)}</p>`;
}

const BUS_PAGE_SIZE = 3;

/**
 * 홈 화면의 "다른 교통수단" 목록 — 현재 선택된 플랜은 제외하고 소요시간 짧은 순으로 보여준다.
 * 버스는 노선이 여러 개 몰릴 수 있어 탈 정류장을 먼저 알려주고 3개까지만 보여준 뒤 더보기로 연다.
 * @param {boolean} expandedBus 버스 더보기를 눌러서 전체를 펼친 상태인지
 */
export function otherOptionsList(plans, selectedId, { expandedBus = false, showDetailCta = true } = {}) {
  const others = plans.filter((p) => p.id !== selectedId).sort((a, b) => a.totalSec - b.totalSec);
  if (!others.length) return "";

  const buses = others.filter((p) => p.kind === "bus");
  const rest = others.filter((p) => p.kind !== "bus");
  const visibleBuses = expandedBus ? buses : buses.slice(0, BUS_PAGE_SIZE);
  const hiddenBusCount = buses.length - visibleBuses.length;

  const busSection = buses.length
    ? `
      <p class="section-title" style="margin-top:10px">${kindTag("bus")}</p>
      <div class="stack">
        ${visibleBuses
          .map((p) =>
            optionCard(p, {
              selected: p.id === selectedId,
              showDetailCta,
              boardLabel: p.meta?.itinerary?.board?.name,
            }),
          )
          .join("")}
      </div>
      ${hiddenBusCount > 0 ? `<button type="button" class="link-btn link-btn--muted" data-act="more-bus" style="margin-top:8px">버스 ${hiddenBusCount}개 더보기</button>` : ""}`
    : "";

  const restSection = rest.length
    ? `
      <div class="stack" style="margin-top:${buses.length ? 10 : 0}px">
        ${rest.map((p) => optionCard(p, { selected: p.id === selectedId, showDetailCta })).join("")}
      </div>`
    : "";

  return `<p class="section-title" style="margin-top:20px">다른 교통수단</p>${busSection}${restSection}`;
}

/* ---------- 위젯 미리보기 ---------- */

/**
 * OS 홈 위젯(WidgetKit/Glance) 대응 카드.
 * 웹에서는 PWA 홈 화면 아이콘 + 이 요약 카드로 동일한 정보를 제공한다.
 */
export function widgetCard({ plan, weather, destName, now = new Date() }) {
  const remain = plan ? Math.round((plan.leaveAt.getTime() - now.getTime()) / 1000) : null;
  const big =
    remain === null
      ? "—"
      : remain < 0
        ? "출발!"
        : remain >= 3600
          ? `${Math.floor(remain / 3600)}시간 ${Math.floor((remain % 3600) / 60)}분`
          : `${Math.max(0, Math.round(remain / 60))}분`;

  return `
    <div class="widget">
      <div class="widget__top">
        <span>ReadyToGo</span>
        <span>${weather ? `${Math.round(weather.temp)}° · ${escapeHtml(adviceSummary(weather))}` : ""}</span>
      </div>
      <p class="widget__big">${escapeHtml(big)}</p>
      <p class="widget__sub">${plan ? `${fmtClock(plan.leaveAt)} 출발 · ${escapeHtml(destName || "")}` : "목적지를 설정하세요"}</p>
      ${
        plan
          ? `<div class="widget__foot">${lineBadge(plan)} ${escapeHtml(plan.label)} · ${fmtDur(plan.totalSec)} · ${fmtClock(plan.arriveAt)} 도착</div>`
          : ""
      }
    </div>`;
}
