// 결정 순간 재현 — 운영진이 실제로 판을 짠 순간마다 그때 상황(출석·판수·쉰 시간·코트에서 치는 사람·오늘 같이 친 기록)을
// 그대로 심고 엔진에 '다음 한 판'을 물어, 운영진이 고른 4명과 몇 명 겹치는지 잰다. 정모 전체 재현(replay.js)은
// 초반 한 판의 차이가 뒤로 눈덩이처럼 커져 엔진끼리도 45%밖에 안 겹치지만, 이 지표는 그 효과가 없다.
//
// 사용: node scripts/match-eval/decisions.js <replay.json> [--settings s.json] [--par 6] [--slot-base 100] [--out 결과.json] [--limit N]
//   replay.json: [{ name, courts, minutes, people:[{code:'MC', in, out}], games:[{s, e, p:[번호×4]}] }]  (replay_build.py)
const fs = require('fs');
const { sql, prisma, dropSession } = require('./db');

const B = process.env.API || 'http://localhost:3100/api/v1';
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const replays = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const settings = opt('settings') ? JSON.parse(fs.readFileSync(opt('settings'), 'utf8')) : {};
const par = Number(opt('par', 6));
const slotBase = Number(opt('slot-base', 100));
const limit = Number(opt('limit', 1e9));
const slot = (i) => ({
  club: `cc2112ad-3e60-45e3-9b3d-${String(i).padStart(12, '0')}`,
  facility: `cf36ec5f-d6a8-4cbd-aa19-${String(i).padStart(12, '0')}`,
});
const U = '0e6f7b42-9785-4fbe-a008-65f6174e5713';

async function login() {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '01000000002', password: 'password123' }) });
  return (await r.json()).tokens.accessToken;
}
const mkApi = (T) => async (m, p, b) => {
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }, body: b ? JSON.stringify(b) : undefined });
      const t = await r.text();
      try { return JSON.parse(t); } catch { return t; }
    } catch (e) {
      if (tries >= 3) throw e;
      await new Promise((res) => setTimeout(res, 400 * (tries + 1)));
    }
  }
};

// 결정 하나: rp 의 games[k](운영진이 T=games[k].s 분에 짠 판)를 재현.
async function decide(rp, k, where, api) {
  const g0 = rp.games[k];
  const T = g0.s;
  const playing = rp.games.filter((g, i) => i !== k && g.s <= T && g.e > T);
  const done = rp.games.filter((g, i) => i !== k && g.e <= T);
  const present = rp.people.map((p, i) => i).filter((i) => rp.people[i].in <= T && (rp.people[i].out == null || rp.people[i].out > T));
  const courts = Math.max(rp.courts, playing.length + 1);
  const act = await api('GET', `/clubs/${where.club}/sessions/active`);
  if (act?.id) await api('POST', `/club-sessions/${act.id}/end`);
  const sid = (await api('POST', `/clubs/${where.club}/sessions`, { facilityId: where.facility, courtCount: courts })).id;
  await api('PUT', `/club-sessions/${sid}/auto-settings`, settings);
  await api('POST', `/club-sessions/${sid}/game-board`);
  const n = rp.people.length;
  await api('POST', `/club-sessions/${sid}/guests/bulk-random`, { count: n });
  const pl = await api('GET', `/club-sessions/${sid}/players`);
  const ids = (Array.isArray(pl) ? pl : pl.players).map((p) => p.userId).sort();
  const cs = await api('GET', `/club-sessions/${sid}/courts`);
  const courtIds = (Array.isArray(cs) ? cs : cs.courts).map((c) => c.id);
  const ts = (min) => `now() - interval '${Math.round((T - min) * 60)} seconds'`; // 정모 시각 min 분 → 실제 시각
  const q = [];
  q.push(`update "ClubSession" set "startedAt"=${ts(0)} where id='${sid}';`);
  rp.people.forEach((p, i) => {
    q.push(`update "PlayerProfile" set gender='${p.code[0]}', "skillLevel"='${p.code[1]}' where "userId"='${ids[i]}';`);
    if (p.in > T) q.push(`update "CheckIn" set "checkedInAt"=${ts(0)}, "checkedOutAt"=${ts(0)} where "clubSessionId"='${sid}' and "userId"='${ids[i]}';`);
    else q.push(`update "CheckIn" set "checkedInAt"=${ts(p.in)}${p.out != null && p.out <= T ? `, "checkedOutAt"=${ts(p.out)}` : ''} where "clubSessionId"='${sid}' and "userId"='${ids[i]}';`);
  });
  const turn = (g, courtId, status) => {
    const players = g.p.map((i) => `'${ids[i]}'`).join(',');
    const end = status === 'PLAYING' ? 'null' : ts(g.e);
    return `with t as (insert into "CourtTurn"(id,"courtId",position,status,"createdById","clubSessionId","createdAt","startedAt","completedAt") values (gen_random_uuid(),'${courtId}',1,'${status}','${U}','${sid}',${ts(g.s)},${ts(g.s)},${end}) returning id),
      tp as (insert into "TurnPlayer"(id,"turnId","userId") select gen_random_uuid(), t.id, u from t, unnest(array[${players}]::text[]) u),
      g as (insert into "Game"(id,"turnId","courtId",status,"createdAt","updatedAt") select gen_random_uuid(), t.id, '${courtId}', '${status === 'PLAYING' ? 'IN_PROGRESS' : 'COMPLETED'}', ${ts(g.s)}, ${status === 'PLAYING' ? ts(g.s) : ts(g.e)} from t returning id)
      insert into "GamePlayer"(id,"gameId","userId") select gen_random_uuid(), g.id, u from g, unnest(array[${players}]::text[]) u;`;
  };
  for (const g of done) q.push(turn(g, courtIds[0], 'COMPLETED'));
  playing.forEach((g, i) => q.push(turn(g, courtIds[i + 1], 'PLAYING')));
  await sql(q.join('\n'));
  // --pool next2: 운영진이 다음 2판에 넣은 사람(8명)만 후보로 — '누구를 넣나'(차례)는 운영진과 같게 두고 '어떻게 묶나'만 본다.
  const nxt = rp.games.filter((g) => g.s >= T - 0.01).sort((a, b) => a.s - b.s).slice(0, 2);
  const poolSet = new Set(nxt.flatMap((g) => g.p));
  const exclude = opt('pool') === 'next2' ? present.filter((i) => !poolSet.has(i)).map((i) => ids[i]) : undefined;
  const r = await api('POST', `/club-sessions/${sid}/suggest`, { count: 1, ...(exclude ? { exclude } : {}) });
  await api('POST', `/club-sessions/${sid}/end`);
  await dropSession(sid);
  const sg = r?.suggestions?.[0];
  const engine = sg?.playerIds?.map((id) => ids.indexOf(id)).filter((i) => i >= 0) ?? [];
  const overlap = engine.filter((i) => g0.p.includes(i)).length;
  const bestNext2 = Math.max(0, ...nxt.map((g) => engine.filter((i) => g.p.includes(i)).length));
  return { session: rp.name, k, T, present: present.length, playing: playing.length, operator: g0.p, engine, overlap, bestNext2, reason: sg?.reason ?? r?.note ?? null };
}

(async () => {
  const T = await login();
  const api = mkApi(T);
  const jobs = [];
  for (const rp of replays) for (let k = 0; k < rp.games.length; k++) if (rp.games[k].s >= 10) jobs.push([rp, k]); // 정모 첫 10분(아무 기록 없음)은 뺀다
  const list = jobs.slice(0, limit);
  const out = [];
  let next = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: par }, async (_, w) => {
      while (next < list.length) {
        const [rp, k] = list[next++];
        try {
          out.push(await decide(rp, k, slot(slotBase + w + 1), api));
        } catch (e) {
          out.push({ session: rp.name, k, error: String(e?.message ?? e).slice(0, 200) });
        }
        process.stdout.write(`\r${out.length}/${list.length} (${Math.round((Date.now() - t0) / 1000)}초)`);
      }
    }),
  );
  console.log('\n');
  const ok = out.filter((x) => !x.error);
  const errs = out.filter((x) => x.error);
  if (errs.length) console.log(`오류 ${errs.length}개: ${errs[0].error}`);
  const dist = [0, 0, 0, 0, 0];
  for (const x of ok) dist[x.overlap]++;
  const mean = ok.reduce((a, x) => a + x.overlap, 0) / Math.max(1, ok.length);
  console.log(`결정 ${ok.length}개 · 운영진 4명과 겹침 평균 ${mean.toFixed(2)}명 (${((100 * mean) / 4).toFixed(0)}%) · 4명 전부 ${((100 * dist[4]) / ok.length).toFixed(0)}% · 3명+ ${((100 * (dist[3] + dist[4])) / ok.length).toFixed(0)}%`);
  console.log('겹친 인원 분포 0/1/2/3/4명: ' + dist.map((d) => `${((100 * d) / ok.length).toFixed(0)}%`).join(' / '));
  const b2 = ok.map((x) => x.bestNext2 ?? 0);
  console.log(`운영진의 다음 2판 중 더 비슷한 판과 겹침 평균 ${(b2.reduce((a, b) => a + b, 0) / Math.max(1, b2.length)).toFixed(2)}명 · 4명 전부 ${((100 * b2.filter((v) => v === 4).length) / Math.max(1, b2.length)).toFixed(0)}%`);
  const bySess = {};
  for (const x of ok) (bySess[x.session] ||= []).push(x.overlap);
  for (const [s, v] of Object.entries(bySess)) console.log(`  ${s} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}명 (${v.length}결정)`);
  if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(out));
  await prisma.$disconnect();
})();
