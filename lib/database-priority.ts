import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Page reads first, sync second, on the one session an instance holds.
 *
 * DATABASE_POOL_MAX is 1, and pg-pool hands that session out first come, first
 * served. A sync slice runs six ingest workers on the same Fluid instance that
 * serves pages, so a cache refresh for a document page queued behind every
 * worker's transaction and timed out after DATABASE_CONNECT_MS ("timeout
 * exceeded when trying to connect"). Here, work started inside
 * runAsBackgroundDatabaseWork keeps at most one acquisition in pg-pool's queue
 * and holds it back while a page read is waiting, so a page waits for at most
 * the current holder and one sync operation.
 *
 * Only acquisitions are ordered. Queries inside an interactive transaction use
 * the client the transaction already holds, so they never reach this gate and
 * cannot deadlock on it.
 */
const backgroundLane = new AsyncLocalStorage<true>();

/** Sync can wait this long for page reads before it takes its turn anyway. */
export const BACKGROUND_YIELD_MS = 2_000;

export function runAsBackgroundDatabaseWork<T>(run: () => Promise<T>): Promise<T> {
    return backgroundLane.run(true, run);
}

export function isBackgroundDatabaseWork(): boolean {
    return backgroundLane.getStore() === true;
}

export function foregroundFirst<C>(acquire: () => Promise<C>, yieldMs = BACKGROUND_YIELD_MS) {
    let foregroundWaiting = 0;
    let wakers: (() => void)[] = [];
    let backgroundTail: Promise<void> = Promise.resolve();

    function foregroundIdle(): Promise<void> {
        if (foregroundWaiting === 0) return Promise.resolve();
        return new Promise(resolve => {
            const done = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(done, yieldMs);
            wakers.push(done);
        });
    }

    async function foreground(): Promise<C> {
        foregroundWaiting++;
        try { return await acquire(); } finally {
            if (--foregroundWaiting === 0) {
                const waiting = wakers;
                wakers = [];
                for (const wake of waiting) wake();
            }
        }
    }

    async function background(): Promise<C> {
        const previous = backgroundTail;
        let release!: () => void;
        backgroundTail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            await foregroundIdle();
            return await acquire();
        } finally { release(); }
    }

    return {
        connect: () => isBackgroundDatabaseWork() ? background() : foreground(),
        foregroundWaiting: () => foregroundWaiting,
    };
}
