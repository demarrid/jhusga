import assert from "node:assert/strict";
import { officialAdministratorUrl, validateAdministratorCandidate, administratorLookupCacheKey, fetchAdministratorPage, administratorSearchInput, validateProviderCitedAdministrator, providerCitationUrls } from "../lib/administrator-lookup";
const now = new Date("2026-10-30T12:00:00Z");
const input = {documentId:"minutes",name:"Martin",office:"Associate Dean",evidence:"Associate Dean Martin",
 context:"Associate Dean Martin explained academic advising.",asOf:new Date("2026-10-20T12:00:00Z")};
const url = "https://advising.jhu.edu/directory/jessie-martin/";
const quote = "Jessie Martin Associate Dean of Academic Advising and Support";
const candidate = {status:"resolved",fullName:"Jessie Martin",role:"Associate Dean of Academic Advising and Support",
 contextQuote:input.context,reason:"Title and surname match",sources:[{url,quote}]};
const pages = [{url,text:quote}];
assert.ok(validateAdministratorCandidate(input,candidate,pages,now));
assert.equal(validateAdministratorCandidate(input,{...candidate,fullName:"Kai Martin"},pages,now),null);
assert.equal(validateAdministratorCandidate(input,{...candidate,fullName:"Jessie Martins"},pages,now),null);
assert.equal(validateAdministratorCandidate(input,{...candidate,role:"Senator"},pages,now),null);
const searchPayload = JSON.stringify(administratorSearchInput({...input,context:input.context+" This private sentence must stay local."}));
assert.ok(!searchPayload.includes("private sentence"));
assert.ok(!searchPayload.includes("documentId"));
assert.deepEqual(administratorSearchInput(input).topics,["academic","advising"]);
assert.equal(validateAdministratorCandidate(input,{...candidate,sources:[{url,quote:quote+" invented"}]},pages,now),null);
assert.equal(validateAdministratorCandidate({...input,asOf:new Date("2020-01-01")},candidate,pages,now),null);
assert.equal(validateAdministratorCandidate({...input,asOf:undefined},candidate,pages,now),null);
assert.equal(validateAdministratorCandidate({...input,name:"Jessie"},candidate,pages,now),null);
assert.equal(officialAdministratorUrl("https://jhu.edu.attacker.test/"),null);
assert.equal(officialAdministratorUrl("https://jhu.edu@attacker.test/"),null);
assert.equal(officialAdministratorUrl("http://advising.jhu.edu/"),null);
assert.equal(officialAdministratorUrl("https://jhu.edu/~student/"),null);
assert.equal(officialAdministratorUrl(url+"#bio"),url);
assert.notEqual(administratorLookupCacheKey(input),administratorLookupCacheKey({...input,documentId:"other"}));
assert.notEqual(administratorLookupCacheKey(input),administratorLookupCacheKey({...input,context:input.context+" correction"}));
const marrowQuote = "Meghan Marrow Associate Director for Academic Advising, Systems and Technology";
assert.ok(validateAdministratorCandidate({...input,name:"Marrow",office:null,context:"Marrow discussed academic advising.",evidence:"Marrow"},
 {...candidate,fullName:"Meghan Marrow",role:"Associate Director for Academic Advising, Systems and Technology",
 contextQuote:"Marrow discussed academic advising.",sources:[{url,quote:marrowQuote}]},[{url,text:marrowQuote}],now));
async function main(){
 const realFetch = globalThis.fetch;
 const urls:string[] = [];
 globalThis.fetch = async (request) => {urls.push(String(request));return new Response("",{status:302,headers:{location:"https://attacker.test/"}});};
 try {
  assert.equal(await fetchAdministratorPage(url,Date.now()+1000),null);
  assert.deepEqual(urls,[url],"external redirects are refused before network access");
 } finally {globalThis.fetch=realFetch;}
 console.log("Administrator evidence checks passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});


const secondUrl = "https://krieger.jhu.edu/people/dean-leadership/";
const corroborated = {...candidate,sources:[{url,quote},{url:secondUrl,quote}]};
assert.ok(validateProviderCitedAdministrator(input,corroborated,[url,secondUrl],now));
assert.equal(validateProviderCitedAdministrator(input,corroborated,[url],now),null);
assert.equal(validateProviderCitedAdministrator(input,corroborated,[],now),null,"model-written URLs are not provider citations");
assert.equal(validateProviderCitedAdministrator({...input,asOf:new Date("2020-01-01")},corroborated,[url,secondUrl],now),null);
const siblingUrl = "https://advising.jhu.edu/people/";
assert.equal(validateProviderCitedAdministrator(input,{...candidate,sources:[{url,quote},{url:siblingUrl,quote}]},[url,siblingUrl],now),null,
 "two pages on one host do not constitute corroboration");
assert.equal(validateProviderCitedAdministrator(input,{...corroborated,fullName:"Kai Martin"},[url,secondUrl],now),null);
assert.equal(validateProviderCitedAdministrator(input,corroborated,[url,secondUrl],now)?.sources[0].verification,"provider-cited");
assert.deepEqual(providerCitationUrls([{action:{sources:[{url}]}}]),[],"consulted sources are not answer citations");
assert.deepEqual(providerCitationUrls([{content:[{annotations:[{type:"url_citation",url}]}]}]),[url]);


assert.ok(validateProviderCitedAdministrator(input,{...candidate,sources:[{url,quote},{url:secondUrl,quote:quote.replace("Dean of","Dean for")}]},[url,secondUrl],now),
 "of/for wording does not split the same university role");


assert.equal(officialAdministratorUrl(url+"?utm_source=openai"),url);
assert.ok(validateProviderCitedAdministrator(input,corroborated,[url+"?utm_source=openai",secondUrl],now),
 "provider citation tracking parameters preserve source identity");
assert.deepEqual(administratorSearchInput({...input,evidence:"Dean Martin",context:"Academic advising: Dean Martin. Next agenda item: housing safety."}).topics,["academic","advising"],
 "later agenda topics do not contaminate the administrator search");
