import assert from "node:assert/strict";
import { foregroundFirst, runAsBackgroundDatabaseWork } from "../lib/database-priority";

/** One session handed out first come, first served, like pg-pool with max 1. */
function singleSession() {
    let busy = false;
    const queue: ((release: () => void) => void)[] = [];
    const release = () => {
        const next = queue.shift();
        if (next) next(release); else busy = false;
    };
    return () => new Promise<() => void>(resolve => {
        if (!busy) { busy = true; resolve(release); } else queue.push(resolve);
    });
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function main() {
    const order: string[] = [];
    const pool = foregroundFirst(singleSession(), 1_000);
    const hold = async (label: string) => {
        const release = await pool.connect();
        order.push(label);
        await tick();
        release();
    };

    // Six sync workers ask at once, then a page read arrives behind them.
    const sync = runAsBackgroundDatabaseWork(() => Promise.all(
        Array.from({ length: 6 }, (_, i) => hold(`sync-${i}`))));
    await new Promise(resolve => setImmediate(resolve));
    const page = hold("page");
    await Promise.all([sync, page]);
    assert.ok(order.indexOf("page") <= 2,
        `a page read waits for at most the holder and one queued sync acquisition: ${order.join(", ")}`);
    assert.equal(order.length, 7, "every sync worker still runs");

    // A steady stream of page reads cannot hold sync back past the yield.
    const starve = foregroundFirst(singleSession(), 20);
    const started = Date.now();
    let stop = false;
    const pages = (async () => {
        while (!stop) { const release = await starve.connect(); await tick(); release(); }
    })();
    await new Promise(resolve => setTimeout(resolve, 2));
    const release = await runAsBackgroundDatabaseWork(() => starve.connect());
    release();
    stop = true;
    await pages;
    assert.ok(Date.now() - started < 500, "sync takes its turn once the yield has passed");

    // Nothing outside the background lane is held back.
    const plain = foregroundFirst(singleSession(), 1_000);
    (await plain.connect())();
    assert.equal(plain.foregroundWaiting(), 0);
    console.log("Page reads overtake queued sync acquisitions, and sync still runs.");
}

main();
