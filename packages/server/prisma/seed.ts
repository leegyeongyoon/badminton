import { PrismaClient, SkillLevel } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 30 realistic Korean names with skill levels
const MEMBERS: { name: string; skill: string; gender: string }[] = [
  // S급 (2명)
  { name: '이경윤', skill: 'S', gender: 'M' },
  { name: '박서준', skill: 'S', gender: 'M' },
  // A급 (4명)
  { name: '김민재', skill: 'A', gender: 'M' },
  { name: '정유진', skill: 'A', gender: 'F' },
  { name: '최동현', skill: 'A', gender: 'M' },
  { name: '한지민', skill: 'A', gender: 'F' },
  // B급 (6명)
  { name: '오승우', skill: 'B', gender: 'M' },
  { name: '장미란', skill: 'B', gender: 'F' },
  { name: '윤성호', skill: 'B', gender: 'M' },
  { name: '배수진', skill: 'B', gender: 'F' },
  { name: '임재현', skill: 'B', gender: 'M' },
  { name: '서예린', skill: 'B', gender: 'F' },
  // C급 (6명)
  { name: '강태우', skill: 'C', gender: 'M' },
  { name: '조은비', skill: 'C', gender: 'F' },
  { name: '신동욱', skill: 'C', gender: 'M' },
  { name: '문지영', skill: 'C', gender: 'F' },
  { name: '홍기훈', skill: 'C', gender: 'M' },
  { name: '나현주', skill: 'C', gender: 'F' },
  // D급 (6명)
  { name: '권도윤', skill: 'D', gender: 'M' },
  { name: '유하은', skill: 'D', gender: 'F' },
  { name: '안성민', skill: 'D', gender: 'M' },
  { name: '전소희', skill: 'D', gender: 'F' },
  { name: '송재원', skill: 'D', gender: 'M' },
  { name: '황미정', skill: 'D', gender: 'F' },
  // E급 (4명)
  { name: '노영수', skill: 'E', gender: 'M' },
  { name: '구혜원', skill: 'E', gender: 'F' },
  { name: '백준호', skill: 'E', gender: 'M' },
  { name: '탁소연', skill: 'E', gender: 'F' },
  // F급 (2명)
  { name: '추민석', skill: 'F', gender: 'M' },
  { name: '피유정', skill: 'F', gender: 'F' },
];

async function main() {
  console.log('Seeding database...');

  const password = await bcrypt.hash('password123', 10);

  // Create facility admin
  const admin = await prisma.user.create({
    data: { phone: '01000000001', password, name: '관리자', role: 'FACILITY_ADMIN' },
  });

  // Create club leaders
  const leader1 = await prisma.user.create({
    data: { phone: '01000000002', password, name: '김대표', role: 'CLUB_LEADER' },
  });
  const leader2 = await prisma.user.create({
    data: { phone: '01000000003', password, name: '박회장', role: 'CLUB_LEADER' },
  });

  // Create admin + leader profiles
  await prisma.playerProfile.create({
    data: { userId: admin.id, skillLevel: 'B', preferredGameTypes: ['DOUBLES'], gender: 'M' },
  });
  await prisma.playerProfile.create({
    data: { userId: leader1.id, skillLevel: 'A', preferredGameTypes: ['DOUBLES'], gender: 'M' },
  });
  await prisma.playerProfile.create({
    data: { userId: leader2.id, skillLevel: 'B', preferredGameTypes: ['DOUBLES', 'MIXED_DOUBLES'], gender: 'M' },
  });

  // Create 30 players
  const players = [];
  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const phoneNum = `0100000${(i + 10).toString().padStart(4, '0')}`;
    const p = await prisma.user.create({
      data: { phone: phoneNum, password, name: m.name, role: 'PLAYER' },
    });
    await prisma.playerProfile.create({
      data: {
        userId: p.id,
        skillLevel: m.skill as SkillLevel,
        preferredGameTypes: ['DOUBLES'],
        gender: m.gender,
      },
    });
    players.push(p);
  }

  // Create facility
  const facility = await prisma.facility.create({
    data: {
      name: '서울 배드민턴센터',
      address: '서울시 강남구 역삼동 123-45',
      latitude: 37.5013,
      longitude: 127.0396,
      admins: { create: { userId: admin.id } },
      policy: { create: {} },
    },
  });

  // Facility-level courts (clubSessionId = null) for the facility-admin dashboard.
  // 정모s do NOT use these — each 정모 owns its OWN courts (created below).
  for (let i = 1; i <= 4; i++) {
    await prisma.court.create({
      data: { name: `코트 ${i}`, facilityId: facility.id },
    });
  }

  // Club A: 번개 배드민턴 (leader1 + 15 players)
  const clubA = await prisma.club.create({
    data: {
      name: '번개 배드민턴',
      inviteCode: 'CLUBAA01',
      members: {
        create: [
          { userId: leader1.id, role: 'LEADER' },
          { userId: admin.id, role: 'LEADER' },
          ...players.slice(0, 15).map((p) => ({ userId: p.id })),
        ],
      },
    },
  });

  // Club B: 주말 셔틀콕 (leader2 + 15 players)
  const clubB = await prisma.club.create({
    data: {
      name: '주말 셔틀콕',
      inviteCode: 'CLUBBB02',
      members: {
        create: [
          { userId: leader2.id, role: 'LEADER' },
          { userId: admin.id, role: 'LEADER' },
          ...players.slice(15).map((p) => ({ userId: p.id })),
        ],
      },
    },
  });

  // Open a facility session
  const facilitySession = await prisma.facilitySession.create({
    data: {
      facilityId: facility.id,
      openedById: admin.id,
      status: 'OPEN',
      note: '시드 세션',
    },
  });

  // ── ACTIVE 정모 for Club A with its OWN courts (코트 1~4) ──
  // Courts belong to THIS 정모 (clubSessionId = sessionA). Another 정모 could have
  // identically-named 코트 1~4 with NO conflict — they never interact.
  const sessionA = await prisma.clubSession.create({
    data: {
      clubId: clubA.id,
      facilityId: facility.id,
      facilitySessionId: facilitySession.id,
      startedById: leader1.id,
      status: 'ACTIVE',
      courtIds: [],
    },
  });
  const courts = [];
  for (let i = 1; i <= 4; i++) {
    const court = await prisma.court.create({
      data: { name: `코트 ${i}`, facilityId: facility.id, clubSessionId: sessionA.id },
    });
    courts.push(court);
  }
  await prisma.clubSession.update({
    where: { id: sessionA.id },
    data: { courtIds: courts.map((c) => c.id) },
  });

  // Check-ins: Club A members are checked into 정모 A (clubSessionId = sessionA)
  // so they fill the 정모's pool; the rest are facility-only check-ins.
  const clubAUserIds = new Set<string>([
    leader1.id,
    ...players.slice(0, 15).map((p) => p.id),
  ]);
  const allUsers = [admin, leader1, leader2, ...players];
  for (const u of allUsers) {
    await prisma.checkIn.create({
      data: {
        userId: u.id,
        facilityId: facility.id,
        ...(clubAUserIds.has(u.id) ? { clubSessionId: sessionA.id } : {}),
      },
    });
  }

  // Court 1 (정모 A): Turn 1 (PLAYING) with game in progress
  const turn1 = await prisma.courtTurn.create({
    data: {
      courtId: courts[0].id,
      position: 1,
      status: 'PLAYING',
      createdById: leader1.id,
      clubSessionId: sessionA.id,
      startedAt: new Date(),
      players: {
        create: [
          { userId: players[0].id },  // 이경윤 S
          { userId: players[2].id },  // 김민재 A
          { userId: players[6].id },  // 오승우 B
          { userId: players[12].id }, // 강태우 C
        ],
      },
    },
  });

  await prisma.game.create({
    data: {
      turnId: turn1.id,
      courtId: courts[0].id,
      status: 'IN_PROGRESS',
      players: {
        create: [
          { userId: players[0].id },
          { userId: players[2].id },
          { userId: players[6].id },
          { userId: players[12].id },
        ],
      },
    },
  });

  await prisma.court.update({
    where: { id: courts[0].id },
    data: { status: 'IN_USE' },
  });

  // Court 1 (정모 A): Turn 2 (WAITING)
  await prisma.courtTurn.create({
    data: {
      courtId: courts[0].id,
      position: 2,
      status: 'WAITING',
      createdById: players[1].id,
      clubSessionId: sessionA.id,
      players: {
        create: [
          { userId: players[1].id },  // 박서준 S
          { userId: players[3].id },  // 정유진 A
          { userId: players[7].id },  // 장미란 B
          { userId: players[13].id }, // 조은비 C
        ],
      },
    },
  });

  // Court 2 (정모 A): Turn 1 (PLAYING)
  const turn2 = await prisma.courtTurn.create({
    data: {
      courtId: courts[1].id,
      position: 1,
      status: 'PLAYING',
      createdById: leader1.id,
      clubSessionId: sessionA.id,
      startedAt: new Date(),
      players: {
        create: [
          { userId: players[4].id },  // 최동현 A
          { userId: players[8].id },  // 윤성호 B
          { userId: players[14].id }, // 신동욱 C
          { userId: players[18].id }, // 권도윤 D
        ],
      },
    },
  });

  await prisma.game.create({
    data: {
      turnId: turn2.id,
      courtId: courts[1].id,
      status: 'IN_PROGRESS',
      players: {
        create: [
          { userId: players[4].id },
          { userId: players[8].id },
          { userId: players[14].id },
          { userId: players[18].id },
        ],
      },
    },
  });

  await prisma.court.update({
    where: { id: courts[1].id },
    data: { status: 'IN_USE' },
  });

  console.log('Seed complete!');
  console.log(`Facility: ${facility.name} (${facility.id})`);
  console.log(`Admin: ${admin.phone} / password123`);
  console.log(`Leader 김대표: ${leader1.phone} / password123 (Club: ${clubA.name})`);
  console.log(`Leader 박회장: ${leader2.phone} / password123 (Club: ${clubB.name})`);
  console.log(`Players: 30명 (${MEMBERS.map((m) => `${m.name}${m.skill}`).join(', ')})`);
  console.log(`Club A invite: CLUBAA01 (16명)`);
  console.log(`Club B invite: CLUBBB02 (16명)`);
  console.log(`정모 A (번개 배드민턴): ACTIVE — 자기 코트 1~4`);
  console.log(`  Court 1: IN_USE (이경윤S/김민재A/오승우B/강태우C)`);
  console.log(`  Court 2: IN_USE (최동현A/윤성호B/신동욱C/권도윤D)`);
  console.log(`  Courts 3-4: EMPTY`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
