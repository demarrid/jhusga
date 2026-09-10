import { splitIntoPassages } from "../lib/passages";
import { questionTerms } from "../lib/terms";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

// A constitution as the SGA actually writes one: structural headings typed as
// plain lines rather than as markdown.
const constitution = [
    "JOHNS HOPKINS UNIVERSITY",
    "STUDENT GOVERNMENT ASSOCIATION CONSTITUTION",
    "",
    "ARTICLE IV",
    "The Legislative Branch",
    "",
    "Section 1",
    "The Senate shall consist of Class Senators and Caucus Senators.",
    "",
    "Section 2",
    "No caucus shall seat more than three Caucus Senators at any one time.",
    "",
    "ARTICLE V",
    "Amendment",
    "",
    "An amendment to this Constitution requires a two-thirds vote of the Senate.",
].join("\n");

console.log("splitIntoPassages");

const passages = splitIntoPassages(constitution);

check("a document yields at least one passage", passages.length > 0, passages.length);

check(
    "offsets slice back to the passage text",
    passages.every(
        (passage) =>
            constitution.slice(passage.startOffset, passage.endOffset) === passage.content,
    ),
    passages.map((passage) => [passage.startOffset, passage.endOffset]),
);

check(
    "passages are in reading order and do not overlap",
    passages.every(
        (passage, index) =>
            passage.ordinal === index &&
            (index === 0 || passage.startOffset >= passages[index - 1]!.endOffset),
    ),
    passages.map((passage) => passage.ordinal),
);

const caucusClause = passages.find((passage) =>
    passage.content.includes("more than three Caucus Senators"),
);

check("the clause that answers a question is retrievable", Boolean(caucusClause));

check(
    "a structural heading is carried on the passage under it",
    Boolean(caucusClause?.heading.includes("ARTICLE IV")),
    caucusClause?.heading,
);

// The whole point of the heading trail: Section 2 alone does not say which
// article it amends, so a passage that dropped "ARTICLE IV" would answer a
// question about the legislative branch with a clause from anywhere.
check(
    "a section heading does not discard the article above it",
    Boolean(caucusClause?.heading.includes("Section 2")),
    caucusClause?.heading,
);

check(
    "every passage carries some text",
    passages.every((passage) => passage.content.trim().length > 0),
);

// Markdown headings, which linked documents and exported Docs do use.
const markdown = [
    "# Bylaws",
    "",
    "## Article II",
    "",
    "Committees are chaired by a member of the Executive Board.",
    "",
    "### Section 4",
    "",
    "The Finance Committee reviews every funding request before it is read.",
].join("\n");

const markdownPassages = splitIntoPassages(markdown);

check(
    "markdown headings nest the same way",
    markdownPassages.some(
        (passage) =>
            passage.content.includes("Finance Committee") &&
            passage.heading.includes("Article II") &&
            passage.heading.includes("Section 4"),
    ),
    markdownPassages.map((passage) => passage.heading),
);

check("an empty document yields no passages", splitIntoPassages("   \n\n  ").length === 0);

console.log("\nquestionTerms");

const terms = questionTerms("How many caucus senators can there be?");

check("the interrogative frame is dropped", !terms.includes("how") && !terms.includes("many"), terms);
check("the subject survives", terms.includes("caucus") && terms.includes("senators"), terms);

check(
    "words every SGA document shares are dropped",
    questionTerms("What does the SGA constitution say about quorum?").every(
        (term) => term !== "sga",
    ),
    questionTerms("What does the SGA constitution say about quorum?"),
);

check(
    "a question of nothing but noise yields no terms",
    questionTerms("what is it?").length === 0,
    questionTerms("what is it?"),
);

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
