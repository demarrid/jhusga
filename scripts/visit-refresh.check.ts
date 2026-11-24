import assert from "node:assert/strict";
import { createVisitRefreshGate, VISIT_REFRESH_GAP_MS } from "../lib/visit-refresh";

function main() {
    const gate = createVisitRefreshGate();
    const now = 1_700_000_000_000;
    assert.equal(gate.start("a", now), "run");
    assert.equal(gate.start("a", now), "skip", "the document already being checked is not started again");
    assert.equal(gate.start("b", now), "skip", "a second document waits until the instance is free");
    gate.finish("b", now);
    assert.equal(gate.start("b", now), "skip", "finishing a document that never started does not clear the slot");
    gate.finish("a", now);
    assert.equal(gate.start("a", now + VISIT_REFRESH_GAP_MS - 1), "skip");
    assert.equal(gate.start("b", now + 1), "run", "a different document can run once the slot is free");
    gate.finish("b", now + 1);
    assert.equal(gate.start("a", now + VISIT_REFRESH_GAP_MS), "run");
    gate.finish("a", now + VISIT_REFRESH_GAP_MS);
    gate.finish("a", now + VISIT_REFRESH_GAP_MS);
    assert.equal(gate.start("c", now + VISIT_REFRESH_GAP_MS), "run", "a second finish does not stick the slot");
    console.log("Visit refresh runs one check at a time and then waits out the gap.");
}

main();
