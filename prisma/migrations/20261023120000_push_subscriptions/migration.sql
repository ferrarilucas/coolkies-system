BEGIN;

CREATE TABLE IF NOT EXISTS "push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_endpoint_key" ON "push_subscription"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscription_userId_idx" ON "push_subscription"("userId");

COMMIT;
