import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the component's actual submit handler with controlled requests and
// timers, without a database, model call, or a real 65-second wait.
const source = readFileSync("app/(components)/NaturalLanguageSearch.tsx", "utf8");
const start = source.indexOf("    async function ask(");
const end = source.indexOf("    // The bar", start);
assert.ok(start >= 0 && end > start);
const code = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function main() {
    for (const outcome of ["success", "failure", "timeout"] as const) {
        let answer: unknown;
        let pending = false;
        let reading: unknown;
        let timer: (() => void) | undefined;
        let calls = 0;
        const request = deferred<unknown>();
        const sources = deferred<unknown>();
        const asking = { current: false };
        const ask = runInNewContext(code + String.fromCharCode(10) + "ask", {
            asking,
            NOTHING_READ: null,
            setAnswer: (value: unknown) => { answer = value; },
            setReading: (value: unknown) => { reading = value; },
            setPending: (value: boolean) => { pending = value; },
            askArchive: () => { calls++; return request.promise; },
            askArchiveSources: () => sources.promise,
            unreachableAnswer: () => ({ status: "unavailable" }),
            setTimeout: (callback: () => void, ms: number) => {
                assert.equal(ms, 65_000);
                timer = callback;
                return 1;
            },
            clearTimeout: () => { timer = undefined; },
        }) as (question: string) => Promise<void>;

        const submitted = ask("what motions has aarshi made");
        assert.equal(pending, true);
        await ask("duplicate");
        assert.equal(calls, 1, "duplicate submission is blocked");

        if (outcome === "success") request.resolve({ status: "ready" });
        if (outcome === "failure") request.reject(new Error("network failure"));
        if (outcome === "timeout") timer!();
        await submitted;
        assert.equal(pending, false, "stalled sources must not keep the form pending");
        assert.equal(asking.current, false, "retry is enabled");
        assert.equal(timer, undefined, "timer is cleared");
        assert.equal((answer as { status: string }).status, outcome === "success" ? "ready" : "unavailable");

        sources.resolve([{ id: "late" }]);
        request.resolve({ status: "late" });
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(reading, null, "late progress cannot change finished question");
        assert.notEqual((answer as { status: string }).status, "late", "late answer cannot overwrite timeout");

        await ask("retry");
        assert.equal(calls, 2, "another question can be submitted");
    }
    console.log("all question recovery checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });