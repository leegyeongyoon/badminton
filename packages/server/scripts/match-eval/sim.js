// 자동 편성 상황별 시뮬레이터 — 로컬 서버의 실제 엔진·API(suggest·replan-stale·assign)를 그대로 쓰고,
// DB 시각을 1분씩 뒤로 밀어 시간 흐름을 만든다. 운영판 자동 편성(대기 게임 목표 수, 4명 모두 쉬는 맨 위 판 투입,
// 투입 직전 다시 짜기)을 흉내 내고, 시나리오의 사건(도착·퇴장·휴식·레슨·요청·운영진 수정)을 넣는다.
// 필요: 로컬 DB(docker badminton-db) + 로컬 서버(localhost:3100) + 시드 데이터(김대표 계정·모임·시설).
const { execSync } = require('child_process');

const B = process.env.API || 'http://localhost:3100/api/v1';
const CLUB = 'cc2112ad-3e60-45e3-9b3d-a2307359d7c6';
const FACILITY = 'cf36ec5f-d6a8-4cbd-aa19-7d52e1bd79d1';
const SK = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const LV = ['', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];

const sql = (q) =>
  execSync(`docker exec badminton-db psql -U badminton -d badminton -At -c "${q.replace(/"/g, '\\"')}"`).toString().trim();

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * sc: { name, courts, minutes, pop: ['MS','FA',...] (도착 순서), arrivals: [[분, 명수], ...] (합 = pop 길이),
 *       events?: [{ t, type: 'leave'|'rest'|'back'|'lesson'|'unlesson'|'together'|'apart', who: [pop 인덱스] }],
 *       operatorEditEvery?: 분(AI 대기 게임 하나에서 한 명을 쉬는 사람으로 바꿈), longGames?: 비율 }
 */
async function runScenario(sc, seed = 1) {
  const drnd = rng(seed * 104729 + 7);
  const ornd = rng(seed * 7919 + 13);
  const gauss = () => Math.sqrt(-2 * Math.log(drnd() + 1e-9)) * Math.cos(2 * Math.PI * drnd());
  const login = await (await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '01000000002', password: 'password123' }),
  })).json();
  const T = login.tokens.accessToken;
  const api = async (m, p, b) => {
    const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  };
  const act = await api('GET', `/clubs/${CLUB}/sessions/active`);
  if (act?.id) await api('POST', `/club-sessions/${act.id}/end`);
  const sid = (await api('POST', `/clubs/${CLUB}/sessions`, { facilityId: FACILITY, courtCount: sc.courts })).id;
  await api('PUT', `/club-sessions/${sid}/auto-settings`, {});
  const board = (await api('POST', `/club-sessions/${sid}/game-board`)).id;
  const cs = await api('GET', `/club-sessions/${sid}/courts`);
  const courts = (Array.isArray(cs) ? cs : cs.courts).map((c) => c.id);
  const players = async () => { const pl = await api('GET', `/club-sessions/${sid}/players`); return Array.isArray(pl) ? pl : pl.players; };
  const shift = () => sql(`
    update "ClubSession" set "startedAt"="startedAt"-interval '1 minute' where id='${sid}';
    update "CheckIn" set "checkedInAt"="checkedInAt"-interval '1 minute', "restingAt"="restingAt"-interval '1 minute', "checkedOutAt"="checkedOutAt"-interval '1 minute' where "clubSessionId"='${sid}';
    update "CourtTurn" set "startedAt"="startedAt"-interval '1 minute', "completedAt"="completedAt"-interval '1 minute', "createdAt"="createdAt"-interval '1 minute' where "clubSessionId"='${sid}';
    update "Game" g set "createdAt"=g."createdAt"-interval '1 minute', "updatedAt"=g."updatedAt"-interval '1 minute' from "CourtTurn" t where t.id=g."turnId" and t."clubSessionId"='${sid}';
    update "GameBoardEntry" set "createdAt"="createdAt"-interval '1 minute' where "boardId"='${board}';
    update "SessionRequest" set "createdAt"="createdAt"-interval '1 minute' where "clubSessionId"='${sid}';`);

  const roster = []; // pop 인덱스 → userId
  const info = {}; // userId → { g, s, idx }
  const arrive = {}; const left = {};
  const state = {}; // userId → 'rest' | 'lesson' | undefined
  let popIdx = 0;
  const admit = async (n, t) => {
    await api('POST', `/club-sessions/${sid}/guests/bulk-random`, { count: n });
    const fresh = (await players()).map((p) => p.userId).filter((id) => arrive[id] == null).sort();
    for (const id of fresh) {
      const v = sc.pop[popIdx];
      sql(`update "PlayerProfile" set gender='${v[0]}', "skillLevel"='${v[1]}' where "userId"='${id}'`);
      roster[popIdx] = id;
      info[id] = { g: v[0], s: SK[v[1]], idx: popIdx };
      arrive[id] = t;
      popIdx++;
    }
  };

  const onCourt = new Map(); // courtId → { ids, start, dur, teamSplit }
  const hist = {}; // userId → [{ s, e }]
  const lastEnd = {};
  const waitRun = {}; const maxWait = {}; // 쉴 수 있는 상태로 판 없이 보낸 분(휴식·레슨은 멈춤)
  const availMin = {}; // 칠 수 있었던 분(휴식·레슨·퇴장 제외) — 판수 공평 기준
  const games = []; // { t, ids, teamSplit }
  const requests = { together: [], apart: [] };
  const violations = { assignedUnavailable: [], apartBroken: 0 };
  let unfairB2b = 0; const unfairLog = [];
  let emptyCourtMin = 0, replanned = 0, opEdits = 0, swapped = 0;
  const suggestMs = [];
  const pending = []; // 코트에서 치는 중이라 미룬 사건
  const edited = new Set(); const madeAt = {};

  const available = (id) => arrive[id] != null && left[id] == null && !state[id];
  const busyIds = () => new Set([...onCourt.values()].flatMap((g) => g.ids));

  const applyEvent = async (ev, t) => {
    const ids = ev.who.map((i) => roster[i]).filter(Boolean);
    if (ids.length < ev.who.length) return false; // 아직 안 옴
    if (ev.type === 'together' || ev.type === 'apart') {
      await api('POST', `/club-sessions/${sid}/requests`, { kind: ev.type === 'together' ? 'TOGETHER' : 'APART', aId: ids[0], bId: ids[1], games: ev.games ?? null });
      requests[ev.type].push({ a: ids[0], b: ids[1], games: ev.games ?? null, from: t });
      return true;
    }
    const busy = busyIds();
    if (ids.some((id) => busy.has(id))) return false; // 치는 중에는 판이 끝난 뒤
    for (const id of ids) {
      if (ev.type === 'leave') { await api('POST', `/club-sessions/${sid}/checkout/${id}`); left[id] = t; }
      if (ev.type === 'rest') { sql(`update "CheckIn" set "restingAt"=now() where "clubSessionId"='${sid}' and "userId"='${id}' and "checkedOutAt" is null`); state[id] = 'rest'; }
      if (ev.type === 'back') { sql(`update "CheckIn" set "restingAt"=null where "clubSessionId"='${sid}' and "userId"='${id}' and "checkedOutAt" is null`); delete state[id]; }
      if (ev.type === 'lesson') { await api('PATCH', `/club-sessions/${sid}/players/${id}/lesson`, { inLesson: true }); state[id] = 'lesson'; }
      if (ev.type === 'unlesson') { await api('PATCH', `/club-sessions/${sid}/players/${id}/lesson`, { inLesson: false }); delete state[id]; }
    }
    return true;
  };

  for (let t = 0; t < sc.minutes; t++) {
    for (const [at, n] of sc.arrivals) if (t === at) await admit(n, t);
    // 판 종료
    for (const [c, g] of [...onCourt]) {
      if (t - g.start < g.dur) continue;
      await api('POST', `/courts/${c}/complete-active`);
      for (const id of g.ids) { hist[id].at(-1).e = t; lastEnd[id] = t; }
      onCourt.delete(c);
    }
    // 사건
    for (const ev of (sc.events || []).filter((e) => e.t === t)) if (!(await applyEvent(ev, t))) pending.push(ev);
    for (let i = pending.length - 1; i >= 0; i--) if (await applyEvent(pending[i], t)) pending.splice(i, 1);
    // 운영판 자동 편성: 다시 짜기 → 목표 수만큼 suggest
    const rp = await api('POST', `/club-sessions/${sid}/replan-stale`);
    replanned += rp?.removed || 0; swapped += rp?.swapped || 0;
    const nPeople = Object.keys(arrive).filter((id) => available(id)).length;
    const empty = courts.filter((c) => !onCourt.has(c)).length;
    // 운영판 resolveAutoBuffer('auto')와 같게: 빈 코트 + 코트 수 절반(2~4)만큼 미리
    const ahead = Math.max(2, Math.min(4, Math.ceil(sc.courts / 2)));
    const target = Math.min(Math.ceil(nPeople / 4), empty + ahead);
    let q = (await api('GET', `/club-sessions/${sid}/game-board`)).entries.filter((e) => e.status === 'QUEUED').sort((a, b) => a.queueOrder - b.queueOrder);
    // 빈자리 채우기(운영판 자동 편성이 먼저 하는 일 — 퇴장·휴식으로 3명이 된 판)
    for (const e of q.filter((x) => x.playerIds.length > 0 && x.playerIds.length < 4)) {
      const r = await api('POST', `/club-sessions/${sid}/suggest`, { target: { kind: 'fill', entryId: e.id } });
      const sg = r?.suggestions?.[0];
      if (sg?.playerIds?.length === 4) await api('PATCH', `/game-boards/${board}/entries/${e.id}`, { playerIds: sg.playerIds, note: sg.reason || null, teamSplit: !!sg.teamSplit });
    }
    q = (await api('GET', `/club-sessions/${sid}/game-board`)).entries.filter((e) => e.status === 'QUEUED').sort((a, b) => a.queueOrder - b.queueOrder);
    for (let k = q.filter((e) => e.playerIds.length >= 4).length; k < target; k++) {
      const t0 = Date.now();
      const r = await api('POST', `/club-sessions/${sid}/suggest`, { count: 1 });
      suggestMs.push(Date.now() - t0);
      const sg = r?.suggestions?.[0];
      if (!sg || sg.playerIds.length < 4) break;
      const ne = await api('POST', `/game-boards/${board}/queue`, { playerIds: sg.playerIds, teamSplit: !!sg.teamSplit, note: sg.reason });
      if (ne?.id) madeAt[ne.id] = t;
    }
    q = (await api('GET', `/club-sessions/${sid}/game-board`)).entries.filter((e) => e.status === 'QUEUED').sort((a, b) => a.queueOrder - b.queueOrder);
    // 운영진 수정: AI 판 하나에서 한 명을 판 없이 쉬는 사람으로
    if (sc.operatorEditEvery && t > 0 && t % sc.operatorEditEvery === 0) {
      const busy = busyIds(); const inQ = new Set(q.flatMap((e) => e.playerIds));
      const idle = Object.keys(arrive).filter((id) => available(id) && !busy.has(id) && !inQ.has(id));
      const e = q[Math.floor(ornd() * q.length)];
      if (e && idle.length) {
        const out = e.playerIds[Math.floor(ornd() * e.playerIds.length)];
        const inn = idle.find((id) => info[id].g === info[out].g && Math.abs(info[id].s - info[out].s) <= 1) ?? idle[0];
        await api('PATCH', `/game-boards/${board}/entries/${e.id}`, { playerIds: e.playerIds.map((x) => (x === out ? inn : x)) });
        opEdits++; edited.add(e.id);
        q = (await api('GET', `/club-sessions/${sid}/game-board`)).entries.filter((x) => x.status === 'QUEUED').sort((a, b) => a.queueOrder - b.queueOrder);
      }
    }
    // 빈 코트 → 4명 모두 쉬는(코트에 없는) 맨 위 판, 넣기 직전 다시 짜기(운영판과 같음)
    for (const c of courts) {
      if (onCourt.has(c)) continue;
      const busy = busyIds();
      let qpos = q.findIndex((x) => x.playerIds.length >= 4 && !x.playerIds.some((id) => busy.has(id)));
      if (qpos < 0) { emptyCourtMin++; continue; }
      const rp2 = await api('POST', `/club-sessions/${sid}/replan-stale`);
      if (rp2?.removed) { replanned += rp2.removed; emptyCourtMin++; break; } // 다음 분에 다시 짠 판으로
      if (rp2?.swapped) {
        swapped += rp2.swapped;
        q = (await api('GET', `/club-sessions/${sid}/game-board`)).entries.filter((x) => x.status === 'QUEUED').sort((a, b) => a.queueOrder - b.queueOrder);
        qpos = q.findIndex((x) => x.playerIds.length >= 4 && !x.playerIds.some((id) => busy.has(id)));
        if (qpos < 0) { emptyCourtMin++; continue; }
      }
      const e = q[qpos];
      const a = await api('POST', `/game-boards/${board}/entries/${e.id}/assign`, { courtId: c });
      if (a?.error) { emptyCourtMin++; continue; }
      q = q.filter((x) => x.id !== e.id);
      // 지표: 못 칠 사람 투입 · 떼기 요청 · 쉬던 사람 두고 연속
      for (const id of e.playerIds) if (!available(id)) violations.assignedUnavailable.push({ t, id, why: left[id] != null ? '퇴장' : state[id] });
      for (const r of requests.apart) if (e.playerIds.includes(r.a) && e.playerIds.includes(r.b)) violations.apartBroken++;
      const busy2 = busyIds();
      for (const id of e.playerIds) {
        if (lastEnd[id] == null || t - lastEnd[id] > 1) continue;
        const mine = hist[id]?.length || 0;
        const rester = Object.keys(arrive).find((o) => !e.playerIds.includes(o) && available(o) && !busy2.has(o) &&
          (hist[o]?.length || 0) <= mine && t - Math.max(arrive[o], lastEnd[o] ?? -99) >= 3 &&
          info[o].g === info[id].g && Math.abs(info[o].s - info[id].s) <= 1);
        if (rester) {
          const qi = q.findIndex((x) => x.playerIds.includes(rester));
          const blocked = qi >= 0 && q[qi].playerIds.some((p) => busy2.has(p) || !available(p));
          unfairB2b++;
          unfairLog.push({ t, id, rester, edited: edited.has(e.id), entryPos: qpos, made: madeAt[e.id], restQ: qi < 0 ? '판 없음' : `${qi + 1}번째${blocked ? '(막힘)' : ''}`, restRested: t - Math.max(arrive[rester], lastEnd[rester] ?? -99) });
        }
      }
      const dur = Math.max(7, Math.round(12 + 2.5 * gauss() + (drnd() < (sc.longGames ?? 0.2) ? 5 : 0)));
      onCourt.set(c, { ids: e.playerIds, start: t, dur, teamSplit: !!e.teamSplit });
      games.push({ t, ids: e.playerIds, teamSplit: !!e.teamSplit, edited: edited.has(e.id) });
      for (const id of e.playerIds) (hist[id] ||= []).push({ s: t, e: null });
    }
    // 대기 시간(쉴 수 있는 상태로 판 없이)
    const busyNow = busyIds();
    for (const id of Object.keys(arrive)) {
      if (available(id)) availMin[id] = (availMin[id] || 0) + 1;
      if (!available(id) || busyNow.has(id)) { waitRun[id] = 0; continue; }
      waitRun[id] = (waitRun[id] || 0) + 1;
      maxWait[id] = Math.max(maxWait[id] || 0, waitRun[id]);
    }
    shift();
  }
  await api('POST', `/club-sessions/${sid}/end`);
  return { sc: sc.name, seed, minutes: sc.minutes, courts: sc.courts, info, arrive, left, hist, games, requests, violations, unfairB2b, unfairLog, maxWait, availMin, emptyCourtMin, replanned, swapped, opEdits, suggestMs };
}

module.exports = { runScenario, LV, SK };
