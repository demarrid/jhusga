/**
 * Checks the rules that read The Johns Hopkins Gazette from the Wayback
 * Machine: that one article captured under several hosts is one key, that the
 * listing keeps articles and drops everything else, that each era's template
 * yields a headline, date, byline and body without the site's furniture, that
 * the phrase test and the secondary-source rules apply to it as they do to the
 * News-Letter, and that a run stores, skips and refuses as it should.
 *
 * The HTML below is cut down from captures served in November 2026 -- the
 * table layouts, the comments the 2000s template marks its content with, the
 * <pre> issue of 1994 and the Latin-1 bytes are as archived. No network.
 */
import assert from "node:assert/strict";

import { matchedPhrases } from "../lib/newsletter";
import {
    GAZETTE_FILE_PREFIX,
    blocksOf,
    captureUrl,
    decodePage,
    gazetteCapture,
    gazetteMarkdown,
    gazetteSearchableText,
    mergeCaptures,
    parseCapture,
    parseCdx,
    preBlocks,
    staticIssueDate,
    yearPrefixes,
} from "../lib/gazette";
import { documentKindLabel, isSecondaryKind, secondaryPublisher } from "../lib/kinds";
import { summaryPromptVersion, summarySystemPrompt } from "../lib/summary-prompt";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The 2003-2009 template: a masthead table, then a marked content area. */
const STATIC_2009 = `<HTML>
<HEAD>
<BODY BGCOLOR="#ffffff" link="#003399">
<TITLE>Johns Hopkins Gazette | February 9, 2009</TITLE>
</HEAD>
<center><table border=0 width=670><tr><td>
<!--begin table 1, masthead and blue bar-->
<table border=0 width=660 cellpadding=2 cellspacing=0>
<tr><td colspan=4 align=center><a href="/~gazette/"><img src="/~gazette/images03/gaz1.jpg" alt="Gazette masthead" border=0></a></td></tr>
<tr bgcolor="#206DEC">
<td><a href="/~gazette/about.html"><font size=1 color="#FFFFFF">&nbsp;&nbsp;&nbsp;About The Gazette</font></td>
<td><a href="/~gazette/search.html"><font size=1 color="#FFFFFF">Search</font></a></td>
</tr>
<tr><td colspan=2 align=left><font size=1 color="#003399">
The newspaper of The Johns Hopkins University</font></td>
<td colspan=2 align=right><font size=1 color="#003399">
February 9, 2009 | Vol. 38 No. 21</font></td></tr>
</table>
<!--end table 1, masthead and blue bar-->
<!--begin table: page content-->
<table border=0 width=670 cellpadding=3 cellspacing=3>
<tr>
<td valign=top>
&nbsp;<br>
<font face="helvetica narrow, helvetica, sans-serif"
size=5>
<b>Student Council Elects
New Leaders</b></font><p>
<font face="helvetica narrow, helvetica, sans-serif"
size=2>
<i>By Gary Stephenson</i></font><p>
<font size="2" face="Verdana, Arial, Helvetica,
sans-serif">
     The Homewood Student Council chose its officers on
Tuesday, and the new president said the council's
first priority is the <a href="http://example.edu">shuttle</a>.<p>
     "We heard students," she said.<p>
</font>
<!--end of copy-->
<img src="/~gazette/images03/dot3.gif">
<font size=1 color="#696969">
GO TO <a href="/~gazette/2009/09feb09/"> FEBRUARY 9,
2009</a>
TABLE OF CONTENTS.<br>
</td></tr></table>
<!--end table: page content-->
<table><tr><td><font size=1>
The Gazette | The Johns Hopkins University | Suite 540 |
901 S. Bond St. | Baltimore, MD 21231 | 443-287-9900 |
</font></td></tr></table>
</td></tr></table></center>
</body>
</html>`;

/** The 1996 template: <BODY> inside <HEAD>, an <h3> headline, two nav links below. */
const STATIC_1996 = `<html>
<head>
<BODY BGCOLOR=#FFFFFF TEXT="#006666">
<Title>Johns Hopkins Gazette: October 7, 1996</Title>
</head>
<body>
<table border=0 width=400><tr><td width=220></td>
<td width=180 align=center><img src="../../images/gaz.gif"><p></td></tr></table>
<table border=0 width=550>
<tr>
<td width=220 valign=top><h3>Teaching Teachers<br>
To Teach</h3>
<strong>Education: The Division<br>
of Education has led the way.</strong><p>
<em>Christine A. Rowett<br>
Homewood</em><br>
</td>
<td width=330 valign=top>
     During the 1992 presidential campaign, political spin
doctors attempted to simplify the issues.<p>
     The Student Government Association of the
School of Continuing Studies endorsed the report.<p>
<p>
<hr>
<em>
<a href="index.html">
Go back to Previous Page</a><p>
<a href="/~gazette/">
Go to Gazette Homepage</a><p>
</td></tr></table>
</em>
</body>
</html>`;

/** 1999-2002: the issue date set in bold above an <h3> headline, and a marked footer. */
const STATIC_2001 = `<html>
<head>
<BODY BGCOLOR="#FFFFFF" TEXT="#000099">
<Title>The Johns Hopkins Gazette: March 19, 2001</Title>
</head>
<body>
<table border=0 width=580>
<tr>
<td width=200 valign=top>
     <table border=0 cellspacing=2 cellpadding=2 width=140>
     <tr>
     <td>
     <table width=130 border=5 cellpadding=7>
     <tr><td align=center valign=top bgcolor="#FFFFFF">
     <b><font color="#0099CC">
     March 19, 2001</b><br>
     <font size=-1>VOL. 30, NO. 26</font></font>
     </td></tr></table><p>
     </td>
     </tr>
     <tr>
     <td valign=top align=left>
     <h3>Student Council Backs a
     Later Library Closing</h3>
     <i>By Marjorie Centofanti<br>JHMI</i>
     </td>
     </tr>
     </table>
     </font>
     </td>
<td width=390 valign=top align=top>
<img src="/~gazette/images/gazette.gif"
alt="Johns Hopkins Gazette Online Edition" align=center>
<br clear=all><p>
     The Student Council voted to ask for later
hours at the Eisenhower Library.<p>
<!--footer-->
<hr noshade>
<table border=0 cellspacing=5>
<tr><td bgcolor="#FFFFCC"><font size=-1>
GO TO <a href="/~gazette/2001/mar1901/">MARCH 19, 2001</a>
TABLE OF CONTENTS.
</font></td></tr>
<tr><td bgcolor="#FFFFCC"><font size=-1>
GO TO <a href="/~gazette/">THE GAZETTE</a> HOME PAGE.
</font></td></tr>
</table>
</td></tr></table>
</body>
</html>`;

/** 1994: plain text in a <pre>, sections ruled off with hyphens. */
const STATIC_1994 = `<html>
<head>
<Title>Johns Hopkins Gazette: July 11, 1994</Title>
</head>
<body>
<center><img src="../../images/gaz.gif"></center><p>
<pre>
------------------------------------------------------------
CHEERS
------------------------------------------------------------
Cheers recognizes achievement of consequence among faculty,
staff and students.
    Orest Ranum has been elected to the Collège de
France, in Paris.
    The Student Council honored its outgoing treasurer.
</pre>
<hr>
<em>
<a href="index.html">
Go back to Previous Page</a><p>
</em>
</body>
</html>`;

/** gazette.jhu.edu, 2009-2012. */
const WORDPRESS = `<html><head><title>Gilman, past and present : Gazette Archives</title></head><body>
<div id="contentleft">
	<div class="postarea">
		<h1>Gilman, past and present</h1>
		<div class="date">
			<div class="dateleft">
				<iframe src="http://www.facebook.com/plugins/like.php"></iframe>
				<p><span class="time">November 1, 2010</span> <br /><span class="time2">By <a href="http://gazette.jhu.edu/author/traceyreeves/" title="Posts by Tracey A. Reeves">Tracey A. Reeves</a></span> &nbsp; <br /><span class="tim-italic">Homewood</span><br /> <div id="hidefromprint">Filed under <a href="/category/around/">Around Hopkins</a></div></p>
			</div>
			<div class="dateright"><div id="hidefromprint"><script type="text/javascript">SHARETHIS.addEntry({});</script></div></div>
		</div>
		<div style="clear:both;"></div>
		<div id="attachment_6178" class="wp-caption aligncenter" style="width: 550px"><a href="x.jpg"><img src="x.jpg" /></a><p class="wp-caption-text">Gilman Hall at night</p></div>
<p>More than 400 people turned out to celebrate the rededication of Gilman Hall.</p>
<p>The Student Government Association president spoke for undergraduates.</p>
<div id="hidefromprint"><p>More from The Gazette:<ol><li><a href='/2010/09/13/serving-up-dinner/'>Serving up dinner</a></li></ol></p></div>
		<div class="postmeta"><p><span class="tags">Tags: </span></p></div>
	</div>
</div>
<div id="contentright"><h2 class="widgettitle">Print Edition</h2></div>
</body></html>`;

/** hub.jhu.edu/gazette, 2012-2015, in the earlier template with no date meta tag. */
const HUB = `<html><head>
<meta property="og:title" content="Engineering students get deliciously inventive" />
</head><body>
<h1 class="masthead"><a href="/gazette"><span>Gazette</span></a></h1>
<div class="article single-view gazette-article">
		<h1>
			Engineering students get deliciously inventive
</h1>
		<h2 class="subheadline">Course's capstone: design, build cooking-related device</h2>
		<p class="author pubdate topics tags">
			<span class="author">
			Greg Rienzi</span>
	<span class="sep">/</span>
		January 1, 2013
		<span class="topics-in">Posted in <a href="/science-technology">Science+Technology</a></span>
		</p>
		<div class="body-content">
			<div class="article-inset"><div class="gallery"><h5><b>Photos / </b><span>Cook-off</span></h5></div></div>
			<p>Students in Noah Cowan's class built cooking devices.</p>
			<p>The SGA judged the end-of-semester cook-off.</p>
		</div>
		<div class="article-sidebar sidebar col end"><h2>Around the Hub</h2></div>
</div>
</body></html>`;

function staticCapture(path: string, stamp = "20090221090457", host = "http://www.jhu.edu:80/~gazette/") {
    const capture = gazetteCapture(`${host}${path}`, stamp);
    assert.ok(capture, `fixture capture ${path}`);
    return capture;
}

// ---------------------------------------------------------------------------
// Identity and listing
// ---------------------------------------------------------------------------

console.log("\nidentity");

const spellings = [
    "http://www.jhu.edu:80/~gazette/2009/09feb09/09cepar.html",
    "http://www.jhu.edu:80/%7Egazette/2009/09feb09/09cepar.html",
    "http://jhu.edu/gazette/2009/09feb09/09cepar.html",
    "https://pages.jh.edu/gazette/2009/09feb09/09cepar.html",
].map((url) => gazetteCapture(url, "20090221090457")?.fileId);
check("one static article is one key under every host and tilde spelling",
    spellings.every((id) => id === "gazette:static/2009/09feb09/09cepar.html"), spellings);

check("static articles link readers to the live JHU page",
    gazetteCapture("http://www.jhu.edu:80/~gazette/octdec96/oct0796/teach.html", "1")?.liveUrl ===
        "https://pages.jh.edu/gazette/octdec96/oct0796/teach.html");

for (const [url, why] of [
    ["http://www.jhu.edu:80/~gazette/2009/09feb09/", "an issue's table of contents"],
    ["http://www.jhu.edu:80/~gazette/2009/09feb09/index.html", "an issue index file"],
    ["http://www.jhu.edu:80/~gazette/2009/16feb09/16jobs.html", "the job listings"],
    ["http://www.jhu.edu:80/~gazette/2006/09jan06/09class.html", "the classified ads"],
    ["http://www.jhu.edu:80/~gazette/2009/04may09/images/04page1x.jpg", "an image"],
    ["http://www.jhu.edu:80/~gazette/president/index.html", "a page outside the issues"],
    ["http://www.jhu.edu:80/~gazette/1994/fall94/note.html", "a folder that names no issue date"],
    ["http://www.jhu.edu:80/~gazette/janmar96/jan0296/02employ.html", "the 1990s employment listings"],
    ["http://gazette.jhu.edu/2012/01/09/classifieds-january-9-2012/", "the WordPress classified ads"],
    ["http://gazette.jhu.edu/2010/02/08/mosbacher-lecture/feed/", "a comment feed"],
    ["http://gazette.jhu.edu/2010/10/04/learning-from-the-wire/?print", "a print view"],
    ["http://gazette.jhu.edu:80/2010/01/", "a monthly archive"],
    ["http://gazette.jhu.edu/2007/10/22/the-manners-maven/", "a static-era article imported into WordPress"],
    ["http://hub.jhu.edu/gazette/2013/april", "a Hub issue page"],
    ["http://hub.jhu.edu/gazette/2013/april/this-month-arts?printerfriendly=true", "a Hub print view"],
] as const) {
    check(`not an article: ${why}`, gazetteCapture(url, "20100101000000") === null, gazetteCapture(url, "1"));
}

const wordpress = gazetteCapture("http://gazette.jhu.edu:80/2010/11/01/gilman-past-and-present/", "20101107162728");
check("a WordPress post is keyed by its date and slug, dated by its path",
    wordpress?.fileId === "gazette:wp/2010/11/01/gilman-past-and-present" &&
    wordpress.listedOn === "2010-11-01" &&
    wordpress.liveUrl === "https://gazette.jhu.edu/2010/11/01/gilman-past-and-present/", wordpress);

const hubIds = [
    "http://hub.jhu.edu:80/gazette/2013/january/noah-cowan-tasty-assignment",
    "https://hub.jhu.edu/gazette/2013/january/noah-cowan-tasty-assignment/",
].map((url) => gazetteCapture(url, "1")?.fileId);
check("a Hub article is one key with or without its trailing slash",
    hubIds.every((id) => id === "gazette:hub/2013/january/noah-cowan-tasty-assignment"), hubIds);

check("issue folders in both spellings are dated",
    staticIssueDate("jan0801") === "2001-01-08" &&
    staticIssueDate("09jan06") === "2006-01-09" &&
    staticIssueDate("oct0796") === "1996-10-07" &&
    staticIssueDate("dec1800") === "2000-12-18" &&
    staticIssueDate("jul1194") === "1994-07-11" &&
    // Not a month folder: the Monday issue of September 19, 1994.
    staticIssueDate("sep1994") === "1994-09-19" &&
    staticIssueDate("fall94") === null,
    ["jan0801", "09jan06", "oct0796", "dec1800", "jul1194", "sep1994", "fall94"].map(staticIssueDate));

check("the capture URL asks for the raw bytes, not the Wayback toolbar",
    captureUrl({ timestamp: "20090221090457", original: "http://www.jhu.edu:80/~gazette/a/b/c.html" }) ===
        "https://web.archive.org/web/20090221090457id_/http://www.jhu.edu:80/~gazette/a/b/c.html");

const prefixes1996 = yearPrefixes(1996);
check("1995-1998 are listed by quarter folder on every static host",
    prefixes1996.includes("jhu.edu/~gazette/octdec96/") &&
    prefixes1996.includes("pages.jh.edu/gazette/janmar96/") &&
    prefixes1996.includes("jhu.edu/gazette/1996/"), prefixes1996);
check("2012 is listed on both WordPress and the Hub, 2015 on the Hub alone",
    yearPrefixes(2012).includes("gazette.jhu.edu/2012/") &&
    yearPrefixes(2012).includes("hub.jhu.edu/gazette/2012/") &&
    yearPrefixes(2015).length === 1, [yearPrefixes(2012), yearPrefixes(2015)]);

const cdx = JSON.stringify([
    ["timestamp", "original"],
    ["20110527223301", "http://www.jhu.edu:80/~gazette/2009/02mar09/02hopsip.html"],
    ["20090305000000", "http://www.jhu.edu/%7Egazette/2009/02mar09/02hopsip.html"],
    ["20090306000000", "http://www.jhu.edu/~gazette/2009/02mar09/"],
    ["20090307000000", "http://www.jhu.edu/~gazette/2009/02mar09/02jobs.html"],
]);
const listed = parseCdx(cdx);
check("a listing keeps articles only, one per key, from the earliest capture",
    listed.length === 1 && listed[0]!.timestamp === "20090305000000", listed);
check("merging listings from several hosts keeps the earliest capture",
    mergeCaptures([listed, [{ ...listed[0]!, timestamp: "20080101000000" }]])[0]!.timestamp === "20080101000000");
check("an unreadable listing is empty, not an error", parseCdx("<html>504 Gateway Time-out</html>").length === 0);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

console.log("\nparsing");

const modern = parseCapture(STATIC_2009, staticCapture("2009/09feb09/09council.html"));
check("2000s template: headline joined across its line break", modern?.headline === "Student Council Elects New Leaders", modern?.headline);
check("2000s template: byline taken out of the body", modern?.byline === "Gary Stephenson", modern?.byline);
check("2000s template: dated from the issue folder", modern?.publishedOn === "2009-02-09");
check("2000s template: body without masthead, navigation or footer",
    modern?.paragraphs.length === 2 &&
    modern.paragraphs[0] === "The Homewood Student Council chose its officers on Tuesday, and the new president said the council's first priority is the shuttle." &&
    !modern.paragraphs.join(" ").match(/About The Gazette|TABLE OF CONTENTS|Suite 540|Vol\. 38/), modern?.paragraphs);

const turn = parseCapture(STATIC_2001, staticCapture("2001/mar1901/19council.html", "20020909182433"));
check("1999-2002 template: the bold issue date is not the headline",
    turn?.headline === "Student Council Backs a Later Library Closing", turn?.headline);
check("1999-2002 template: byline, and a body that stops at the footer",
    turn?.byline === "Marjorie Centofanti JHMI" &&
    turn.paragraphs.join("|") === "The Student Council voted to ask for later hours at the Eisenhower Library.",
    turn && { byline: turn.byline, paragraphs: turn.paragraphs });

const commaless = parseCapture(
    STATIC_2001.replace("March 19, 2001</b>", "Mar. 23 1998</b>"),
    staticCapture("janmar98/mar2398/23council.html", "19980601000000"),
);
check("early-1998 template: a dateline without its comma is not the headline either",
    commaless?.headline === "Student Council Backs a Later Library Closing", commaless?.headline);

const older = parseCapture(STATIC_1996, staticCapture("octdec96/oct0796/teach.html", "19970518210301"));
check("1990s template: <h3> headline", older?.headline === "Teaching Teachers To Teach", older?.headline);
check("1990s template: the navigation links below the article are not body text",
    !!older && !older.paragraphs.some((paragraph) => /Go back to Previous Page|Gazette Homepage/.test(paragraph)), older?.paragraphs);
check("1990s template: the article's own text is kept",
    !!older?.paragraphs.includes("The Student Government Association of the School of Continuing Studies endorsed the report."), older?.paragraphs);

const plain = parseCapture(STATIC_1994, staticCapture("1994/jul1194/cheers.html", "20021105152932"));
check("1994 <pre> issue: the section title is the headline", plain?.headline === "CHEERS", plain?.headline);
check("1994 <pre> issue: indented lines open paragraphs and wrapped lines rejoin",
    plain?.paragraphs.join("|") ===
        "Cheers recognizes achievement of consequence among faculty, staff and students.|" +
        "Orest Ranum has been elected to the Collège de France, in Paris.|" +
        "The Student Council honored its outgoing treasurer.", plain?.paragraphs);

const latin1 = new Uint8Array([...Buffer.from("Coll"), 0xe8, ...Buffer.from("ge")]);
check("undeclared Latin-1 bytes decode as Latin-1, not as replacement characters", decodePage(latin1) === "Collège");
check("UTF-8 bytes decode as UTF-8", decodePage(new Uint8Array(Buffer.from("building’s"))) === "building’s");

const post = parseCapture(WORDPRESS, wordpress!);
check("WordPress: headline, byline and printed date",
    post?.headline === "Gilman, past and present" && post.byline === "Tracey A. Reeves" && post.publishedOn === "2010-11-01",
    post && { headline: post.headline, byline: post.byline, publishedOn: post.publishedOn });
check("WordPress: photo captions, related links and sidebars are not body text",
    post?.paragraphs.join("|") ===
        "More than 400 people turned out to celebrate the rededication of Gilman Hall.|" +
        "The Student Government Association president spoke for undergraduates.", post?.paragraphs);

const hub = parseCapture(HUB, gazetteCapture("http://hub.jhu.edu:80/gazette/2013/january/noah-cowan-tasty-assignment", "20130105045011")!);
check("Hub: headline, deck and byline",
    hub?.headline === "Engineering students get deliciously inventive" &&
    hub.subhead === "Course's capstone: design, build cooking-related device" &&
    hub.byline === "Greg Rienzi", hub && { headline: hub.headline, subhead: hub.subhead, byline: hub.byline });
check("Hub: dated from the byline line when the template has no date meta tag", hub?.publishedOn === "2013-01-01", hub?.publishedOn);
const undatedHub = parseCapture(HUB.replace("January 1, 2013", ""),
    gazetteCapture("http://hub.jhu.edu:80/gazette/2015/may-june/no-date-printed", "20150601000000")!);
check("Hub: a page with no printed date takes its issue's first month", undatedHub?.publishedOn === "2015-05-01", undatedHub?.publishedOn);
check("Hub: photo galleries are not body text",
    hub?.paragraphs.join("|") === "Students in Noah Cowan's class built cooking devices.|The SGA judged the end-of-semester cook-off.",
    hub?.paragraphs);

check("a double <br> separates the items of a notice list",
    blocksOf("<p>Lecture<br><br>Concert<br>at noon</p>").join("|") === "Lecture|Concert at noon");
check("hyphen rules separate <pre> sections", preBlocks("ONE\n-----\nTWO").join("|") === "ONE|TWO");

// ---------------------------------------------------------------------------
// The stored text and the phrase test
// ---------------------------------------------------------------------------

console.log("\nstored text");

const markdown = gazetteMarkdown(modern!);
check("attribution names the reporter, the paper and the day",
    markdown.includes("*By Gary Stephenson · The Johns Hopkins Gazette · February 9, 2009*"), markdown);
check("the stored text names the Wayback capture it was read from",
    markdown.endsWith("*Text read from the Internet Archive's capture: https://web.archive.org/web/20090221090457/http://www.jhu.edu:80/~gazette/2009/09feb09/09council.html*"),
    markdown.slice(-200));
check("the phrase test reads the article, not its attribution or capture line",
    !gazetteSearchableText(modern!).includes("Internet Archive") && !gazetteSearchableText(modern!).includes("Johns Hopkins Gazette"));
check("Student Council coverage is kept", matchedPhrases(gazetteSearchableText(modern!)).join() === "student council");
check("SGA coverage is kept", matchedPhrases(gazetteSearchableText(hub!)).join() === "sga");
check("an article that never names the student government is refused",
    matchedPhrases("The faculty council met on Tuesday about the Sgarlata lecture.").length === 0);

// ---------------------------------------------------------------------------
// Secondary-source rules
// ---------------------------------------------------------------------------

console.log("\nsecondary source");

check("a Gazette article is a secondary kind", isSecondaryKind("gazette.article"));
check("it is labelled as the Gazette's", documentKindLabel("gazette.article") === "Gazette article");
check("the publisher is named for the page", secondaryPublisher("gazette.article")?.short === "the Gazette" &&
    secondaryPublisher("newsletter.article")?.short === "the News-Letter" && secondaryPublisher("minutes.senate") === null);

const gazettePrompt = summarySystemPrompt("gazette.article");
check("the Gazette summary prompt attributes to the Gazette",
    gazettePrompt.includes('"the Gazette reported that ..."') && gazettePrompt.includes("saying that this is a Gazette article"));
check("the Gazette summary prompt never mentions the News-Letter", !gazettePrompt.includes("News-Letter"));
check("the Gazette summary prompt says whose paper it was",
    gazettePrompt.includes("The Johns Hopkins Gazette, the newspaper the university administration published"));
check("the Gazette prompt has its own version, and the News-Letter's is unchanged",
    summaryPromptVersion("gazette.article") === "gazette-summary-v1" &&
    summaryPromptVersion("newsletter.article") === "secondary-summary-v1");

// ---------------------------------------------------------------------------
// A run, against an in-memory database and a fake Wayback Machine
// ---------------------------------------------------------------------------

async function ingestion() {
    console.log("\ningestion");
    process.env.GAZETTE_REQUEST_DELAY_MS = "0";

    const documents = new Map<string, { kind: string; discoveredVia: string; source: string; matchedPhrases: string }>();
    const misses = new Set<string>();
    const db = {
        document: {
            findMany: async ({ where }: { where: { driveFileId: { startsWith: string } } }) =>
                [...documents.keys()].filter((id) => id.startsWith(where.driveFileId.startsWith))
                    .map((driveFileId) => ({ driveFileId, datedAt: null, driveCreatedTime: null, driveModifiedTime: null })),
            findUnique: async () => null,
            upsert: async ({ create }: { create: { driveFileId: string; kind: string; discoveredVia: string; source: string; matchedPhrases: string } }) => {
                documents.set(create.driveFileId, create);
                return { id: create.driveFileId };
            },
        },
        newsletterMiss: {
            findMany: async ({ where }: { where: { fileId: { startsWith: string } } }) =>
                [...misses].filter((id) => id.startsWith(where.fileId.startsWith)).map((fileId) => ({ fileId })),
            upsert: async ({ create }: { create: { fileId: string } }) => { misses.add(create.fileId); return {}; },
            deleteMany: async () => ({ count: 0 }),
        },
        documentRevision: { upsert: async () => ({ id: "revision" }) },
        documentVersion: { upsert: async () => ({}) },
        documentPassage: { deleteMany: async () => ({}), createMany: async () => ({}) },
        $transaction: async (work: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
            typeof work === "function" ? work(db) : Promise.all(work),
    };
    Object.assign(globalThis, { prisma: db });

    const { ingestGazetteCoverage } = await import("../lib/gazette-coverage");

    const listing = JSON.stringify([
        ["timestamp", "original"],
        ["20090221090457", "http://www.jhu.edu:80/~gazette/2009/09feb09/09council.html"],
        ["20090221090458", "http://www.jhu.edu:80/~gazette/2009/09feb09/09other.html"],
    ]);
    const unrelated = STATIC_2009.replaceAll("Student Council", "Faculty Senate").replaceAll("council's", "senate's");

    const requested: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.includes("/cdx/search/cdx")) {
            return new Response(new URL(url).searchParams.get("url") === "jhu.edu/~gazette/2009/" ? listing : "[]");
        }
        return new Response(url.includes("09council") ? STATIC_2009 : unrelated);
    };

    try {
        const first = await ingestGazetteCoverage({ years: [2009], runBudgetMs: 60_000 });
        assert.equal(first.articlesCreated, 1);
        assert.equal(first.articlesRejected, 1);
        check("a run stores what mentions the student government and refuses the rest",
            first.articlesCreated === 1 && first.articlesRejected === 1 && first.completedThrough === 2009, first);

        const stored = documents.get(`${GAZETTE_FILE_PREFIX}static/2009/09feb09/09council.html`);
        check("it is stored as a Gazette article, linked to the live page",
            stored?.kind === "gazette.article" && stored.discoveredVia === "gazette" &&
            stored.source === "https://pages.jh.edu/gazette/2009/09feb09/09council.html" &&
            stored.matchedPhrases === "student council", stored);
        check("the refusal is remembered under the Gazette's prefix",
            misses.has(`${GAZETTE_FILE_PREFIX}static/2009/09feb09/09other.html`), [...misses]);

        const articleFetches = requested.filter((url) => url.includes("id_/")).length;
        const second = await ingestGazetteCoverage({ years: [2009], runBudgetMs: 60_000 });
        check("a second run fetches nothing it has already decided",
            second.alreadyHeld === 1 && second.alreadyRefused === 1 &&
            requested.filter((url) => url.includes("id_/")).length === articleFetches, second);

        documents.clear();
        misses.clear();
        const limited = await ingestGazetteCoverage({ years: [2009], limit: 1, runBudgetMs: 60_000 });
        check("the article budget stops a run and says so",
            limited.budgetReached && limited.articlesCreated + limited.articlesRejected === 1 && limited.completedThrough === null, limited);

        globalThis.fetch = async () => new Response("busy", { status: 404 });
        await assert.rejects(ingestGazetteCoverage({ years: [2009], runBudgetMs: 60_000 }), /CDX listing/);
        check("a listing the Wayback Machine will not give fails the run rather than reading as an empty year", true);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

ingestion()
    .catch((error) => {
        failures += 1;
        console.error(error);
    })
    .finally(() => {
        console.log(failures === 0 ? "\ngazette checks passed" : `\n${failures} gazette check(s) failed`);
        if (failures > 0) process.exitCode = 1;
    });
