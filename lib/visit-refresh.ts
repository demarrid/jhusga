/** How long one instance waits before it will check the same source again. */
export const VISIT_REFRESH_GAP_MS = 10 * 60_000;

/**
 * One visit-triggered source check at a time, per server instance.
 *
 * A document page already has a database connection open for its cache
 * refresh. The check that follows it used to start immediately, on every
 * visit, and each Fluid instance holds its own Postgres sessions. Prisma
 * Postgres caps those sessions for the `prisma_migration` role, so a reader
 * paging through the archive could exhaust the database. This gate decides
 * before any query: skip when a check is already running, or when this
 * document was checked here recently.
 */
export function createVisitRefreshGate() {
    const recent = new Map<string, number>();
    const running = new Set<string>();

    return {
        start(documentId: string, now: number): "run" | "skip" {
            const at = recent.get(documentId);
            if (at !== undefined && now - at < VISIT_REFRESH_GAP_MS) return "skip";
            if (running.size > 0) return "skip";
            running.add(documentId);
            return "run";
        },
        finish(documentId: string, now: number) {
            if (!running.delete(documentId)) return;
            recent.set(documentId, now);
        },
    };
}

export const visitRefresh = createVisitRefreshGate();
