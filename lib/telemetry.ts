import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { Metric } from "./telemetry-store";

type Work = "application" | "sync" | "local";
const work = new AsyncLocalStorage<Work>();
const buckets = new Map<string, Metric>();
let pending: { id: string; rows: Metric[]; at: number } | undefined;
let flushing: Promise<boolean> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let cleanupAt = 0;
export const telemetryEnabled = () => process.env.TELEMETRY_ENABLED === "true";

export function recordMetric(metric: "request" | "database" | "daily-browser", route: string, source: string, kind: string, errors = 0, durationMs = 0) {
    if (!telemetryEnabled()) return;
    const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
    const environment = process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : "local";
    const key = JSON.stringify([hour.toISOString(), environment, metric, route, source, kind]);
    const row = buckets.get(key) ?? { hour: hour.toISOString(), environment, metric, route, source, kind, count: 0, errors: 0, durationMs: 0 };
    // A prolonged outage must not grow process memory without bound.
    if (!buckets.has(key) && buckets.size >= 500) return;
    row.count++; row.errors += errors; row.durationMs += durationMs;
    buckets.set(key, row);
    if (!timer) {
        timer = setInterval(() => { void flushMetrics(); }, 60_000); timer.unref();
        process.once("beforeExit", () => { void flushMetrics(); });
    }
    try { after(async () => { await flushMetrics(); }); } catch { /* CLI uses timer / explicit drain. */ }
    if (row.count >= 100) void flushMetrics();
}
export async function flushMetrics(): Promise<boolean> {
    if (flushing) {
        const ok = await flushing;
        return ok && (buckets.size ? flushMetrics() : true);
    }
    flushing = (async () => {
        // Batch IDs identify writes, never visitors. Retries use the same ID.
        if (pending && Date.now() - pending.at > 10 * 60_000) pending = undefined;
        if (!pending && buckets.size) {
            pending = { id: randomUUID(), rows: [...buckets.values()], at: Date.now() };
            buckets.clear();
        }
        if (!pending) return true;
        try {
            const { persistMetrics } = await import("./telemetry-store");
            await persistMetrics(pending.id, pending.rows);
            pending = undefined;
            return true;
        } catch {
            console.warn("Aggregate metrics could not be saved; pending batch retained temporarily.");
            return false;
        }
    })();
    const ok = await flushing;
    flushing = undefined;
    return ok && (buckets.size ? flushMetrics() : true);
}
export async function measureDatabase<T>(query: () => Promise<T>): Promise<T> {
    if (!telemetryEnabled()) return query();
    const source = work.getStore() ?? (process.env.NEXT_RUNTIME ? "application" : "local");
    const start = performance.now();
    let failed = false;
    try { return await query(); }
    catch (error) { failed = true; throw error; }
    finally { recordMetric("database", "all", source, "orm", Number(failed), performance.now() - start); }
}
export function measureSync<T>(fn: () => Promise<T>): Promise<T> {
    return work.run("sync", async () => {
        try { return await fn(); } finally {
            await flushMetrics();
            if (telemetryEnabled() && Date.now() - cleanupAt > 86400000) {
                try {
                    const { pruneMetrics } = await import("./telemetry-store");
                    await pruneMetrics(); cleanupAt = Date.now();
                } catch { console.warn("Aggregate metrics retention cleanup failed."); }
            }
        }
    });
}
