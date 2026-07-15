ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCycleCount" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "referral_bonuses_referrerId_beneficiaryId_key";
CREATE INDEX IF NOT EXISTS "referral_bonuses_referrerId_beneficiaryId_idx"
  ON "referral_bonuses"("referrerId", "beneficiaryId");
