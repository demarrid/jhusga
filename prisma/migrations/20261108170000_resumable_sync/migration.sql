ALTER TABLE "SyncRun"
    ADD COLUMN "step" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "state" JSONB,
    ADD COLUMN "files" JSONB,
    ADD COLUMN "slices" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");

-- Runs started before steps existed cannot be resumed; the platform cut them off.
UPDATE "SyncRun"
SET "status" = 'error',
    "error" = 'Stopped by the platform time limit before it could finish',
    "finishedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'running';
