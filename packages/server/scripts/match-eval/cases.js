// 결정 단위 테스트 — "이 순간 이 사람들이면 이렇게 짜야 맞다"를 케이스로 정하고, 실제 엔진(/suggest)에 한 번 물어 확인한다.
// 상황(출석·성별·급수·오늘 판수·쉰 시간·치는 중·오늘 같이 친 판·휴식/레슨·설정)을 DB에 바로 심고, 제안 4명을 기대와 비교.
// 규칙마다 급수·성별·인원·판수를 바꾼 변형을 자동으로 붙여 수백 개를 만든다.
//
// 사용(로컬 DB·서버 + 시뮬 모임 1~40):
//   node scripts/match-eval/cases.js [--par 8] [--only 쉬던] [--slot-base 0] [--list]
const { execSync } = require('child_process');

const B = process.env.API || 'http://localhost:3100/api/v1';
const SK = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
const LV = 'SABCDEF';
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const psql = (q) =>
  execSync('docker exec -i badminton-db psql -U badminton -d badminton -At -v ON_ERROR_STOP=1 -f -', { input: q }).toString().trim();
const slot = (i) => ({
  club: `cc2112ad-3e60-45e3-9b3d-${String(i).padStart(12, '0')}`,
  facility: `cf36ec5f-d6a8-4cbd-aa19-${String(i).padStart(12, '0')}`,
});

// ── 케이스 만들기 ─────────────────────────────────────────────
// 사람: { code:'MC', g: 오늘 판수, rest: 마지막 판 끝난 뒤 분, mixed: 그중 혼복 판수, playing: 코트에서 친 지 분, resting, lesson }
const P = (code, o = {}) => ({ code, g: 0, rest: 20, mixed: 0, ...o });
const many = (n, code, o) => Array.from({ length: n }, () => P(code, o));
const cases = [];
// 코트 1개 — 빈 코트가 여럿이면 여러 판이 동시에 시작돼 '다음 한 판'이 하나로 정해지지 않는다(어느 판에 들어가도 공평은 같음).
const add = (rule, name, c) => cases.push({ rule, name: `${rule} · ${name}`, courts: 1, settings: {}, together: [], ...c });

// 결과 판정 도우미 — chosen: 제안된 사람들(케이스 안 번호), people: 케이스 사람 목록.
const lvOf = (p) => SK[p.code[1]];
const gOf = (p) => p.code[0];
const spreadIn = (ps) => (ps.length > 1 ? Math.max(...ps.map(lvOf)) - Math.min(...ps.map(lvOf)) : 0);
const spreadF = (ps) => {
  const v = ps.map((p) => (p.code[1] === 'F' ? 0 : lvOf(p))); // F–E는 2단계
  return ps.length > 1 ? Math.max(...v) - Math.min(...v) : 0;
};

// 1) 쉬던 사람 먼저 — 같은 급수·성별 8명: 방금 끝난 4명 vs 12분 쉰 4명(판수 같음) → 쉰 4명.
for (const g of ['M', 'F'])
  for (const l of LV)
    for (const games of [1, 3, 5])
      add('쉬던 사람 먼저', `${g}${l} 8명 · 판수 ${games}`, {
        people: [...many(4, g + l, { g: games, rest: 0 }), ...many(4, g + l, { g: games, rest: 12 })],
        expect: (ch) => (ch.every((i) => i >= 4 && i < 8) ? null : `쉰 4명이 아님 — 방금 끝난 ${ch.filter((i) => i < 4).length}명 · 그 밖 ${ch.filter((i) => i >= 8).length}명`),
      });

// 2) 판수 적은 사람 먼저 — 같은 급수 8명, 4명은 2판 더 침(쉰 시간 같음) → 덜 친 4명.
for (const g of ['M', 'F'])
  for (const l of LV)
    for (const games of [0, 2, 4])
      add('판수 적은 사람 먼저', `${g}${l} 8명 · ${games}판 vs ${games + 2}판`, {
        people: [...many(4, g + l, { g: games + 2, rest: 10 }), ...many(4, g + l, { g: games, rest: 10 })],
        expect: (ch) => (ch.every((i) => i >= 4 && i < 8) ? null : `덜 친 4명이 아님 — 많이 친 ${ch.filter((i) => i < 4).length}명 · 그 밖 ${ch.filter((i) => i >= 8).length}명`),
      });

// 3) 남복 급수 3단계+ 금지 — 높은 급수 4명 + 3단계 이상 낮은 4명 → 각자끼리 칠 수 있으니 섞으면 안 됨.
//    (출석이 딱 그 4명뿐이면 엔진은 '오늘 편성용 급수'로 같이 치게 둔다 — 아무도 못 치는 것보다 낫다는 운영 판단)
for (let hi = 0; hi < 7; hi++)
  for (let lo = hi + 3; lo < 7; lo++)
    for (const g of ['M'])
      add('남복 3단계+ 금지', `${g}${LV[hi]}×4 + ${g}${LV[lo]}×4`, {
        people: [...many(4, g + LV[hi]), ...many(4, g + LV[lo])],
        expect: (ch, ps) => (spreadF(ch.map((i) => ps[i])) >= 3 ? `급수 폭 ${spreadF(ch.map((i) => ps[i]))}단계 판` : null),
      });

// 4) 여자 C 이하 혼복 3:1 금지 — 여자 1명(C~F) + 남자 6명 → 그 여자가 남자 3명과 한 판이면 안 됨.
for (const wl of 'CDEF')
  for (const ml of 'ABCDE')
    add('여자 C 이하 3:1 금지', `여${wl} 1명 + 남${ml} 6명`, {
      people: [P('F' + wl, { rest: 30 }), ...many(6, 'M' + ml)],
      allowEmpty: true,
      expect: (ch, ps) => (ch.includes(0) && ch.filter((i) => gOf(ps[i]) === 'M').length === 3 ? '여자 1명 + 남자 3명 판' : null),
    });

// 5) 혼복 0% 설정 — 남녀 같은 급수 4명씩 → 남복이나 여복.
for (const ml of 'ABCDE')
  for (const wl of 'ABCDEF')
    add('혼복 0% 설정', `남${ml}×4 + 여${wl}×4`, {
      settings: { mixedRatio: 0 },
      people: [...many(4, 'M' + ml), ...many(4, 'F' + wl)],
      expect: (ch, ps) => (new Set(ch.map((i) => gOf(ps[i]))).size > 1 ? '혼복이 짜짐' : null),
    });

// 6) 남복 F와 D 이상 금지 — 남F 2명 + 남D 이상 2명 + 남F와 맞는 남E 2명 → F와 D 이상이 한 판이면 안 됨.
for (const ml of 'ABCD')
  add('남복 F·D+ 금지', `남F×2 + 남${ml}×2 + 남E×2`, {
    people: [...many(2, 'MF'), ...many(2, 'M' + ml), ...many(2, 'ME')],
    allowEmpty: true,
    expect: (ch, ps) => {
      const m = ch.map((i) => ps[i]);
      return m.some((p) => p.code === 'MF') && m.some((p) => lvOf(p) >= 3) ? '남F와 D 이상이 한 판' : null;
    },
  });

// 7) 휴식·레슨 중인 사람은 안 넣음 — 8명 중 2명 휴식/레슨(가장 오래 쉼, 판수 적음) → 그 둘 제외.
for (const kind of ['resting', 'lesson'])
  for (const l of 'ABCDE')
    for (const g of ['M', 'F'])
      add('휴식·레슨 제외', `${kind === 'resting' ? '휴식' : '레슨'} 2명 · ${g}${l}`, {
        people: [...many(2, g + l, { g: 0, rest: 40, [kind]: true }), ...many(6, g + l, { g: 2, rest: 5 })],
        expect: (ch) => (ch.some((i) => i < 2) ? '휴식·레슨 중인 사람이 들어감' : null),
      });

// 8) 같은 4명 다시 피하기 — 오늘 같은 4명이 이미 2판 같이 침, 비슷한 다른 사람도 4명 있음(판수·쉰 시간 같음).
for (const g of ['M', 'F'])
  for (const l of 'ABCDE')
    add('같은 4명 다시 피하기', `${g}${l} 8명 · 앞 4명 2판 같이`, {
      people: many(8, g + l, { g: 2, rest: 10 }),
      together: [[0, 1, 2, 3], [0, 1, 2, 3], [4, 5, 6, 7], [4, 5, 6, 7]].slice(0, 2).concat([[4, 5], [6, 7]]),
      expect: (ch) => (ch.every((i) => i < 4) ? '오늘 2번 같이 친 4명을 또' : null),
    });

// 9) 외톨이 급수 — 남S 1명 + 남A 3명 + 남C 4명 → 남S는 남A와(남C와 섞지 않음).
for (const restS of [5, 20, 40])
  add('외톨이 급수 짝', `남S 1 + 남A 3 + 남C 4 · 남S ${restS}분 쉼`, {
    people: [P('MS', { rest: restS }), ...many(3, 'MA', { rest: 15 }), ...many(4, 'MC', { rest: 15 })],
    expect: (ch) => (ch.includes(0) && ch.some((i) => i >= 4) ? '남S가 남C와 한 판' : null),
  });

// 10) 오래 기다린 사람은 급수가 애매해도 결국 들어감 — 35분 쉰 남B 1명 + 남D 7명(5분 쉼).
for (const l of 'ABCE')
  add('오래 기다린 사람 넣기', `35분 쉰 남${l} 1명 + 남D 7명`, {
    people: [P('M' + l, { rest: 35 }), ...many(7, 'MD', { rest: 5, g: 2 })],
    allowEmpty: true,
    // 같이 칠 비슷한 급수가 아예 없는 사람 — 오래 기다리면 '오늘 편성용 급수'로 옮겨 결국 넣는다(굶기지 않기).
    expect: (ch) => (ch.includes(0) ? null : '35분 기다린 사람을 또 뺌'),
  });

// 11) 떼기 요청 — 같은 급수 6명, 0·1번은 '같이 안 짜기'(둘이 가장 오래 쉼).
for (const g of ['M', 'F'])
  for (const l of 'ABCDE')
    add('떼기 요청', `${g}${l} 6명 · 0·1번 떼기`, {
      people: [...many(2, g + l, { rest: 30 }), ...many(4, g + l, { rest: 8 })],
      apart: [[0, 1]],
      expect: (ch) => (ch.includes(0) && ch.includes(1) ? '떼기 요청한 둘이 한 판' : null),
    });

// ── 방해꾼 변형 ───────────────────────────────────────────────
// 정답에 영향을 주면 안 되는 사람(대부분 반대 성별, 급수 무작위, 판수 더 많고 방금 끝남)을 4명·8명 섞고 코트 수를 바꿔
// 같은 규칙을 다시 본다 — 출석이 많아져도 규칙이 지켜지는지. 결정적 난수라 매번 같은 케이스.
{
  const baseCases = cases.splice(0);
  let rs = 7;
  const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  for (const c of baseCases) {
    cases.push(c);
    const g0 = c.people[0].code[0];
    const other = g0 === 'M' ? 'F' : 'M';
    const maxG = Math.max(...c.people.map((p) => p.g));
    for (const k of [4, 8])
      for (const v of [1, 2]) {
        const noise = Array.from({ length: k }, () => P((rnd() < 0.75 ? other : g0) + LV[Math.floor(rnd() * 7)], { g: maxG + 3, rest: 0 }));
        cases.push({ ...c, name: `${c.name} · 방해 ${k}명#${v}`, people: [...c.people, ...noise] });
      }
  }
}

// ── 실행 ─────────────────────────────────────────────────────
async function login() {
  const r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '01000000002', password: 'password123' }) });
  return (await r.json()).tokens.accessToken;
}
async function runCase(c, where, T) {
  const api = async (m, p, b) => {
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
  const act = await api('GET', `/clubs/${where.club}/sessions/active`);
  if (act?.id) await api('POST', `/club-sessions/${act.id}/end`);
  const sid = (await api('POST', `/clubs/${where.club}/sessions`, { facilityId: where.facility, courtCount: c.courts })).id;
  await api('PUT', `/club-sessions/${sid}/auto-settings`, c.settings);
  await api('POST', `/club-sessions/${sid}/game-board`);
  const n = c.people.length;
  await api('POST', `/club-sessions/${sid}/guests/bulk-random`, { count: n + 2 });
  const pl = await api('GET', `/club-sessions/${sid}/players`);
  const all = (Array.isArray(pl) ? pl : pl.players).map((p) => p.userId).sort();
  const ids = all.slice(0, n);
  const ghostM = all[n];
  const ghostF = all[n + 1];
  const cs = await api('GET', `/club-sessions/${sid}/courts`);
  const court = (Array.isArray(cs) ? cs : cs.courts)[0].id;
  const U = '0e6f7b42-9785-4fbe-a008-65f6174e5713';
  const q = [];
  const ts = (min) => `now() - interval '${Math.round(min * 60)} seconds'`;
  q.push(`update "ClubSession" set "startedAt"=${ts(150)} where id='${sid}';`);
  q.push(`update "CheckIn" set "checkedInAt"=${ts(150)} where "clubSessionId"='${sid}';`);
  q.push(`update "PlayerProfile" set gender='M', "skillLevel"='C' where "userId"='${ghostM}';`);
  q.push(`update "PlayerProfile" set gender='F', "skillLevel"='C' where "userId"='${ghostF}';`);
  q.push(`update "CheckIn" set "checkedOutAt"=${ts(149)} where "clubSessionId"='${sid}' and "userId" in ('${ghostM}','${ghostF}');`);
  const turn = (players, start, end, status) => {
    const t = `gen_random_uuid()`;
    return `with t as (insert into "CourtTurn"(id,"courtId",position,status,"createdById","clubSessionId","createdAt","startedAt","completedAt") values (${t},'${court}',1,'${status}','${U}','${sid}',${ts(start)},${ts(start)},${end == null ? 'null' : ts(end)}) returning id),
      tp as (insert into "TurnPlayer"(id,"turnId","userId") select gen_random_uuid(), t.id, u from t, unnest(array[${players.map((x) => `'${x}'`).join(',')}]::text[]) u),
      g as (insert into "Game"(id,"turnId","courtId",status,"createdAt","updatedAt") select gen_random_uuid(), t.id, '${court}', '${status === 'PLAYING' ? 'IN_PROGRESS' : 'COMPLETED'}', ${ts(start)}, ${ts(end ?? start)} from t returning id)
      insert into "GamePlayer"(id,"gameId","userId") select gen_random_uuid(), g.id, u from g, unnest(array[${players.map((x) => `'${x}'`).join(',')}]::text[]) u;`;
  };
  c.people.forEach((p, i) => {
    const id = ids[i];
    q.push(`update "PlayerProfile" set gender='${p.code[0]}', "skillLevel"='${p.code[1]}' where "userId"='${id}';`);
    if (p.resting) q.push(`update "CheckIn" set "restingAt"=${ts(10)} where "clubSessionId"='${sid}' and "userId"='${id}';`);
    if (p.lesson) q.push(`update "CheckIn" set "isInLesson"=true where "clubSessionId"='${sid}' and "userId"='${id}';`);
    // 오늘 판수 — 마지막 판이 rest 분 전에 끝나고, 앞 판들은 15분 간격. 혼복 판은 반대 성별 유령 1명과.
    for (let k = 0; k < p.g; k++) {
      const end = p.rest + 15 * k;
      const ghost = p.code[0] === 'M' ? ghostF : ghostM;
      q.push(turn(k < p.mixed ? [id, ghost] : [id], end + 12, end, 'COMPLETED'));
    }
    if (p.playing) q.push(turn([id], p.playing, null, 'PLAYING'));
  });
  // 오늘 같이 친 판(판수 계산엔 영향 없게 유령처럼 짧게 — 같이 든 사람 쌍만 남긴다)
  c.together.forEach((grp, k) => q.push(turn(grp.map((i) => ids[i]), 140 - k * 14, 128 - k * 14, 'COMPLETED')));
  psql(q.join('\n'));
  for (const [a, b] of c.apart ?? []) await api('POST', `/club-sessions/${sid}/requests`, { kind: 'APART', aId: ids[a], bId: ids[b] });
  const r = await api('POST', `/club-sessions/${sid}/suggest`, { count: 1 });
  await api('POST', `/club-sessions/${sid}/end`);
  const sg = r?.suggestions?.[0];
  if (!sg?.playerIds?.length) return c.allowEmpty ? { ok: true, note: '제안 없음(허용)' } : { ok: false, why: `제안 없음 — ${r?.note ?? r?.error ?? ''}`.slice(0, 120) };
  const chosen = sg.playerIds.map((id) => ids.indexOf(id)).filter((i) => i >= 0);
  const why = c.expect(chosen, c.people);
  return { ok: !why, why, chosen: chosen.map((i) => c.people[i].code + i).join(' ') + (why && sg.reason ? ` · ${sg.reason}` : '') };
}

(async () => {
  const only = opt('only');
  const list = cases.filter((c) => !only || c.name.includes(only));
  if (args.includes('--list')) {
    const by = {};
    for (const c of list) by[c.rule] = (by[c.rule] ?? 0) + 1;
    console.log(`케이스 ${list.length}개`, by);
    return;
  }
  const par = Number(opt('par', 8));
  const base = Number(opt('slot-base', 0));
  const T = await login();
  const t0 = Date.now();
  const res = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: par }, async (_, w) => {
      while (next < list.length) {
        const c = list[next++];
        try {
          res.push({ c, ...(await runCase(c, slot(base + w + 1), T)) });
        } catch (e) {
          res.push({ c, ok: false, why: '실행 오류: ' + String(e?.message ?? e).slice(0, 160) });
        }
        process.stdout.write(`\r${res.length}/${list.length} (${Math.round((Date.now() - t0) / 1000)}초)`);
      }
    }),
  );
  console.log('\n');
  const rules = Array.from(new Set(list.map((c) => c.rule)));
  for (const rule of rules) {
    const g = res.filter((x) => x.c.rule === rule);
    const bad = g.filter((x) => !x.ok);
    console.log(`${bad.length ? '❌' : '✅'} ${rule} ${g.length - bad.length}/${g.length}`);
    for (const x of bad.slice(0, 6)) console.log(`     · ${x.c.name}: ${x.why}${x.chosen ? ` (${x.chosen})` : ''}`);
    if (bad.length > 6) console.log(`     · …외 ${bad.length - 6}개`);
  }
  const fail = res.filter((x) => !x.ok).length;
  console.log(`\n${fail ? `❌ ${fail}개 실패` : '✅ 전부 통과'} / ${res.length}개`);
  process.exitCode = fail ? 1 : 0;
})();
