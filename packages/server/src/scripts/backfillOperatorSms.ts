import 'dotenv/config';
import { prisma } from '../utils/prisma';
import { sendSms, isSmsEnabled } from '../modules/notification/sms.service';

/**
 * 운영자 신청 승인자(OperatorRequest APPROVED)에게 '1회성' 안내 문자를 보내는 백필 스크립트.
 *
 * 실행:  node dist/src/scripts/backfillOperatorSms.js [dryrun|send]
 *   - dryrun(기본): 대상 명단(전화번호 마스킹)만 출력하고 '발송하지 않는다'.
 *   - send        : 실제 발송. SOLAPI 환경변수가 없으면 중단.
 *
 * 유저 단위로 중복을 제거하고, 전화번호가 있는 사람에게만 보낸다.
 */
const MODE = (process.argv[2] || 'dryrun').toLowerCase();
const TEXT =
  '[콕고] 안녕하세요! 콕고 운영진으로 등록돼 있어요.\n' +
  '정모 운영·순번 관리·자동 편성을 앱에서 바로 쓰실 수 있어요.\n' +
  '▶ badmintoncourt.store';

function normalize(p: string | null | undefined): string {
  return (p || '').replace(/[^0-9]/g, '');
}
function mask(p: string | null | undefined): string {
  const d = normalize(p);
  return d.length >= 8 ? `${d.slice(0, 3)}****${d.slice(-4)}` : '****';
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const reqs = await prisma.operatorRequest.findMany({
    where: { status: 'APPROVED' },
    select: { user: { select: { id: true, name: true, phone: true } } },
  });

  // 같은 사람이 여러 번 승인됐을 수 있으니 유저 단위로 중복 제거.
  const byUser = new Map<string, { id: string; name: string | null; phone: string | null }>();
  for (const r of reqs) if (r.user) byUser.set(r.user.id, r.user);
  const all = [...byUser.values()];

  const withPhone = all.filter((u) => normalize(u.phone).length >= 9);
  const noPhone = all.filter((u) => normalize(u.phone).length < 9);

  console.log(`\n===== 운영자 신청 승인자 백필 (${MODE.toUpperCase()}) =====`);
  console.log(`총 승인자(중복 제거): ${all.length}명`);
  console.log(`전화번호 있음(발송 대상): ${withPhone.length}명`);
  console.log(`전화번호 없음(제외):     ${noPhone.length}명`);
  console.log(`SMS 활성화(SOLAPI 설정): ${isSmsEnabled()}`);
  console.log(`발신번호: ${process.env.SOLAPI_SENDER || '(미설정)'}`);

  console.log('\n--- 발송 대상(전화번호 마스킹) ---');
  withPhone.forEach((u, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${(u.name ?? '(이름없음)').padEnd(10)} ${mask(u.phone)}`),
  );
  if (noPhone.length) {
    console.log('\n--- 번호 없어 제외 ---');
    noPhone.forEach((u) => console.log(`  - ${u.name ?? '(이름없음)'}`));
  }
  console.log('\n--- 발송 문구 ---\n' + TEXT + '\n');

  if (MODE !== 'send') {
    console.log('[DRYRUN] 실제 발송하지 않았습니다. 보내려면 인자 "send" 로 실행하세요.');
    return;
  }
  if (!isSmsEnabled()) {
    console.log('[중단] SOLAPI 미설정 — 발송할 수 없습니다. (SOLAPI_API_KEY/SECRET/SENDER 필요)');
    return;
  }

  let ok = 0;
  let fail = 0;
  const failed: string[] = [];
  for (const u of withPhone) {
    const sent = await sendSms(u.phone as string, TEXT);
    if (sent) ok++;
    else {
      fail++;
      failed.push(`${u.name ?? '?'} ${mask(u.phone)}`);
    }
    await sleep(150); // 과도한 순간 발송량 방지
  }
  console.log(`\n===== 발송 완료: 성공 ${ok} / 실패 ${fail} =====`);
  if (failed.length) console.log('실패 목록: ' + failed.join(', '));
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('[백필 오류]', e);
    await prisma.$disconnect();
    process.exit(1);
  });
