/**
 * Checks how a first name is read when several people answer to it.
 *
 * The cases are the real ones: three people called Grace serve at once, "Amy"
 * is both the sitting Treasurer and someone who left, and "Jackson" is both a
 * given name and a surname in the same archive.
 */
import { bodyForDocument, bodyForOffice } from "../lib/bodies";
import {
    diminutiveCandidates,
    givenNameCandidates,
    looksMistyped,
    misspellingCandidates,
    namedInFull,
    narrowByDocument,
    surnameCandidates,
    tokenCandidates,
    type RegularPerson,
} from "../lib/names";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const person = (
    name: string,
    documentCount: number,
    positions: string[] = [],
): RegularPerson => ({
    id: name.toLowerCase().replace(/\W/g, "-"),
    name,
    nameKey: name.toLowerCase(),
    documentCount,
    positions,
    bodies: [...new Set(positions.map(bodyForOffice).filter((body) => body !== null))],
});

const AMY_XU = person("Amy Xu", 10, ["Treasurer"]);
const AMY_LI = person("Amy Li", 5);
const JACKSON_MORRIS = person("Jackson Morris", 13, ["Disability Caucus Chair"]);
const PETER_JACKSON = person("Peter Jackson", 4);
const GRACE_GUAN = person("Grace Guan", 0, [
    "Chair of Programming",
    "Junior Class Programming Council",
]);
const GRACE_WANG = person("Grace Wang", 5, ["KSAS Senator"]);
const GRACE_YANG = person("Grace Yang", 0, [
    "KSAS Senator",
    "Sophomore Class Programming Council",
    "Committee on Student Elections",
]);

const CURRENT = { isCurrentSession: true };

console.log("offices and bodies");

check(
    "the Chair of Programming is an executive officer, not a council member",
    bodyForOffice("Chair of Programming") === "executive",
    bodyForOffice("Chair of Programming"),
);
check(
    "a class programming council seat is programming",
    bodyForOffice("Junior Class Programming Council") === "programming",
);
check(
    "a class president is a senator, not the Student Body President",
    bodyForOffice("Senior Class President") === "senate",
    bodyForOffice("Senior Class President"),
);
check("the Treasurer is executive", bodyForOffice("Treasurer") === "executive");
check("a justice is judiciary", bodyForOffice("Chief Justice") === "judiciary");
check(
    "exec minutes are an executive meeting",
    bodyForDocument({
        kind: "minutes.executive",
        folderPath: "Executive Branch/Minutes for Exec Meetings",
        title: "Sum Exec Minutes 4",
    }) === "executive",
);
check(
    "committee minutes are a Senate meeting, because senators sit on committees",
    bodyForDocument({
        kind: "minutes.committee",
        folderPath: "Senate/Committees/Internal Affairs",
        title: "IA Minutes",
    }) === "senate",
);
check(
    "a bill belongs to no one meeting",
    bodyForDocument({
        kind: "bill.funding",
        folderPath: "Guiding Documents",
        title: "RSO Funding Bill",
    }) === null,
);

console.log("\nthe document names them in full");

const MINUTES_2 = [
    "1. Student Body President \\- *Jason Yu*",
    "4. Treasurer \\- *Amy Xu*",
    "Sponsored by: Jackson, Veda",
    "Jackson: Newsletter is great, everyone should read it",
    "2. Jackson Morris",
].join("\n");

check(
    "a full name written anywhere in the document counts",
    namedInFull(MINUTES_2, JACKSON_MORRIS) && namedInFull(MINUTES_2, AMY_XU),
);
check(
    "a surname on its own does not",
    !namedInFull("Morris raised a point of order", JACKSON_MORRIS),
);
check(
    "markdown emphasis around the name does not hide it",
    namedInFull("Treasurer \\- *Amy Xu*", AMY_XU),
);
check(
    "someone the document never names in full is not chosen",
    !namedInFull(MINUTES_2, PETER_JACKSON),
);
check(
    "'Jackson' is Jackson Morris here, not Peter Jackson",
    narrowByDocument([JACKSON_MORRIS, PETER_JACKSON], {
        text: MINUTES_2,
        body: "senate",
        ...CURRENT,
    })?.person.id === JACKSON_MORRIS.id,
);
check(
    "the written name wins over who happens to be serving",
    narrowByDocument([AMY_XU, AMY_LI], { text: MINUTES_2, ...CURRENT })?.reason ===
    "named_in_full",
);

console.log("\nthe body that met");

const SUM_EXEC = "Present: Sumi, Jason, Amy, Grace, Sienna";

check(
    "'Grace' in an executive meeting is the Grace on the Executive Board",
    narrowByDocument([GRACE_GUAN, GRACE_WANG, GRACE_YANG], {
        text: SUM_EXEC,
        body: "executive",
        ...CURRENT,
    })?.person.id === GRACE_GUAN.id,
    narrowByDocument([GRACE_GUAN, GRACE_WANG, GRACE_YANG], {
        text: SUM_EXEC,
        body: "executive",
        ...CURRENT,
    }),
);
check(
    "'Grace' in a Senate meeting is left unresolved, because two of them are senators",
    narrowByDocument([GRACE_GUAN, GRACE_WANG, GRACE_YANG], {
        text: SUM_EXEC,
        body: "senate",
        ...CURRENT,
    }) === null,
);
check(
    "'Amy' is the Amy still serving",
    narrowByDocument([AMY_XU, AMY_LI], { text: SUM_EXEC, ...CURRENT })?.person.id ===
    AMY_XU.id,
);

console.log("\nthe office the line names");

// The minutes write "Chair of Programming - Grace" and then introduce a Grace
// Yang who is not her, which is enough to make the written full name the wrong
// thing to go on.
const GRACE_YANG_NAMED = "Chair of Programming - Grace\nGrace Yang: sophomore, in CSE";

check(
    "'Grace' next to an office is the Grace who holds it",
    narrowByDocument(
        [GRACE_GUAN, GRACE_WANG, GRACE_YANG],
        { text: GRACE_YANG_NAMED, body: "senate", ...CURRENT },
        "Chair of Programming",
    )?.person.id === GRACE_GUAN.id,
    narrowByDocument(
        [GRACE_GUAN, GRACE_WANG, GRACE_YANG],
        { text: GRACE_YANG_NAMED, body: "senate", ...CURRENT },
        "Chair of Programming",
    ),
);
check(
    "the office outranks somebody else's full name in the same document",
    narrowByDocument(
        [GRACE_GUAN, GRACE_YANG],
        { text: GRACE_YANG_NAMED, ...CURRENT },
        "Chair of Programming",
    )?.reason === "holds_the_office",
);
check(
    "an office two of them hold settles nothing",
    narrowByDocument(
        [GRACE_WANG, GRACE_YANG],
        { text: SUM_EXEC, ...CURRENT },
        "KSAS Senator",
    ) === null,
);
check(
    "an office nobody here holds falls through to the rest",
    narrowByDocument([AMY_XU, AMY_LI], { text: SUM_EXEC, ...CURRENT }, "Parliamentarian")
        ?.person.id === AMY_XU.id,
);
check(
    "an archived document is not read against today's officers either",
    narrowByDocument(
        [GRACE_GUAN, GRACE_WANG],
        { text: SUM_EXEC, isCurrentSession: false },
        "Chair of Programming",
    ) === null,
);

console.log("\nrestraint");

check(
    "an archived document is not read against today's officers",
    narrowByDocument([AMY_XU, AMY_LI], { text: SUM_EXEC, isCurrentSession: false }) ===
    null,
);
check(
    "two serving people in the same body stay unresolved",
    narrowByDocument([AMY_XU, person("Amy Chen", 2, ["Secretary"])], {
        text: SUM_EXEC,
        body: "executive",
        ...CURRENT,
    }) === null,
);
check(
    "nobody at all resolves to nobody",
    narrowByDocument([], { text: SUM_EXEC, ...CURRENT }) === null,
);

console.log("\ncandidate pools");

const REGULARS = [AMY_XU, AMY_LI, JACKSON_MORRIS, PETER_JACKSON, GRACE_GUAN];

check(
    "a given name finds the people called that",
    givenNameCandidates("Amy", REGULARS).length === 2,
);
check(
    "a surname finds them too",
    surnameCandidates("Jackson", REGULARS)[0]?.id === PETER_JACKSON.id,
);
check(
    "both directions count as a candidate",
    tokenCandidates("Jackson", REGULARS).length === 2,
);
check(
    "a nickname nobody is named matches nothing, so its alias can stand",
    tokenCandidates("Jazz", REGULARS).length === 0,
);

console.log("\nclipped given names");

const HONORA = person("Honora Muratori", 22, ["Secretary"]);
const CLIPPED = [...REGULARS, HONORA];

check(
    // The case that sent "Nora" into the archive as a second person.
    "'Nora' is the Honora nobody writes out in full",
    diminutiveCandidates("Nora", CLIPPED)[0]?.id === HONORA.id,
    diminutiveCandidates("Nora", CLIPPED),
);
check(
    "a clipped front works the same way",
    diminutiveCandidates("Cass", [person("Cassandra Lin", 3)]).length === 1,
);
check(
    "a fragment out of the middle of a name is not a nickname",
    diminutiveCandidates("Onor", CLIPPED).length === 0,
    diminutiveCandidates("Onor", CLIPPED),
);
check(
    "three letters are too few to deduce anything from",
    diminutiveCandidates("Ono", CLIPPED).length === 0,
);
check(
    "the full given name is not a clipping of itself",
    diminutiveCandidates("Honora", CLIPPED).length === 0,
);
check(
    // Two candidates is the archive saying it does not know, which is the
    // point: resolving it would put the wrong person's name on a document.
    "a clipping two people answer to stays ambiguous",
    diminutiveCandidates("Nora", [
        HONORA,
        person("Eleonora Fabbri", 4),
    ]).length === 2,
);

console.log("\nmistyped names");

// Minutes are typed during the meeting and the archive is full of the result.
const MISTYPED = [
    person("Demarri Dosunmu", 12, ["WSE Senator"]),
    person("Srigouri Oruganty", 9),
    person("Andrew Gao", 3),
    person("Andrei Espelien", 2, ["Performing and Visual Arts Senator"]),
    person("Ryan Chou", 6),
    person("Ryann Bell", 1),
];

check(
    "a name one letter out is the person it is one letter out from",
    misspellingCandidates("Demari", MISTYPED).map((p) => p.name).join() ===
    "Demarri Dosunmu",
    misspellingCandidates("Demari", MISTYPED),
);
check(
    "a surname counts as much as a given name",
    misspellingCandidates("Dosunmo", MISTYPED).map((p) => p.name).join() ===
    "Demarri Dosunmu",
);
check(
    "two letters out is not a slip the archive will guess at",
    misspellingCandidates("Damari", MISTYPED).length === 0,
    misspellingCandidates("Damari", MISTYPED),
);
check(
    "a name spelled correctly is not a misspelling of itself",
    misspellingCandidates("Demarri", MISTYPED).length === 0,
);
check(
    // Both of them serve. Picking either is a coin flip dressed up as a
    // deduction, which is the whole thing this file is against.
    "two people a letter apart leave it unresolved",
    misspellingCandidates("Andrer", MISTYPED).length === 2,
    misspellingCandidates("Andrer", MISTYPED),
);
check(
    "four letters is too few to deduce a slip from",
    misspellingCandidates("Ryan", MISTYPED).length === 0,
    misspellingCandidates("Ryan", MISTYPED),
);
check(
    "an insertion, a deletion and a substitution all count as one edit",
    ["Srigour", "Srigourii", "Srigouru"].every(
        (written) => misspellingCandidates(written, MISTYPED).length === 1,
    ),
    ["Srigour", "Srigourii", "Srigouru"].map(
        (written) => misspellingCandidates(written, MISTYPED).length,
    ),
);
check(
    "a word that is nobody at all stays nobody",
    ["Timeline", "Venue", "Nominees"].every(
        (word) => misspellingCandidates(word, MISTYPED).length === 0,
    ),
);

console.log("\ntwo rows that are one person");

// Whole names, the way mergePeopleOneTypoApart compares them.
check(
    "a doubled letter is a slip",
    looksMistyped("shreemann patel", "shreeman patel") &&
    looksMistyped("tarini basireddy", "tarini basirreddy") &&
    looksMistyped("ava flores", "ava florres"),
);
check(
    "so is a dropped one, at either end or in the middle",
    looksMistyped("siddharth dhadi", "siddarth dhadi") &&
    looksMistyped("katherine zhu", "katherin zhu") &&
    looksMistyped("molly kuzma", "molly kuzmay"),
);
check(
    "so are two neighbours struck the wrong way round",
    looksMistyped("anisha rasamsetty", "anisha rasmasetty") &&
    looksMistyped("kirsten amematsro", "kirsten amemastro"),
);
check(
    "so is a letter struck wrong inside a word",
    looksMistyped("caraline sommer", "caroline sommer"),
);
check(
    // The case that made this stricter than the rule for short forms: both
    // Graces sat in the 114th and folding them would have erased one.
    "a letter struck wrong at the start of a word is a different name",
    !looksMistyped("grace yang", "grace wang") &&
    !looksMistyped("kiana lin", "diana lin"),
);
check(
    "two letters out is nothing the archive will act on",
    !looksMistyped("demarri dosunmu", "damari dosunmu"),
);
check(
    "a name is not a misspelling of itself",
    !looksMistyped("grace guan", "grace guan"),
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
