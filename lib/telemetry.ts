import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";

type Work = "application" | "sync" | "local";
const work = new AsyncLocalStorage<Work>();
const buckets = new Map<Work, { count: number; errors: number; durationMs: number }>();
let timer: ReturnType<typeof setInterval> | undefined;

/** System totals only: no SQL, parameters, model, URL, user, or request ID. */
export function flushMetrics() {
    for (const [source, totals] of buckets) {
        buckets.delete(source);
        try {
            console.log(JSON.stringify({ metric: "sga.database.v1", source,
                environment: process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : "local",
                ...totals, durationMs: Math.round(totals.durationMs) }));
        } catch { /* Never disrupt application work. */ }
    }
}
export async function measureDatabase<T>(query: () => Promise<T>): Promise<T> {
    if (process.env.TELEMETRY_ENABLED !== "true") return query();
    const source = work.getStore() ?? (process.env.NEXT_RUNTIME ? "application" : "local");
    const start = performance.now();
    let failed = false;
    try { return await query(); }
    catch (error) { failed = true; throw error; }
    finally {
        const bucket = buckets.get(source) ?? { count: 0, errors: 0, durationMs: 0 };
        bucket.count++; bucket.errors += Number(failed); bucket.durationMs += performance.now() - start;
        buckets.set(source, bucket);
        if (!timer) {
            timer = setInterval(flushMetrics, 60_000);
            timer.unref();
            process.once("beforeExit", flushMetrics);
        }
        if (bucket.count >= 100) flushMetrics();
        // Drains before serverless freezing; no request APIs inside data caches.
        try { after(flushMetrics); } catch { /* CLI drains on timer / beforeExit. */ }
    }
}
export function measureSync<T>(fn: () => Promise<T>): Promise<T> {
    return work.run("sync", async () => {
        try { return await fn(); } finally { flushMetrics(); }
    });
}
