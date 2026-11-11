CREATE TABLE "whatsapp_sale_draft" (
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "workspaceId" TEXT NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("userId", "workspaceId")
);
