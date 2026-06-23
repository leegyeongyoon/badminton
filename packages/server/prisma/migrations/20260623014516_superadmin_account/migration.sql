-- Seed the single dedicated 최고관리자(SUPER_ADMIN) account.
--
-- The password hash below is a bcrypt hash (10 salt rounds, matching the app's
-- register/auth.service) of the operator's chosen password. The PLAINTEXT
-- password is NEVER stored here — only the irreversible bcrypt hash.
--
-- Idempotent: ON CONFLICT (phone) DO NOTHING so re-running on a DB that already
-- has this account is a no-op (and never overwrites a changed password).
INSERT INTO "User" (id, phone, password, name, role, "isGuest", "isManaged", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  '01067340017',
  '$2a$10$NeHt5Pcvls2RxD9dLrgiNOLMri/BDuH3GEtC.hoUflyiAQ8IcLSba',
  '최고관리자',
  'SUPER_ADMIN',
  false,
  false,
  now(),
  now()
)
ON CONFLICT (phone) DO NOTHING;

-- Mirror how every other user gets a PlayerProfile (auth responses read
-- skillLevel/gender off it). Create one for the super-admin if missing.
INSERT INTO "PlayerProfile" (id, "userId", "preferredGameTypes", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u.id, ARRAY['DOUBLES']::"GameType"[], now(), now()
FROM "User" u
WHERE u.phone = '01067340017'
  AND NOT EXISTS (SELECT 1 FROM "PlayerProfile" p WHERE p."userId" = u.id);