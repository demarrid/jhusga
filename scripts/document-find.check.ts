import { documentFindRank } from "../lib/document-find";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

console.log("documentFindRank");

const rulesBill = {
    title: "S.B.26-27.21.04-1 Rules Bill",
    description: "",
    summary: "This bill establishes the Johns Hopkins SGA Senate's procedural rules.",
};

// Newer, and mentions the rules bill in its body, which is how it matched.
const bylaws = {
    title: "JHU SGA Bylaws (Amended September 18th 2026)",
    description: "",
    summary: "These bylaws govern the Senate and other parts of the SGA.",
};

const committeeMinutes = {
    title: "Internal Affairs Committee Meeting — Minutes (08/04/26)",
    description: "",
    summary: "The committee passed the rules bill with a positive recommendation.",
};

check(
    "a title match outranks a body-only match",
    documentFindRank(rulesBill, "rules bill") > documentFindRank(bylaws, "rules bill"),
    [documentFindRank(rulesBill, "rules bill"), documentFindRank(bylaws, "rules bill")],
);
check(
    "a title match outranks a summary match",
    documentFindRank(rulesBill, "rules bill") > documentFindRank(committeeMinutes, "rules bill"),
);
check(
    "a summary match outranks a body-only match",
    documentFindRank(committeeMinutes, "rules bill") > documentFindRank(bylaws, "rules bill"),
);
check("case does not matter", documentFindRank(rulesBill, "RULES BILL") === documentFindRank(rulesBill, "rules bill"));
check("an empty query ranks nothing", documentFindRank(rulesBill, "  ") === 0);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
