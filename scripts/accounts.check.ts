/**
 * Checks the Drive-account matcher against the handles that actually own files
 * in the master folder, and against the people the archive knows.
 */
import { accountNameScore, accountStem, matchAccount } from "../lib/accounts";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

console.log("stems");

check("digits and dots fall away", accountStem("perez23alan04@gmail.com") === "perezalan");
check("a JHED keeps its letters", accountStem("spate249@jh.edu") === "spate");
check("a dotted handle joins up", accountStem("kirsten.amematsro@gmail.com") === "kirstenamematsro");

console.log("\nscores");

check("the whole name is the strongest match", accountNameScore("Jackson Morris", "jacksonmorris21@gmail.com") === 4);
check("surname-first counts the same", accountNameScore("Amy Xu", "xuamy05@gmail.com") === 4, accountNameScore("Amy Xu", "xuamy05@gmail.com"));
check("so does surname-first with digits between", accountNameScore("Alan Perez", "perez23alan04@gmail.com") === 4);
check("a JHED is initial plus surname", accountNameScore("Shreemann Patel", "spate249@jh.edu") === 3, accountNameScore("Shreemann Patel", "spate249@jh.edu"));
check("a truncated JHED still scores", accountNameScore("Jackson Morris", "jmorr119@jhu.edu") === 3, accountNameScore("Jackson Morris", "jmorr119@jhu.edu"));
check(
    // The example this feature exists for: a given name plus a middle name.
    "a handle opening with a distinctive given name is weak but usable",
    accountNameScore("Honora Muratori", "honorarose123@gmail.com") === 2,
    accountNameScore("Honora Muratori", "honorarose123@gmail.com"),
);
check(
    "a suffix is not a surname",
    accountNameScore("Charles Norman III", "charlesiii@jhu.edu") >= 2,
    accountNameScore("Charles Norman III", "charlesiii@jhu.edu"),
);
check(
    "a shortened given name in front of the full surname counts",
    accountNameScore("Srigouri Oruganty", "sri.oruganty@gmail.com") === 3 &&
    accountNameScore("Zaynab Mirza", "zaymirza0526@gmail.com") === 3,
    [
        accountNameScore("Srigouri Oruganty", "sri.oruganty@gmail.com"),
        accountNameScore("Zaynab Mirza", "zaymirza0526@gmail.com"),
    ],
);
check(
    "initials between the given name and surname are tolerated",
    accountNameScore("Kai Martin", "kairktmartin@gmail.com") === 3,
    accountNameScore("Kai Martin", "kairktmartin@gmail.com"),
);
check(
    "a surname alone is not enough to claim a person",
    accountNameScore("Zaynab Mirza", "mirza@gmail.com") < 3,
    accountNameScore("Zaynab Mirza", "mirza@gmail.com"),
);

console.log("\nnon-matches");

check("an unrelated handle scores nothing", accountNameScore("Amy Xu", "parasitemaster316@gmail.com") === 0);
check("a two-letter stem is not evidence", accountNameScore("Tyler Turner", "th9435@gmail.com") === 0);
check(
    "a mangled handle is not forced onto the nearest name",
    accountNameScore("Sumire Sumi", "s.109su3ire@gmail.com") === 0,
    accountNameScore("Sumire Sumi", "s.109su3ire@gmail.com"),
);

console.log("\nresolution");

const people = [
    { id: "amy-xu", name: "Amy Xu" },
    { id: "amy-li", name: "Amy Li" },
    { id: "jackson", name: "Jackson Morris" },
    { id: "honora", name: "Honora Muratori" },
    { id: "tyler", name: "Tyler Turner" },
    { id: "shreemann", name: "Shreemann Patel" },
];

check(
    "a clear handle resolves",
    matchAccount({ email: "xuamy05@gmail.com" }, people)?.person.id === "amy-xu",
    matchAccount({ email: "xuamy05@gmail.com" }, people),
);
check(
    "the given-name case resolves when only one person fits",
    matchAccount({ email: "honorarose123@gmail.com" }, people)?.person.id === "honora",
    matchAccount({ email: "honorarose123@gmail.com" }, people),
);
check(
    "a real display name beats handle arithmetic",
    matchAccount({ email: "tyaltu22@gmail.com", displayName: "Tyler Turner" }, people)
        ?.person.id === "tyler",
);
check(
    "the evidence records the account it came from",
    matchAccount({ email: "spate249@jh.edu" }, people)?.evidence === "Drive account spate249@jh.edu",
    matchAccount({ email: "spate249@jh.edu" }, people),
);

// The rule that keeps this from quietly mislabelling people.
check(
    "an ambiguous handle resolves to nobody",
    matchAccount({ email: "amy2007@gmail.com" }, people) === null,
    matchAccount({ email: "amy2007@gmail.com" }, people),
);
check(
    // Two spellings of one person are two rows, and the matcher cannot know
    // that. Refusing is the right answer until the duplicate is merged.
    "a handle fitting two rows equally well resolves to nobody",
    matchAccount({ email: "spate249@jh.edu" }, [
        { id: "a", name: "Shreeman Patel" },
        { id: "b", name: "Shreemann Patel" },
    ]) === null,
);
check(
    "an unknown person is never invented",
    matchAccount({ email: "vishnudontu@gmail.com" }, people) === null,
    matchAccount({ email: "vishnudontu@gmail.com" }, people),
);
check(
    "a shared SGA inbox is not a person",
    matchAccount({ email: "jhusga1718@gmail.com" }, people) === null,
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
