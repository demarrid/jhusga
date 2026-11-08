CREATE TABLE "DocumentMedia" (
    "versionId" TEXT NOT NULL PRIMARY KEY,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentMedia_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DocumentImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "offset" INTEGER NOT NULL CHECK ("offset" >= 0),
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "alt" TEXT NOT NULL,
    "width" INTEGER NOT NULL CHECK ("width" > 0),
    "height" INTEGER NOT NULL CHECK ("height" > 0),
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    CONSTRAINT "DocumentImage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentMedia"("versionId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DocumentImage_versionId_ordinal_key" ON "DocumentImage"("versionId", "ordinal");
