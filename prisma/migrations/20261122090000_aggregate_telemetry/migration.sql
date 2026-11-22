CREATE TABLE "TelemetryHour" (
 "hour" TIMESTAMPTZ NOT NULL, "environment" TEXT NOT NULL, "metric" TEXT NOT NULL,
 "route" TEXT NOT NULL, "source" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "count" BIGINT NOT NULL DEFAULT 0, "errors" BIGINT NOT NULL DEFAULT 0,
 "durationMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
 PRIMARY KEY ("hour","environment","metric","route","source","kind")
);
CREATE TABLE "TelemetryBatch" ("id" TEXT PRIMARY KEY, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX "TelemetryBatch_createdAt_idx" ON "TelemetryBatch" ("createdAt");
