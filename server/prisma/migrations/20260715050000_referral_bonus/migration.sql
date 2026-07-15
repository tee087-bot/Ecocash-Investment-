ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referredById" TEXT;

UPDATE "users"
SET "referralCode" = substring(md5(random()::text || clock_timestamp()::text || "id") from 1 for 12)
WHERE "referralCode" IS NULL;

ALTER TABLE "users" ALTER COLUMN "referralCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_referralCode_key" ON "users"("referralCode");
CREATE INDEX IF NOT EXISTS "users_referredById_idx" ON "users"("referredById");
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey"
  FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "referral_claims" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "bonusCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referral_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "referral_bonuses" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "beneficiaryId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "eligibleAt" TIMESTAMP(3),
  "claimId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "referral_bonuses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_bonuses_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "referral_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "referral_bonuses_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_bonuses_referrerId_beneficiaryId_key" ON "referral_bonuses"("referrerId", "beneficiaryId");
CREATE INDEX IF NOT EXISTS "referral_bonuses_beneficiaryId_status_idx" ON "referral_bonuses"("beneficiaryId", "status");
CREATE INDEX IF NOT EXISTS "referral_bonuses_referrerId_idx" ON "referral_bonuses"("referrerId");
CREATE INDEX IF NOT EXISTS "referral_claims_userId_status_idx" ON "referral_claims"("userId", "status");
