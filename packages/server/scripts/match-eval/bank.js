// 시나리오 은행 일괄 실행 — 실제 정모 출석 구성으로 만든 수백 개 시나리오를 시뮬레이션 모임 여러 개에 나눠 동시에 돌린다.
// 은행 파일(bank.json)은 저장소 밖에서 만든다(운영 데이터 기반, 성별·급수·도착/퇴장 분만 담김).
//
// 사용(로컬 DB·서버 + 시뮬 모임 6개가 있어야 함):
//   node scripts/match-eval/bank.js <bank.json> [--par 6] [--limit 50] [--only real] [--seed 1] [--out 결과.json]
const fs = require('fs');
const { runScenario } = require('./sim');
const { score } = require('./run');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
// --from a.json,b.json: 나눠 돌린 결과 파일들을 합쳐 요약만 출력.
const from = opt('from');
const bank = from ? [] : JSON.parse(fs.readFileSync(args[0], 'utf8'));
const only = opt('only');
// --shard i/n: 여러 서버에 나눠 돌릴 때 i번째 몫만(0부터). --slot-base: 시뮬 모임 번호 시작(서로 겹치지 않게).
const [shardI, shardN] = (opt('shard', '0/1')).split('/').map(Number);
const list = bank
  .filter((s) => !only || new RegExp(only).test(s.name))
  .slice(0, Number(opt('limit', bank.length)))
  .filter((_, i) => i % shardN === shardI);
const slotBase = Number(opt('slot-base', 0));
const par = Number(opt('par', 6));
const seed = Number(opt('seed', 1));
// 시뮬 모임 i(1~6): 모임·체육관 id 끝자리만 다르다.
const slot = (i) => ({
  club: `cc2112ad-3e60-45e3-9b3d-${String(i).padStart(12, '0')}`,
  facility: `cf36ec5f-d6a8-4cbd-aa19-${String(i).padStart(12, '0')}`,
});

(async () => {
  const t0 = Date.now();
  const results = [];
  let next = 0;
  const worker = async (w) => {
    while (next < list.length) {
      const sc = list[next++];
      try {
        const r = await runScenario(sc, seed, slot(slotBase + w));
        const s = score(r);
        await require('./db').dropSession(r.sid); // 시험 정모는 채점 뒤 바로 지운다(DB가 불면 엔진이 느려짐)
        results.push({ name: sc.name, dims: sc.dims, courts: sc.courts, people: sc.pop.length, checks: Object.fromEntries(s.checks.map((c) => [c.k, c.v])), fails: s.checks.filter((c) => !c.ok).map((c) => c.k), info: s.info });
      } catch (e) {
        results.push({ name: sc.name, error: String(e?.message ?? e) });
        console.error(`\n[오류] ${sc.name}: ${String(e?.message ?? e).slice(0, 300)}`);
      }
      process.stdout.write(`\r${results.length}/${list.length} (${Math.round((Date.now() - t0) / 1000)}초)`);
    }
  };
  if (from) for (const f of from.split(',')) results.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
  else await Promise.all(Array.from({ length: par }, (_, i) => worker(i + 1)));
  console.log('');
  const ok = results.filter((r) => !r.error);
  const keys = Object.keys(ok[0]?.checks ?? {});
  console.log(`시나리오 ${ok.length}개 (오류 ${results.length - ok.length}) · 전부 통과 ${ok.filter((r) => !r.fails.length).length}개`);
  for (const k of keys) {
    const vs = ok.map((r) => r.checks[k]);
    const failN = ok.filter((r) => r.fails.includes(k)).length;
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    console.log(`  ${k.padEnd(22)} 평균 ${avg.toFixed(2).padStart(7)} · 미달 ${String(failN).padStart(3)}개`);
  }
  // 조건별 약점 지도 — 차원 값마다 '그 기준을 못 넘은 시나리오 비율'(%).
  const dimKeys = Array.from(new Set(ok.flatMap((r) => Object.keys(r.dims ?? {}))));
  for (const d of dimKeys) {
    console.log(`\n[${d}별 미달 비율 %]`);
    const vals = Array.from(new Set(ok.map((r) => r.dims?.[d]))).sort();
    for (const v of vals) {
      const g = ok.filter((r) => r.dims?.[d] === v);
      const cells = keys.map((k) => Math.round((100 * g.filter((r) => r.fails.includes(k)).length) / g.length));
      const bad = keys.map((k, i) => [k, cells[i]]).filter(([, c]) => c >= 20).map(([k, c]) => `${k} ${c}%`);
      console.log(`  ${String(v).padEnd(14)} n=${String(g.length).padStart(3)} · 전부 통과 ${Math.round((100 * g.filter((r) => !r.fails.length).length) / g.length)}%${bad.length ? ' · ' + bad.join(', ') : ''}`);
    }
  }
  const worst = [...ok].sort((a, b) => b.fails.length - a.fails.length).slice(0, 10);
  console.log('가장 많이 어긴 시나리오:');
  for (const r of worst) console.log(`  ${r.name} (${r.courts}코트·${r.people}명) ${r.fails.join(', ') || '-'}`);
  if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(results));
  await require('./db').prisma.$disconnect();
})();
