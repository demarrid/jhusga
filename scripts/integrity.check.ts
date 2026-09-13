/**
 * Checks the rules `assessChange` applies before publishing a Drive edit.
 *
 * Two rules matter here in practice. Any edit to a guiding document is held
 * until a Senate meeting record confirms it: the constitution and bylaws are
 * amended by legislation, not by a quiet Drive rewrite, and the archive has
 * no way to tell one from the other. Everything else is measured for size,
 * and only large removals are held.
 */
import {
    RATIFICATION_MARKER,
    assessChange,
    heldNotice,
    isGoverning,
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
    anyoneCanEdit: false,
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
    anyoneCanEdit: false,
    before: constitutionBefore,
    after: constitutionBefore,
});
check("no change is not a change", unchanged.publish, unchanged);

const tinyEdit = assessChange({
    kind: "guiding.constitution",
    anyoneCanEdit: false,
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
    anyoneCanEdit: false,
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
    anyoneCanEdit: false,
    before: constitutionBefore,
    after: constitutionBefore.replace("Membership", "Membership in the SGA"),
});
check("bylaws changes are ratification-held too", !bylawsEdit.publish, bylawsEdit);

const openDoor = assessChange({
    kind: "guiding.constitution",
    anyoneCanEdit: true,
    before: constitutionBefore,
    after: constitutionBefore.replace("three branches", "three branches (with room for a fourth)"),
});
check(
    "an open-door governing file names the open door in the reason",
    /anyone with the link/.test(openDoor.reason),
    openDoor.reason,
);

console.log("\nassessChange on ordinary documents");

const minutesBefore = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
const minutesAppended = `${minutesBefore}\n- New motion carried unanimously.`;
const minutesGrew = assessChange({
    kind: "minutes.senate",
    anyoneCanEdit: false,
    before: minutesBefore,
    after: minutesAppended,
});
check(
    "a minute set that grew by one line is published without a hold",
    minutesGrew.publish,
    minutesGrew,
);

const minutesGutted = assessChange({
    kind: "minutes.senate",
    anyoneCanEdit: false,
    before: minutesBefore,
    after: "Line 1\nLine 2",
});
check(
    "minutes cut down to almost nothing are held for screening",
    !minutesGutted.publish,
    minutesGutted,
);
check(
    "the screening hold is not phrased as ratification",
    !minutesGutted.reason.endsWith(RATIFICATION_MARKER),
    minutesGutted.reason,
);

console.log("\nheldNotice");

const ratificationNotice = heldNotice(tinyEdit.reason);
check(
    "a ratification hold tells the reader they are seeing the last adopted text",
    /last adopted/.test(ratificationNotice) && !/awaiting review/.test(ratificationNotice),
    ratificationNotice,
);
check(
    "the ratification marker itself is not shown to the reader",
    !ratificationNotice.includes(RATIFICATION_MARKER.trim()),
    ratificationNotice,
);

const screeningNotice = heldNotice(minutesGutted.reason);
check(
    "a screening hold keeps the older wording",
    /awaiting review/.test(screeningNotice),
    screeningNotice,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
