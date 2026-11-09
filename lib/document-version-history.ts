import type { Prisma } from "@prisma/client";

/** Record an occurrence without duplicating a retry at the same source time. */
export async function recordDocumentVersion(tx: Prisma.TransactionClient, revisionId: string,
    sourceModifiedTime: Date | null, status: "published" | "held") {
    const observedAt = new Date();
    const id = `${revisionId}:${(sourceModifiedTime ?? observedAt).toISOString()}`;
    await tx.documentVersion.upsert({
        where: { id },
        create: { id, revisionId, sourceModifiedTime, observedAt, status },
        // Never downgrade a previously accepted occurrence on a retry.
        update: status === "published" ? { status } : {},
    });
    return id;
}
