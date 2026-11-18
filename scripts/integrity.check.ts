/**
 * Checks the rules `assessChange` applies before publishing a Drive edit.
 *
 * Any edit to a guiding document is held until a Senate meeting record
 * confirms it: the constitution and bylaws are amended by legislation, not by
 * a quiet Drive rewrite, and the archive has no way to tell one from the
 * other. Everything else publishes; `largeRemoval` flags large removals so
 * the page can point at the version before them, except in working documents.
 */
import {
    RATIFICATION_MARKER,
    assessChange,
    heldNotice,
    isGoverning,
    largeRemoval,
} from "../lib/integrity";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const constitutionBefore = [
    "ARTICLE I.",
    "The name of this organisation shall be the Student Government Association.",
    "ARTICLE II.",
    "The Association shall have three branches: executive, legislative, and judicial.",
    "ARTICLE III.",
    "Membership is open to every undergraduate.",
].join("\n");

console.log("isGoverning");
check("the constitution is governing", isGoverning("guiding.constitution"));
check("the bylaws are governing", isGoverning("guiding.bylaws"));
check("a Senate rules bill is not governing", !isGoverning("bill.senate_rules"));
check("minutes are not governing", !isGoverning("minutes.senate"));

console.log("\nassessChange on a guiding document");

const firstVersion = assessChange({
    kind: "guiding.constitution",
    before: "",
    after: constitutionBefore,
});
check(
    "the first version of a governing document is published, since there is nothing to protect",
    firstVersion.publish,
    firstVersion,
);

const unchanged = assessChange({
    kind: "guiding.constitution",
    before: constitutionBefore,
    after: constitutionBefore,
});
check("no change is not a change", unchanged.publish, unchanged);

const tinyEdit = assessChange({
    kind: "guiding.constitution",
    before: constitutionBefore,
    after: constitutionBefore.replace("three branches", "three co-equal branches"),
});
check(
    "a one-word rewrite of the constitution is not published",
    !tinyEdit.publish,
    tinyEdit,
);
check(
    "the reason names the meeting requirement",
    /Senate meeting/.test(tinyEdit.reason),
    tinyEdit.reason,
);
check(
    "the reason is marked as ratification, not screening",
    tinyEdit.reason.endsWith(RATIFICATION_MARKER),
    tinyEdit.reason,
);

const pureAddition = assessChange({
    kind: "guiding.constitution",
    before: constitutionBefore,
    after: `${constitutionBefore}\nARTICLE IV.\nAll officers shall be elected annually.`,
});
check(
    "a new article added to the constitution is held for ratification, not published as an addition",
    !pureAddition.publish,
    pureAddition,
);

const bylawsEdit = assessChange({
    kind: "guiding.bylaws",
    before: constitutionBefore,
    after: constitutionBefore.replace("Membership", "Membership in the SGA"),
});
check("bylaws changes are ratification-held too", !bylawsEdit.publish, bylawsEdit);

const bylawsFormatted = [
    "**BYLAWS OF THE Senate**",
    "**3.2.2.8 Within the first month of each term, determine the member's goals.**",
    " 4.3.3.2.3. Every member shall be permitted 3 excused committee absences.",
].join("\n");
const bylawsReformatted = [
    "**BYLAWS OF THE SENATE**",
    "3.2.2.8 Within the first month of each term, determine the member's goals.",
    "4.3.3.2.3 Every member shall be permitted 3 excused committee absences.",
].join("\n");
const cosmeticEdit = assessChange({ kind: "guiding.bylaws", before: bylawsFormatted, after: bylawsReformatted });
check("masthead case, bold, and section-number punctuation publish without a hold", cosmeticEdit.publish, cosmeticEdit);
const numberChanged = assessChange({ kind: "guiding.bylaws", before: bylawsFormatted,
    after: bylawsReformatted.replace("3 excused", "4 excused") });
check("a changed number alongside formatting is still held", !numberChanged.publish, numberChanged);

console.log("\nassessChange on ordinary documents");

const minutesBefore = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
const minutesAppended = `${minutesBefore}\n- New motion carried unanimously.`;
const minutesGrew = assessChange({
    kind: "minutes.senate",
    before: minutesBefore,
    after: minutesAppended,
});
check(
    "a minute set that grew by one line is published without a hold",
    minutesGrew.publish,
    minutesGrew,
);

for (const [kind, total, removed] of [
    ["minutes.executive", 20, 6],
    ["minutes.committee", 246, 24],
] as const) {
    const lines = Array.from({ length: total }, (_, i) => `Line ${i + 1}`);
    const edit = assessChange({ kind, before: lines.join("\n"), after: lines.slice(removed).join("\n") });
    check(`${kind} publishes after ${removed} of ${total} lines are removed`, edit.publish, edit);
}

const minutesGutted = assessChange({
    kind: "minutes.senate",
    before: minutesBefore,
    after: "Line 1\nLine 2",
});
check(
    "minutes cut down to almost nothing are still published",
    minutesGutted.publish,
    minutesGutted,
);

console.log("\nlargeRemoval");

const guttedReason = largeRemoval({ kind: "minutes.senate", before: minutesBefore, after: "Line 1\nLine 2" });
check(
    "gutted minutes are flagged with the size of the removal",
    guttedReason === "95% of its lines were removed (38 of 40).",
    guttedReason,
);
check(
    "a working document is never flagged",
    largeRemoval({ kind: "working.document", before: minutesBefore, after: "Line 1\nLine 2" }) === null,
);
check(
    "a guiding document is held rather than flagged",
    largeRemoval({ kind: "guiding.bylaws", before: minutesBefore, after: "Line 1\nLine 2" }) === null,
);
check(
    "a grown minute set is not flagged",
    largeRemoval({ kind: "minutes.senate", before: minutesBefore, after: minutesAppended }) === null,
);
check(
    "a first version is not flagged",
    largeRemoval({ kind: "minutes.senate", before: "", after: minutesBefore }) === null,
);
for (const [kind, total, removed] of [
    ["minutes.executive", 20, 6],
    ["minutes.committee", 246, 24],
] as const) {
    const lines = Array.from({ length: total }, (_, i) => `Line ${i + 1}`);
    check(
        `${kind} is not flagged after ${removed} of ${total} lines are removed`,
        largeRemoval({ kind, before: lines.join("\n"), after: lines.slice(removed).join("\n") }) === null,
    );
}

console.log("\nheldNotice");

const ratificationNotice = heldNotice(tinyEdit.reason);
check("standalone ratification reasons start with a capital", tinyEdit.reason.startsWith("The source edit"));
check("stored lowercase notices gain sentence case and terminal punctuation",
    heldNotice(`the Constitution (5 lines added, 5 removed)${RATIFICATION_MARKER}`)
        .startsWith("The source file changed (5 lines added, 5 removed)."));
check(
    "a hold describes the published baseline without claiming adoption",
    /previously published/.test(ratificationNotice) && !/last adopted|not been ratified/.test(ratificationNotice),
    ratificationNotice,
);
check(
    "the ratification marker itself is not shown to the reader",
    !ratificationNotice.includes(RATIFICATION_MARKER.trim()),
    ratificationNotice,
);

const screeningNotice = heldNotice("44% of its lines were removed (42 of 96).");
check(
    "a legacy screening hold keeps the older wording",
    /awaiting review/.test(screeningNotice),
    screeningNotice,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
