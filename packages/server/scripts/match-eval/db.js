// 시험 스크립트용 로컬 DB 직접 연결 — 예전엔 SQL마다 `docker exec psql` 프로세스를 띄웠는데, 케이스·분마다 수천 번이라
// 동시에 돌리면 그 자체가 병목이었다(결정 단위 테스트 3,757개 30분+). 서버와 같은 Prisma로 바로 붙는다.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// 세미콜론으로 끝나는 문장 여러 개를 차례로 실행(값을 돌려받지 않는 update·insert용).
async function sql(text) {
  const stmts = text
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const st of stmts) await prisma.$executeRawUnsafe(st);
}

module.exports = { sql, prisma };

// 시험이 만든 정모 하나를 통째로 지운다(대기판·코트·게임·출석·요청·편성 기록). 게스트 계정은 남긴다(지우기가 느리고 해가 없음).
// 시험 정모를 지우지 않으면 수천 번 돌릴 때 DB가 수십만 줄로 불어 엔진 조회가 크게 느려졌다.
async function dropSession(sid) {
  await sql(`
    delete from "GameBoard" where "clubSessionId"='${sid}';
    delete from "Court" where "clubSessionId"='${sid}';
    delete from "CourtTurn" where "clubSessionId"='${sid}';
    delete from "CheckIn" where "clubSessionId"='${sid}';
    delete from "AutoMatchEdit" where "clubSessionId"='${sid}';
    delete from "ClubSession" where id='${sid}';`);
}
module.exports.dropSession = dropSession;
