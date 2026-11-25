CREATE TABLE "DocumentPeopleExtraction" (
    "documentId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "people" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentPeopleExtraction_pkey" PRIMARY KEY ("documentId"),
    CONSTRAINT "DocumentPeopleExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
