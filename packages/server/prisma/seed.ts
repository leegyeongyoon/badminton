import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const password = await bcrypt.hash('password123', 10);

  // Create facility admin
  const admin = await prisma.user.create({
    data: { phone: '01000000001', password, name: '관리자', role: 'FACILITY_ADMIN' },
  });

  // Create club leaders
  const leader1 = await prisma.user.create({
    data: { phone: '01000000002', password, name: '리더A', role: 'CLUB_LEADER' },
  });
  const leader2 = await prisma.user.create({
    data: { phone: '01000000003', password, name: '리더B', role: 'CLUB_LEADER' },
  });

  // Create players (12 total for 3 turns of 4)
  const players = [];
  for (let i = 1; i <= 12; i++) {
    const phoneNum = `010000001${i.toString().padStart(2, '0')}`;
    const p = await prisma.user.create({
      data: {
        phone: phoneNum,
        password,
        name: `선수${i}`,
        role: 'PLAYER',
      },
    });
    players.push(p);
  }

  // Create player profiles with varying skill levels
  const skillLevels = ['BEGINNER', 'INTERMEDIATE', 'INTERMEDIATE', 'ADVANCED', 'ADVANCED', 'PRO',
    'BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'PRO', 'INTERMEDIATE', 'ADVANCED'] as const;
  const gameTypeOptions = [
    ['DOUBLES'],
    ['DOUBLES', 'MIXED_DOUBLES'],
    ['SINGLES', 'DOUBLES'],
    ['DOUBLES'],
    ['SINGLES'],
    ['DOUBLES', 'MIXED_DOUBLES'],
    ['DOUBLES'],
    ['DOUBLES', 'SINGLES'],
    ['DOUBLES'],
    ['SINGLES', 'DOUBLES', 'MIXED_DOUBLES'],
    ['DOUBLES'],
    ['DOUBLES', 'MIXED_DOUBLES'],
  ] as const;

  for (let i = 0; i < players.length; i++) {
    await prisma.playerProfile.create({
      data: {
        userId: players[i].id,
        skillLevel: skillLevels[i],
        preferredGameTypes: [...gameTypeOptions[i]],
        gender: i % 3 === 0 ? 'F' : 'M',
      },
    });
  }

  // Create profiles for leaders too
  await prisma.playerProfile.create({
    data: { userId: leader1.id, skillLevel: 'ADVANCED', preferredGameTypes: ['DOUBLES'] },
  });
  await prisma.playerProfile.create({
    data: { userId: leader2.id, skillLevel: 'INTERMEDIATE', preferredGameTypes: ['DOUBLES', 'MIXED_DOUBLES'] },
  });

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

  // Create 4 courts
  const courts = [];
  for (let i = 1; i <= 4; i++) {
    const court = await prisma.court.create({
      data: { name: `코트 ${i}`, facilityId: facility.id },
    });
    courts.push(court);
  }

  // Create clubs
  const clubA = await prisma.club.create({
    data: {
      name: '번개 배드민턴',
      inviteCode: 'CLUBAA01',
      members: {
        create: [
          { userId: leader1.id, role: 'LEADER' },
          { userId: players[0].id },
          { userId: players[1].id },
          { userId: players[2].id },
          { userId: players[3].id },
          { userId: players[4].id },
          { userId: players[5].id },
        ],
      },
    },
  });

  const clubB = await prisma.club.create({
    data: {
      name: '주말 셔틀콕',
      inviteCode: 'CLUBBB02',
      members: {
        create: [
          { userId: leader2.id, role: 'LEADER' },
          { userId: players[6].id },
          { userId: players[7].id },
          { userId: players[8].id },
          { userId: players[9].id },
          { userId: players[10].id },
          { userId: players[11].id },
        ],
      },
    },
  });

  // Check in all users at the facility
  const allUsers = [admin, leader1, leader2, ...players];
  for (const u of allUsers) {
    await prisma.checkIn.create({
      data: {
        userId: u.id,
        facilityId: facility.id,
      },
    });
  }

  // Open a facility session
  await prisma.facilitySession.create({
    data: {
      facilityId: facility.id,
      openedById: admin.id,
      status: 'OPEN',
      note: '시드 세션',
    },
  });

  // Court 1: Turn 1 (PLAYING) with game in progress
  const turn1 = await prisma.courtTurn.create({
    data: {
      courtId: courts[0].id,
      position: 1,
      status: 'PLAYING',
      createdById: leader1.id,
      startedAt: new Date(),
      players: {
        create: [
          { userId: leader1.id },
          { userId: players[0].id },
          { userId: players[1].id },
          { userId: players[2].id },
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
          { userId: leader1.id },
          { userId: players[0].id },
          { userId: players[1].id },
          { userId: players[2].id },
        ],
      },
    },
  });

  await prisma.court.update({
    where: { id: courts[0].id },
    data: { status: 'IN_USE' },
  });

  // Court 1: Turn 2 (WAITING)
  await prisma.courtTurn.create({
    data: {
      courtId: courts[0].id,
      position: 2,
      status: 'WAITING',
      createdById: players[3].id,
      players: {
        create: [
          { userId: players[3].id },
          { userId: players[4].id },
          { userId: players[5].id },
          { userId: leader2.id },
        ],
      },
    },
  });

  console.log('Seed complete!');
  console.log(`Facility: ${facility.name} (${facility.id})`);
  console.log(`Admin: ${admin.phone} / password123`);
  console.log(`Leader A: ${leader1.phone} / password123 (Club: ${clubA.id})`);
  console.log(`Leader B: ${leader2.phone} / password123 (Club: ${clubB.id})`);
  console.log(`Players: 01000001001 ~ 01000001012 / password123`);
  console.log(`Club A invite: CLUBAA01`);
  console.log(`Club B invite: CLUBBB02`);
  console.log(`Court 1 (${courts[0].id}): IN_USE with Turn 1 (PLAYING) + Turn 2 (WAITING)`);
  console.log(`Courts 2-4: EMPTY`);
  console.log(`Session: OPEN`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
