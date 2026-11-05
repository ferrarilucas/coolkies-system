BEGIN;

DO $$ BEGIN
  CREATE TYPE "PixKeyType" AS ENUM ('CPF', 'CNPJ', 'PHONE', 'EMAIL', 'EVP');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "chargeMessageTemplate" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "chargeSendImage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "pixKeyType" "PixKeyType";
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "pixKey" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "pixRecipientName" TEXT;
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "pixCity" TEXT;

COMMIT;
