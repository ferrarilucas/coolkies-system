-- CreateTable
CREATE TABLE "processed_webhook_event" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_event_pkey" PRIMARY KEY ("id")
);

