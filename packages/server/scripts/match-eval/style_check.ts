// 모임 스타일 학습 점검 — 한 모임의 실제 기록으로 trainClubStyle 을 돌려 걸린 시간·검증 정확도·가중치를 본다.
// 사용: npx ts-node --transpile-only scripts/match-eval/style_check.ts <clubId>
import 'dotenv/config';
import { trainClubStyle, STYLE_FEATURES } from '../../src/modules/gameBoard/clubStyle';
(async () => {
  const t0 = Date.now();
  const s = await trainClubStyle(process.argv[2]);
  console.log('걸린 시간(초)', Math.round((Date.now() - t0) / 1000));
  if (!s) { console.log('null (표본 부족)'); process.exit(0); }
  console.log('결정', s.decisions, '· 검증 정확도', s.testAccuracy, '· 특성', s.traits.join(', '));
  console.log(Object.fromEntries(STYLE_FEATURES.map((f, i) => [f, Math.round(s.stdWeights[i] * 100) / 100])));
  process.exit(0);
})();
