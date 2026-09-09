-- CreateTable
CREATE TABLE "HopkinsAlias" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "hopkinsAffiliateId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'model',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HopkinsAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HopkinsAlias_aliasKey_key" ON "HopkinsAlias"("aliasKey");

-- CreateIndex
CREATE INDEX "HopkinsAlias_hopkinsAffiliateId_idx" ON "HopkinsAlias"("hopkinsAffiliateId");

-- AddForeignKey
ALTER TABLE "HopkinsAlias" ADD CONSTRAINT "HopkinsAlias_hopkinsAffiliateId_fkey" FOREIGN KEY ("hopkinsAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
