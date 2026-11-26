import assert from "node:assert/strict";
import { contributionWords, mergeRankedEditors, rankedEditors, editorDisplayName } from "../lib/editors";
const words = (prefix: string, count: number) => Array.from({length: count}, (_, i) => `${prefix}${i}`).join(" ");
assert.equal(contributionWords("First paragraph\n\nSecond paragraph", "Second paragraph\n\nFirst paragraph"), 0);
assert.equal(contributionWords("**Hello world.**", "hello world!"), 0);
assert.equal(contributionWords("hello world", "hello worlds"), 1);
assert.equal(contributionWords("hello world", "hello"), 0);
const row = (n: number, name: string, content: string | null) => ({ documentId: "minutes", revisionId: `${n}`,
    fetchedAt: new Date(n * 1000), editorName: name, editorEmail: `${name}@example.com`, content });
const baseline = "Meeting agenda";
const one = `${baseline} ${words("alpha", 100)}`;
const two = `${one} ${words("beta", 50)}`;
const authors = rankedEditors([
    row(4, "Tiny", `${two} typo`), row(0, "Owner", baseline), row(1, "Alice", one), row(2, "Bob", two),
]).get("minutes")!;
assert.deepEqual(authors.map(author => [author.name, author.changedWords]), [["Alice", 100], ["Bob", 50]]);
assert.deepEqual(rankedEditors([row(0, "Owner", words("alpha", 100))]).get("minutes"), []);
assert.deepEqual(rankedEditors([row(0, "Owner", baseline), row(1, "Unknown", null), row(2, "Bob", two)]).get("minutes"), []);
assert.deepEqual(rankedEditors([row(0, "Owner", baseline), row(1, "Alice", words("alpha", 1000)),
    row(2, "Bob", `${words("alpha", 1000)} ${words("beta", 30)}`)]).get("minutes")!.map(x => x.name), ["Alice"]);
assert.equal(editorDisplayName({name: "honorarose123", email: "honorarose123@gmail.com"}, [{id:"honora", name:"Honora Muratori"}]), "Honora Muratori");
assert.equal(editorDisplayName({name: "honorarose123", email: ""}, [{id:"honora", name:"Honora Muratori"}]), "Honora Muratori");
assert.equal(editorDisplayName({name:"unknown123", email:"unknown123@gmail.com"}, []), "");
assert.equal(editorDisplayName({name:"Tyler Turner", email:""}, []), "Tyler Turner");
const anonymous = { ...row(1, "", `${baseline} ${words("anonymous", 2000)}`), editorEmail: "" };
const namedAfterAnonymous = `${anonymous.content} ${words("named", 40)}`;
assert.deepEqual(rankedEditors([
    row(0, "Owner", baseline), anonymous, row(2, "Alice", namedAfterAnonymous),
]).get("minutes")!.map(x => [x.name, x.changedWords]), [["Alice", 40]],
"anonymous additions neither earn credit nor suppress named writers; their text remains the baseline");
assert.deepEqual(mergeRankedEditors([
    [{ name: "spate249", email: "spate249@jh.edu", changedWords: 900 }],
    [{ name: "Sumi", email: "S.109SU3IRE@gmail.com", changedWords: 1200 }, { name: "spate249", email: "spate249@jh.edu", changedWords: 150 }],
    [],
]).map(x => [x.email.toLowerCase(), x.changedWords]), [["s.109su3ire@gmail.com", 1200], ["spate249@jh.edu", 1050]],
"each record of a meeting contributes its qualified writers, summed per account and ranked by words");
console.log("all editor contribution checks passed");
