BEGIN;

CREATE TABLE IF NOT EXISTS "api_rate_limit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "api_rate_limit_pkey" PRIMARY KEY ("key", "windowStart")
);

CREATE INDEX IF NOT EXISTS "api_rate_limit_windowStart_idx" ON "api_rate_limit"("windowStart");

COMMIT;
