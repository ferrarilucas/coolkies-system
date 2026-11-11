ALTER TABLE "user" ADD COLUMN "whatsappPhone" TEXT;
CREATE UNIQUE INDEX "user_whatsappPhone_key" ON "user"("whatsappPhone");

CREATE TABLE "whatsapp_notice" (
    "phone" TEXT PRIMARY KEY,
    "day" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "whatsapp_notice_tokenHash_key" ON "whatsapp_notice"("tokenHash");

CREATE TABLE "whatsapp_customer_choice" (
    "phone" TEXT PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "customerIds" TEXT[] NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL
);
