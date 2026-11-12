import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

type Row = Record<string, unknown>;

async function main() {
    let now = Date.now();
    Date.now = () => now;

    const rows = new Map<string, Row>();
    const clone = <T>(value: T): T => structuredClone(value);
    const apply = (row: Row, data: Row) => {
        for (const [key, value] of Object.entries(data)) {
            if (value === Prisma.DbNull) row[key] = null;
            else if (value && typeof value === "object" && "increment" in value) {
                row[key] = (row[key] as number) + (value as { increment: number }).increment;
            } else row[key] = clone(value);
        }
    };
    const leaseFree = (row: Row, where: Row) => {
        if (!where.OR) return true;
        const lease = row.leaseUntil as Date | null;
        const before = ((where.OR as Row[])[1]!.leaseUntil as { lt: Date }).lt;
        return lease === null || lease < before;
    };

    Object.assign(globalThis, { prisma: { syncRun: {
        create: async ({ data }: { data: Row }) => {
            const row: Row = {
                slices: 0, leaseUntil: null, heartbeatAt: new Date(now), startedAt: new Date(now),
                files: null, error: null, finishedAt: null,
            };
            apply(row, data);
            rows.set(data.id as string, row);
            return { startedAt: row.startedAt };
        },
        findMany: async ({ where }: { where: { status: string; id: { not: string } } }) =>
            [...rows.values()].filter((row) => row.status === where.status && row.id !== where.id.not).map(clone),
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
            const row = rows.get(where.id as string);
            if (!row || row.status !== where.status || !leaseFree(row, where)) return { count: 0 };
            apply(row, data);
            return { count: 1 };
        },
        update: async ({ where, data }: { where: { id: string }; data: Row }) => {
            apply(rows.get(where.id)!, data);
            return { id: where.id };
        },
        findUniqueOrThrow: async ({ where }: { where: { id: string } }) => clone(rows.get(where.id)!),
    } } });

    const { isAbandoned, isStalled, runSyncSlice, startSyncRun } = await import("../lib/sync-run");
    type Step = import("../lib/sync-run").Step;
    type Slice = import("../lib/sync-run").Slice;
    type Cursor = { ingest?: { pending: string[]; at: number } };

    const done: string[] = [];
    let hangOn: string | null = null;
    let reached: () => void = () => {};
    const hang = () => {
        reached();
        return new Promise<never>(() => {});
    };
    const nextHang = () => new Promise<void>((resolve) => { reached = resolve; });

    const files: Step = {
        name: "files", label: "Files", needsMs: 15_000, skippable: true,
        run: async (slice: Slice) => {
            const cursor = slice.state as unknown as Cursor;
            cursor.ingest ??= { pending: ["a", "b", "c", "d", "e"], at: 0 };
            while (cursor.ingest.at < cursor.ingest.pending.length) {
                if (!slice.beforeDeadline()) return false;
                const id = cursor.ingest.pending[cursor.ingest.at]!;
                if (slice.takeStuck()) slice.state.skipped.push(id);
                else {
                    if (id === hangOn) await hang();
                    now += 15_000;
                    done.push(id);
                }
                cursor.ingest.at += 1;
                await slice.checkpoint();
            }
            return true;
        },
    };
    const pass: Step = {
        name: "pass", label: "Pass", needsMs: 10_000,
        run: async () => {
            if (hangOn === "pass") await hang();
            now += 5_000;
            done.push("pass");
            return true;
        },
    };
    const model: Step = {
        name: "model", label: "Model", needsMs: 10_000, modelWork: true,
        run: async () => { done.push("model"); return true; },
    };
    const steps = [files, pass, model];
    const row = (id: string) => rows.get(id)!;
    const state = (id: string) => row(id).state as { skipped: string[]; summary: { timings: Record<string, number> } } & Cursor;

    // A run longer than one slice picks up where the last slice checkpointed.
    const run = await startSyncRun("cron", { steps, modelWork: false, exclusive: false });
    assert.equal(await runSyncSlice(run, 40_000, steps), "more");
    assert.deepEqual(done, ["a", "b", "c"], "units start until the budget is spent");
    assert.equal(row(run).step, "files");
    assert.equal(state(run).ingest?.at, 3);
    assert.equal(row(run).leaseUntil, null, "a slice that leaves work releases the run for the next");

    assert.equal(await runSyncSlice(run, 40_000, steps), "finished");
    assert.deepEqual(done, ["a", "b", "c", "d", "e", "pass"], "model work is left to runs that ask for it");
    assert.equal(row(run).status, "success");
    assert.equal(row(run).step, "done");
    assert.equal(row(run).files, null, "the walk is not kept once the run is over");
    assert.equal(row(run).slices, 2);
    assert.equal(state(run).summary.timings.files, 75_000, "time per step adds up across slices");

    // Two invocations never work one run.
    const leased = await startSyncRun("button", { steps, exclusive: false });
    row(leased).leaseUntil = new Date(now + 60_000);
    assert.equal(await runSyncSlice(leased, 40_000, steps), "busy");
    now += 61_000;
    assert.equal(await runSyncSlice(leased, 40_000, steps), "more", "an expired lease means the holder was killed");

    // A file that keeps outlasting the function is retried, then passed over.
    done.length = 0;
    hangOn = "b";
    const killed = await startSyncRun("cron", { steps, modelWork: false, exclusive: false });
    for (let slice = 0; slice < 4; slice += 1) {
        const hung = nextHang();
        void runSyncSlice(killed, 40_000, steps);
        await hung;
        now += 80_000;
    }
    assert.deepEqual(done, ["a"], "the platform killed every slice that reached b");
    while (await runSyncSlice(killed, 40_000, steps) === "more") now += 1_000;
    assert.deepEqual(done, ["a", "c", "d", "e", "pass"]);
    assert.deepEqual(state(killed).skipped, ["b"]);
    assert.equal(row(killed).status, "success");
    assert.match(String(row(killed).error), /Skipped 1 file/);

    // A step with nothing to pass over fails the run instead of looping.
    hangOn = "pass";
    const stuck = await startSyncRun("cron", { steps, modelWork: false, exclusive: false });
    row(stuck).step = "pass";
    for (let slice = 0; slice < 3; slice += 1) {
        const hung = nextHang();
        void runSyncSlice(stuck, 40_000, steps);
        await hung;
        now += 80_000;
    }
    assert.equal(await runSyncSlice(stuck, 40_000, steps), "failed");
    assert.equal(row(stuck).status, "error");
    assert.match(String(row(stuck).error), /pass step did not finish within the time limit after 3 attempts/);
    assert.equal(row(stuck).leaseUntil, null);
    hangOn = null;

    const recovery = await startSyncRun("cron", { summariesOnly: true, exclusive: false });
    assert.equal(row(recovery).step, "model", "summary recovery starts without another Drive crawl");
    const recoverySteps: Step[] = [model, {
        name: "sections", label: "Sections", needsMs: 1, modelWork: true,
        run: async () => { throw new Error("summary recovery must not regenerate sections"); },
    }];
    assert.equal(await runSyncSlice(recovery, 40_000, recoverySteps), "finished");

    // Two triggers at once: the later stands down for the earlier.
    rows.clear();
    const first = await startSyncRun("cron", { steps });
    now += 1;
    const second = await startSyncRun("button", { steps });
    assert.equal(second, first);
    assert.equal(rows.size, 2);
    assert.equal([...rows.values()].filter((r) => r.status === "running").length, 1);

    // Stalled is a lost hand-off; abandoned is one nobody resumed for hours.
    const at = 10 * 60 * 60_000;
    const quiet = { id: "x", startedAt: new Date(0), heartbeatAt: new Date(at - 3 * 60_000), leaseUntil: null };
    assert.ok(isStalled(quiet, at));
    assert.ok(!isStalled({ ...quiet, leaseUntil: new Date(at + 1) }, at), "a live lease is not stalled");
    assert.ok(!isStalled({ ...quiet, heartbeatAt: new Date(at - 30_000) }, at), "a recent checkpoint is not stalled");
    assert.ok(!isAbandoned(quiet, at));
    assert.ok(isAbandoned({ ...quiet, heartbeatAt: new Date(at - 4 * 60 * 60_000) }, at));

    console.log("all sync run checks passed");
}

main().then(() => process.exit(process.exitCode ?? 0), (error) => {
    console.error(error);
    process.exit(1);
});
