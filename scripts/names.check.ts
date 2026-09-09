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

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
