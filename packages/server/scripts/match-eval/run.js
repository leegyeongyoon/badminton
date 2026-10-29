// 자동 편성 상황별 시험 — 시나리오마다 실제 엔진으로 정모를 돌리고 기준표로 통과/실패를 매긴다.
// 엔진(gameBoard.service.ts·suggest.algorithm.ts)을 고칠 때마다 전부 돌려 '하나 고치고 하나 망가뜨리기'를 막는다.
//
// 사용(로컬 DB·서버가 떠 있어야 함):
//   node scripts/match-eval/run.js                 # 전체, 시드 1·2
//   node scripts/match-eval/run.js standard40 churn --seeds 1,2,3
//   OUT=결과.json node scripts/match-eval/run.js   # 전후 비교용 원자료 저장
const { runScenario, LV } = require('./sim');

// 급수 분포 문자열 → 도착 순서 섞기(결정적)
const mk = (spec, seed = 1) => {
  const out = [];
  for (const [k, n] of Object.entries(spec)) for (let i = 0; i < n; i++) out.push(k);
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const ALL40 = 'MB,FD,MC,ME,MD,MC,FC,MF,MB,MC,FF,MS,FB,MD,FF,ME,MF,FC,FB,FA,MD,FC,MB,FB,FE,MC,MA,MS,FD,MD,FC,FE,FS,MB,FD,MA,MA,FA,MC,ME'.split(',');

const SCENARIOS = [
  // 기본: 남녀 S~F 14개 급수 전부, 늦게 오는 사람 두 무리
  { name: 'standard40', courts: 6, minutes: 180, pop: ALL40, arrivals: [[0, 24], [15, 10], [30, 6]] },
  // 작은 정모: 코트 2개에 9명(홀수, 쉴 틈이 적음)
  { name: 'small9', courts: 2, minutes: 120, pop: mk({ MB: 2, MC: 2, MD: 1, FC: 2, FD: 2 }, 3), arrivals: [[0, 9]] },
  // 큰 정모: 60명·10코트(엔진 속도)
  { name: 'large60', courts: 10, minutes: 120, pop: [...ALL40, ...mk({ MC: 5, MD: 5, FC: 4, FD: 3, MB: 3 }, 5)], arrivals: [[0, 40], [10, 12], [25, 8]] },
  // 급수 쏠림: C·D 위주에 남S·여S 1명씩, 남F 2명
  { name: 'skewed', courts: 5, minutes: 150, pop: mk({ MC: 8, MD: 7, FC: 4, FD: 4, MS: 1, FS: 1, MF: 2, FE: 1 }, 7), arrivals: [[0, 20], [10, 8]] },
  // 여자 많음
  { name: 'womenHeavy', courts: 4, minutes: 150, pop: mk({ FA: 2, FB: 4, FC: 6, FD: 5, FE: 3, FF: 1, MB: 3, MC: 3, MD: 2, MA: 1 }, 11), arrivals: [[0, 22], [20, 8]] },
  // 들고 남: 중간에 퇴장·휴식·레슨·늦은 도착
  {
    name: 'churn', courts: 5, minutes: 150, pop: mk({ MA: 2, MB: 4, MC: 6, MD: 4, ME: 2, FB: 3, FC: 4, FD: 4, FE: 2, FF: 1 }, 13), arrivals: [[0, 20], [40, 6], [70, 6]],
    events: [
      { t: 30, type: 'rest', who: [2, 3] }, { t: 50, type: 'back', who: [2, 3] },
      { t: 35, type: 'lesson', who: [5] }, { t: 65, type: 'unlesson', who: [5] },
      { t: 60, type: 'leave', who: [0, 1, 7] }, { t: 90, type: 'leave', who: [9, 10, 11] },
      { t: 100, type: 'rest', who: [22] }, { t: 125, type: 'back', who: [22] },
    ],
  },
  // 요청: 함께 쳐 주세요 2쌍(3판씩), 떼어 주세요 2쌍
  {
    name: 'requests', courts: 5, minutes: 120, pop: mk({ MA: 2, MB: 4, MC: 6, MD: 4, FB: 3, FC: 5, FD: 4, FE: 2 }, 17), arrivals: [[0, 30]],
    events: [
      { t: 5, type: 'together', who: [0, 1], games: 3 }, { t: 5, type: 'together', who: [4, 9], games: 3 },
      { t: 5, type: 'apart', who: [2, 3] }, { t: 5, type: 'apart', who: [6, 8] },
    ],
  },
  // 운영진이 AI 판을 자주 고침(6분마다 한 명 교체)
  { name: 'operatorEdits', courts: 5, minutes: 120, pop: mk({ MA: 2, MB: 4, MC: 6, MD: 4, FB: 3, FC: 5, FD: 4, FE: 2 }, 19), arrivals: [[0, 24], [20, 6]], operatorEditEvery: 6 },
];

const eff = (i) => i.s - (i.g === 'F' ? 2 : 0);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * p)] : 0; };
const median = (a) => pct(a, 0.5);

function score(r) {
  const { info, hist, games, minutes } = r;
  const ids = Object.keys(info);
  // 외톨이 급수 — 같은 성별에서 실제 급수 1단계 안에 같이 칠 사람이 아무도 없는 사람(남S 1명뿐 등). 이 사람이 든 판은
  // 급수 차이·팀 힘 차이가 구조적으로 생기므로 엔진 지표에서 빼고 따로 센다. 운영진이 고친 판도 엔진 지표에서 뺀다.
  const lonely = new Set(ids.filter((id) => !ids.some((o) => o !== id && info[o].g === info[id].g && Math.abs(info[o].s - info[id].s) <= 1)));
  const four = new Map(); let unbal = 0, wide = 0, judged = 0, lonelyGames = 0, editedGames = 0;
  for (const g of games) {
    const k = [...g.ids].sort().join('|'); four.set(k, (four.get(k) || 0) + 1);
    const I = g.ids.map((id) => info[id]);
    if (g.edited) { editedGames++; continue; }
    if (g.ids.some((id) => lonely.has(id))) { lonelyGames++; continue; }
    judged++;
    if (g.teamSplit && Math.abs(eff(I[0]) + eff(I[1]) - eff(I[2]) - eff(I[3])) >= 2) {
      unbal++;
      if (process.env.TRACE) console.log(`    ◆ ${g.t}분 팀 힘 차이: ${I.slice(0, 2).map((x) => (x.g === 'F' ? '여' : '남') + LV[x.s]).join('')} vs ${I.slice(2).map((x) => (x.g === 'F' ? '여' : '남') + LV[x.s]).join('')}`);
    }

    // 같은 성별끼리 실제 급수 3단계+ 차이(여F가 든 혼복은 규칙상 허용이라 뺌)
    const hasFWomanMix = I.some((x) => x.g === 'F' && x.s <= 1) && I.some((x) => x.g === 'M');
    const sp = (arr) => (arr.length > 1 ? Math.max(...arr) - Math.min(...arr) : 0);
    if (!hasFWomanMix && Math.max(sp(I.filter((x) => x.g === 'M').map((x) => x.s)), sp(I.filter((x) => x.g === 'F').map((x) => x.s))) >= 3) {
      wide++;
      if (process.env.TRACE) console.log(`    ▲ ${g.t}분 3단계+: ${I.map((x) => (x.g === 'F' ? '여' : '남') + LV[x.s]).join(' ')}`);
    }
  }
  const sameFour = [...four.values()].reduce((a, v) => a + Math.max(0, v - 1), 0);
  const rate = ids.filter((id) => (r.availMin[id] || 0) >= 30).map((id) => ((hist[id]?.length || 0) / r.availMin[id]) * 60);
  const zeroGame = ids.filter((id) => (r.availMin[id] || 0) >= 30 && !(hist[id]?.length)).length;
  const maxWait = Math.max(0, ...Object.values(r.maxWait));
  const p95 = pct(r.suggestMs, 0.95);
  // 함께 요청 달성(요청 뒤 같이 친 판 / 요청 판수)
  const tg = r.requests.together.map((q) => {
    const n = games.filter((g) => g.t >= q.from && g.ids.includes(q.a) && g.ids.includes(q.b)).length;
    return `${n}/${q.games ?? '∞'}`;
  });
  const n = games.length || 1;
  const checks = [
    ['못 칠 사람(휴식·레슨·퇴장) 투입', r.violations.assignedUnavailable.length, (v) => v === 0],
    ['떼기 요청 어김', r.violations.apartBroken, (v) => v === 0],
    ['30분+ 있었는데 0판', zeroGame, (v) => v === 0],
    ['쉬던 사람 두고 연속', r.unfairLog.filter((u) => !u.edited).length, (v) => v <= Math.ceil(minutes / 90)],
    ['최장 대기(분)', maxWait, (v) => v <= 30],
    ['판수 공평(하위10%/중앙값)', +(pct(rate, 0.1) / (median(rate) || 1)).toFixed(2), (v) => v >= 0.8],
    ['같은 4명 다시', sameFour, (v) => v <= Math.max(2, Math.round(n * 0.05))],
    ['팀 힘 차이 2+ 판%', Math.round((unbal / (judged || 1)) * 100), (v) => v <= 6],
    ['같은 성별 3단계+ 판%', Math.round((wide / (judged || 1)) * 100), (v) => v <= 3],
    ['편성 응답 p95(ms)', p95, (v) => v <= 1500],
  ];
  return {
    checks: checks.map(([k, v, ok]) => ({ k, v, ok: ok(v) })),
    info: { 판: games.length, 외톨이급수판: lonelyGames ? `${lonelyGames}(${[...lonely].map((id) => (info[id].g === 'F' ? '여' : '남') + LV[info[id].s]).join('·')})` : '', 운영진수정판: editedGames || '', 빈코트분: r.emptyCourtMin, 다시짠판: r.replanned, 순서바꿈: r.swapped, 운영진수정: r.opEdits, 함께요청: tg.join(' '), 못칠사람: r.violations.assignedUnavailable.map((x) => `${x.t}분 ${x.why}`).join(', ') },
  };
}

(async () => {
  const args = process.argv.slice(2);
  const si = args.indexOf('--seeds');
  const seeds = si >= 0 ? args[si + 1].split(',').map(Number) : [1, 2];
  const names = args.filter((a, i) => !a.startsWith('--') && (si < 0 || i !== si + 1));
  const list = names.length ? SCENARIOS.filter((s) => names.includes(s.name)) : SCENARIOS;
  const raw = [];
  let fails = 0;
  for (const sc of list) {
    for (const seed of seeds) {
      const t0 = Date.now();
      const r = await runScenario(sc, seed);
      const s = score(r);
      raw.push({ sc: sc.name, seed, ...s, games: r.games, players: r.info });
      const bad = s.checks.filter((c) => !c.ok);
      fails += bad.length;
      console.log(`\n■ ${sc.name} (시드 ${seed}, ${sc.courts}코트·${sc.pop.length}명·${sc.minutes}분, ${Math.round((Date.now() - t0) / 1000)}초) ${bad.length ? '❌ ' + bad.length + '개 실패' : '✅ 통과'}`);
      console.log('  ' + s.checks.map((c) => `${c.ok ? '' : '❌'}${c.k} ${c.v}`).join(' · '));
      if (process.env.TRACE) for (const u of r.unfairLog) console.log(`    · ${u.t}분 ${r.info[u.id] ? LV[r.info[u.id].s] : ''} 방금 끝남 → 투입(대기 ${u.entryPos + 1}번째 판, ${u.made ?? '?'}분에 짬${u.edited ? ', 운영진 수정' : ''}) · 쉬던 사람 ${u.restRested}분 쉼, ${u.restQ}`);
      console.log('  ' + Object.entries(s.info).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k} ${v}`).join(' · '));
    }
  }
  if (process.env.OUT) require('fs').writeFileSync(process.env.OUT, JSON.stringify(raw));
  console.log(`\n${fails ? `❌ 기준 미달 ${fails}개` : '✅ 전 시나리오 통과'}`);
  process.exitCode = fails ? 1 : 0;
})();

module.exports = { SCENARIOS, LV };
