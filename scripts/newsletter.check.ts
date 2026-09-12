/**
 * Checks the rules that read The Johns Hopkins News-Letter: that an article is
 * identified by the same key however its URL was written, that a search listing
 * yields only articles, that a page's headline, byline, date and body are read
 * off it correctly, that the phrase test keeps what mentions the SGA and refuses
 * what merely looks like it does, that none of the pipeline built for SGA
 * documents treats an article as one, and that the plain-language summary an
 * article does get is written as the paper's reporting rather than as an SGA act.
 *
 * The HTML below is cut down from pages actually served in September 2026 --
 * the wrappers, the entity escaping, the nested figure divs and the empty
 * `creator` are all as the CMS emits them. No network: a check that needs the
 * site to be up is a check that fails when the site is down.
 */
import { documentKindLabel, isSecondaryKind, isDocumentKind, AUTHORITATIVE_KINDS, COMPARABLE_KINDS } from "../lib/kinds";
import { sessionForDate } from "../lib/identity";
import { meetingFor, meetingLog } from "../lib/meetings";
import {
    articleBody,
    articleMarkdown,
    decodeEntities,
    matchedPhrases,
    newsletterFileId,
    parseArticle,
    parseResultCount,
    parseSearchResults,
    searchUrl,
} from "../lib/newsletter";
import { summaryPromptVersion, summarySystemPrompt } from "../lib/summary-prompt";
import { canonicalTitle, standardTitles } from "../lib/titles";

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

/**
 * A search listing. Four blocks: two ordinary articles, one result that is a
 * photo rather than an article, and a repeat of the first -- which is what the
 * listing genuinely does when a piece is filed under two sections.
 *
 * The third line of a block is a byline in one and a date in another, on
 * purpose: it is unpredictable in the real listing, and nothing may depend on it.
 */
const SEARCH_PAGE = `
<div class="col-md-8 search-result">
    <p class="copy"><strong>46 items</strong> found for your search.</p>
    <ul class="pagination">
        <li><a href="/search?keywords=sga&amp;page=2&amp;per_page=200">Next &rsaquo;</a></li>
        <li><a href="/search?keywords=sga&amp;page=1&amp;per_page=200">Last &raquo;</a></li>
    </ul>
    <article class="clearfix">
        <h4><a href="https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions">Alcohol policy adds amnesty, definitions</a></h4>
        <div class="smaller"><em>(12/03/15 7:06pm)</em></div>
        <p>By ABBY BIESMAN and CATHERINE PALMER</p>
        <div class="smaller text-break"><a href="https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions">https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions</a></div>
    </article>
    <article class="clearfix">
        <h4><a href="https://www.jhunewsletter.com/article/2012/05/sga-falls-short-with-election-remedy-10397">SGA falls short with election remedy &amp; other tales</a></h4>
        <div class="smaller"><em>(05/07/12 5:00am)</em></div>
        <p>May 3, 2012</p>
    </article>
    <article class="clearfix">
        <h4><a href="https://www.jhunewsletter.com/multimedia/sga-swearing-in-2015">SGA swearing in, in pictures</a></h4>
        <div class="smaller"><em>(12/04/15 9:00am)</em></div>
    </article>
    <article class="clearfix">
        <h4><a href="https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions">Alcohol policy adds amnesty, definitions</a></h4>
        <div class="smaller"><em>(12/03/15 7:06pm)</em></div>
    </article>
</div>
`;

/** A search page for a window past the end of the results. Still has a "Next". */
const EMPTY_SEARCH_PAGE = `
<div class="col-md-8 search-result">
    <p class="copy"><strong>46 items</strong> found for your search.</p>
    <hr class="double hairline" />
</div>
`;

/**
 * An article page, with the figure and caption divs that sit inside the body.
 * Those are why the body's end is found by counting divs rather than by looking
 * for the next closing tag.
 */
const ARTICLE_PAGE = `
<head>
<script type="application/ld+json">
{
    "@context": "http://schema.org",
    "@type": "NewsArticle",
    "headline": "SGA discusses construction and swears in new members in semester\u2019s last meeting",
    "url": "https://www.jhunewsletter.com/article/2025/11/sga-discusses-construction-and-swears-in-new-members-in-semesters-last-meeting",
    "dateCreated": "2025-11-20T11:00:00+00:00",
    "articleSection": "News &amp; Features",
    "creator": [""],
    "keywords": ["news","weekly-rundown"]
}
</script>
</head>
<body>
<article class="full-article">
    <h1 class="headline">SGA discusses construction and swears in new members in semester\u2019s last meeting</h1>
    <h2 class="subhead">Senators heard from facilities before cohort time</h2>
    <p class="authors">
        By <a href="https://www.jhunewsletter.com/staff/henry-serringer">HENRY SERRINGER</a>
        | November 20, 2025
    </p>
</article>
<article class="full-article">
    <figure class="full-bleed has-caption mb-0">
        <div class="domphoto-wrap">
            <img src="https://snworksceo.imgix.net/jhn/x.JPG?w=1000" alt="jll-6217" class="article-img">
        </div>
    </figure>
    <div class="article-content">
        <p>The University\u2019s Student Government Association (SGA) gathered on Tuesday, Nov. 18 in Hackerman Hall for the fifteenth and last general body meeting of the semester.</p>
        <div class="embedded-media"><p>Read more coverage in our archives.</p></div>
        <p>The discussion kicked off with plans for the renovation of the Eisenhower Library, including <a href="/article/2025/10/ada">ADA compliance</a>.</p>
        <p></p>
        <p>To round out the last meeting, the committees had cohort time.</p>
    </div>
    <div class="article-footer">
        <p>Have a tip? Email us.</p>
    </div>
</article>
</body>
`;

/**
 * A digitised print article: no subhead, no section but "Archives", and a
 * timestamp that falls on the previous day in Baltimore. The date the paper
 * printed under the headline is the one to file it under.
 */
const ARCHIVE_PAGE = `
<script type="application/ld+json">
{
    "@type": "NewsArticle",
    "headline": "A fresh start for Student Council",
    "dateCreated": "2008-03-27T03:30:00+00:00",
    "articleSection": "Archives",
    "creator": [""]
}
</script>
<article class="full-article">
    <h1 class="headline">A fresh start for Student Council</h1>
    <h2 class="subhead"></h2>
    <p class="authors">
        By <a href="https://www.jhunewsletter.com/staff/evan-lazerowitz">Evan Lazerowitz</a>
        | March 26, 2008
    </p>
</article>
<div class="article-content">
    <p>This weekend, students will vote on a new Student Council constitution.</p>
</div>
`;

/**
 * The template the paper used until about 2016, which is most of the archive.
 * There is no `<p class="authors">` at all: the date is bare text after the
 * subhead, and the byline is the first paragraph of the body.
 */
const OLD_TEMPLATE_PAGE = `
<script type="application/ld+json">
{
    "@type": "NewsArticle",
    "headline": "SGA hosts international student forum",
    "dateCreated": "2015-11-20T03:01:18+00:00",
    "articleSection": "News &amp; Features",
    "creator": [""]
}
</script>
<article class="full-article">
    <h1 class="headline">SGA hosts international student forum</h1>
    <h2 class="subhead"></h2>
    November 19, 2015
</article>
<div class="article-content">
    <p>By KAREN SHENG For The News-Letter</p>
    <p>The Student Government Association (SGA) partnered with the Office of International Services to host a forum in Shaffer Hall last Thursday.</p>
</div>
`;

/** A first paragraph that opens with "By" and is a sentence, not a credit. */
const BY_SENTENCE_PAGE = `
<article class="full-article">
    <h1 class="headline">Senate adjourns without a quorum</h1>
    <h2 class="subhead"></h2>
    April 2, 2016
</article>
<div class="article-content">
    <p>By the time the SGA reconvened, half the senators had left the room.</p>
    <p>The chair adjourned the meeting.</p>
</div>
`;

/** No schema.org block and no printed date: the page states no date at all. */
const UNDATED_PAGE = `
<article class="full-article">
    <h1 class="headline">Students weigh in on the SGA budget</h1>
    <p class="authors">By STAFF WRITER</p>
</article>
<div class="article-content"><p>The SGA released its budget on Friday.</p></div>
`;

/** Malformed metadata. The page still prints everything that matters. */
const BAD_LD_PAGE = `
<script type="application/ld+json">{ "headline": "unterminated,, </script>
<article class="full-article">
    <h1 class="headline">SGA overhauls election rules</h1>
    <p class="authors">By JANE DOE | March 5, 2009</p>
</article>
<div class="article-content"><p>The student government voted on Tuesday.</p></div>
`;

/** A page whose body did not render. Nothing here a citation could point at. */
const BODYLESS_PAGE = `
<article class="full-article">
    <h1 class="headline">SGA meets</h1>
    <p class="authors">By JANE DOE | March 5, 2009</p>
</article>
<div class="article-content">
    <figure><div class="domphoto-wrap"></div></figure>
</div>
`;

/** A credit and nothing else. Stripping the byline leaves no article. */
const CREDIT_ONLY_PAGE = `
<article class="full-article">
    <h1 class="headline">SGA election results</h1>
    <h2 class="subhead"></h2>
    April 2, 2016
</article>
<div class="article-content"><p>By JANE DOE For The News-Letter</p></div>
`;

const ARTICLE_URL =
    "https://www.jhunewsletter.com/article/2025/11/sga-discusses-construction-and-swears-in-new-members-in-semesters-last-meeting";

// ---------------------------------------------------------------------------

console.log("identity");

check(
    "an article path becomes a stable key",
    newsletterFileId(
        "https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions",
    ) === "newsletter:2015/12/alcohol-policy-adds-amnesty-definitions",
    newsletterFileId("https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions"),
);
check(
    // The same article is linked four ways across the site; all four are one row.
    "host, scheme, trailing slash and query do not change the key",
    new Set(
        [
            "https://www.jhunewsletter.com/article/2015/12/a-piece",
            "http://jhunewsletter.com/article/2015/12/a-piece",
            "https://www.jhunewsletter.com/article/2015/12/a-piece/",
            "https://www.jhunewsletter.com/article/2015/12/a-piece?utm_source=x#top",
            "/article/2015/12/a-piece",
        ].map((url) => newsletterFileId(url)),
    ).size === 1,
    [
        newsletterFileId("http://jhunewsletter.com/article/2015/12/a-piece"),
        newsletterFileId("/article/2015/12/a-piece"),
    ],
);
check(
    "the numeric suffix on a digitised slug is kept",
    newsletterFileId("https://www.jhunewsletter.com/article/2008/03/a-fresh-start-16915") ===
    "newsletter:2008/03/a-fresh-start-16915",
);
check(
    "a photo gallery is not an article",
    newsletterFileId("https://www.jhunewsletter.com/multimedia/sga-swearing-in-2015") === null,
);
check(
    "a section index is not an article",
    newsletterFileId("https://www.jhunewsletter.com/section/news") === null,
);
check(
    // Otherwise anything the paper linked to could be ingested as its own work.
    "another site's article is refused",
    newsletterFileId("https://www.nytimes.com/article/2015/12/a-piece") === null,
);
check(
    "a hostname merely ending in the domain name is refused",
    newsletterFileId("https://notjhunewsletter.com/article/2015/12/a-piece") === null,
);
check("nonsense is refused", newsletterFileId("not a url") === null);

console.log("\nsearch listings");

const results = parseSearchResults(SEARCH_PAGE);

check("only the articles are returned", results.length === 2, results);
check(
    "a repeated result is one result",
    new Set(results.map((result) => result.fileId)).size === results.length,
);
check(
    "the headline is decoded",
    results[1]?.headline === "SGA falls short with election remedy & other tales",
    results[1]?.headline,
);
check(
    "the listing timestamp becomes a date",
    results[0]?.listedOn === "2015-12-03",
    results[0]?.listedOn,
);
check(
    "each result carries a canonical URL to fetch",
    results[0]?.url ===
    "https://www.jhunewsletter.com/article/2015/12/alcohol-policy-adds-amnesty-definitions",
    results[0]?.url,
);
check(
    // The only terminator the markup offers: the last page still links a "Next".
    "a page past the end lists nothing",
    parseSearchResults(EMPTY_SEARCH_PAGE).length === 0,
);
check("the reported hit count is read", parseResultCount(SEARCH_PAGE) === 46);
check("a page with no count reads null", parseResultCount("<p>nothing</p>") === null);

const url = searchUrl({ phrase: "student government", year: 2015, page: 3 });
check(
    "a search is fenced to one calendar year",
    url.includes("ts_year=2015") && url.includes("te_year=2015") &&
    url.includes("ts_month=1") && url.includes("te_month=12") && url.includes("te_day=31"),
    url,
);
check(
    "the phrase is escaped into the query",
    url.includes("s=student+government"),
    url,
);
check("the page and page size are asked for", url.includes("page=3") && url.includes("per_page=200"));

console.log("\nreading an article");

const article = parseArticle(ARTICLE_PAGE, ARTICLE_URL);

check("the page parses", article !== null);
check(
    "the headline comes off the page, entities and all",
    article?.headline ===
    "SGA discusses construction and swears in new members in semester\u2019s last meeting",
    article?.headline,
);
check("the subhead is kept", article?.subhead === "Senators heard from facilities before cohort time", article?.subhead);
check(
    // "By HENRY SERRINGER | November 20, 2025" -- the name, not the furniture.
    "the byline is the reporter's name alone",
    article?.byline === "HENRY SERRINGER",
    article?.byline,
);
check(
    "the paper's own section is read from its metadata",
    article?.section === "News & Features",
    article?.section,
);
check(
    "the publication date is the one printed under the headline",
    article?.publishedOn === "2025-11-20",
    article?.publishedOn,
);
check(
    // Nested figure and caption divs sit inside the body, and the footer sits
    // outside it. Counting divs is the only way to tell where it ends.
    "the body stops at its own closing tag, not the first one",
    article?.paragraphs.length === 4 &&
    article.paragraphs[3] === "To round out the last meeting, the committees had cohort time.",
    article?.paragraphs,
);
check(
    "a link inside a paragraph is kept as its text",
    article?.paragraphs[2]?.includes("including ADA compliance.") === true,
    article?.paragraphs[2],
);
check(
    "an empty paragraph is not a paragraph",
    article?.paragraphs.every((paragraph) => paragraph.length > 0) === true,
);
check(
    "the promotional footer outside the body is not body text",
    article?.paragraphs.some((paragraph) => paragraph.includes("Have a tip")) === false,
);

const archived = parseArticle(
    ARCHIVE_PAGE,
    "https://www.jhunewsletter.com/article/2008/03/a-fresh-start-for-student-council-16915",
);

check("a digitised print article parses", archived !== null);
check("an empty subhead is empty, not whitespace", archived?.subhead === "", archived?.subhead);
check(
    // The instant is 27 March UTC and the paper printed it on the 26th.
    // Filing it forward a day would move an article across a month boundary.
    "the printed date beats the timestamp",
    archived?.publishedOn === "2008-03-26",
    archived?.publishedOn,
);
check("the archives section is read", archived?.section === "Archives", archived?.section);

const older = parseArticle(
    OLD_TEMPLATE_PAGE,
    "https://www.jhunewsletter.com/article/2015/11/sga-hosts-international-student-forum",
);

check("the pre-2016 template parses", older !== null);
check(
    // The date is bare text between the subhead and the closing tag, with no
    // element around it. Most of the archive is filed by this rule.
    "a date printed with no element around it is still read",
    older?.publishedOn === "2015-11-19",
    older?.publishedOn,
);
check(
    "a byline left in the body is read as the byline",
    older?.byline === "KAREN SHENG",
    older?.byline,
);
check(
    // Otherwise the stored text opens by crediting the reporter and the byline
    // the archive writes above it credits nobody.
    "that byline is taken out of the body",
    older?.paragraphs.length === 1 &&
    older.paragraphs[0]?.startsWith("The Student Government Association"),
    older?.paragraphs,
);
check(
    "the byline reaches the stored text",
    articleMarkdown(older!).includes(
        "*By KAREN SHENG · The Johns Hopkins News-Letter · November 19, 2015*",
    ),
    articleMarkdown(older!).split("\n").find((line) => line.startsWith("*")),
);

const bySentence = parseArticle(
    BY_SENTENCE_PAGE,
    "https://www.jhunewsletter.com/article/2016/04/senate-adjourns",
);

check(
    // The bound that keeps the byline rule from eating an article's first line.
    "a first sentence beginning \"By\" is not mistaken for a byline",
    bySentence?.byline === "" && bySentence?.paragraphs.length === 2,
    [bySentence?.byline, bySentence?.paragraphs],
);
check(
    "a page that is only a credit is not stored as an empty document",
    parseArticle(CREDIT_ONLY_PAGE, "https://www.jhunewsletter.com/article/2016/04/results") === null,
);
check(
    "a page stating no date is left undated rather than dated from its URL",
    parseArticle(UNDATED_PAGE, "https://www.jhunewsletter.com/article/2019/04/a-piece")
        ?.publishedOn === null,
);
check(
    "an unsigned piece has an empty byline, not a missing article",
    parseArticle(UNDATED_PAGE, "https://www.jhunewsletter.com/article/2019/04/a-piece")
        ?.paragraphs.length === 1,
);
check(
    // Everything that matters is printed on the page as well as in the metadata.
    "malformed metadata does not lose the article",
    parseArticle(BAD_LD_PAGE, "https://www.jhunewsletter.com/article/2009/03/a-piece")
        ?.publishedOn === "2009-03-05",
    parseArticle(BAD_LD_PAGE, "https://www.jhunewsletter.com/article/2009/03/a-piece"),
);
check(
    "a page with no body text is not stored as an empty document",
    parseArticle(BODYLESS_PAGE, "https://www.jhunewsletter.com/article/2009/03/a-piece") === null,
);
check(
    "a page fetched from a URL that is not an article is refused",
    parseArticle(ARTICLE_PAGE, "https://www.jhunewsletter.com/multimedia/pictures") === null,
);

console.log("\nentities");

check("a hex reference decodes", decodeEntities("Published&#x20;by") === "Published by");
check("a decimal reference decodes", decodeEntities("it&#39;s") === "it's");
check("a named reference decodes", decodeEntities("amnesty &amp; definitions") === "amnesty & definitions");
check("a curly quote decodes", decodeEntities("semester&rsquo;s") === "semester\u2019s");
check(
    // Better a visible oddity than a silently mangled quote.
    "an unknown entity is left alone",
    decodeEntities("&notanentity;") === "&notanentity;",
);

console.log("\nthe phrase test");

check("the acronym matches", matchedPhrases("The SGA voted on Tuesday.").join() === "sga");
check("a possessive matches", matchedPhrases("the SGA's budget").join() === "sga");
check("a curly possessive matches", matchedPhrases("the SGA\u2019s budget").join() === "sga");
check("a plural matches", matchedPhrases("both SGAs met").join() === "sga");
check("case does not matter", matchedPhrases("the sga met").join() === "sga");
check(
    // The reason the pattern is bounded on the left as well as the right.
    "a surname beginning with the letters does not match",
    matchedPhrases("Ryan Sgarlata coached the team.").length === 0,
    matchedPhrases("Ryan Sgarlata coached the team."),
);
check(
    "a word merely containing the letters does not match",
    matchedPhrases("The visagas festival ran late.").length === 0,
);
check("the full phrase matches", matchedPhrases("the student government voted").join() === "student government");
check(
    "a plural phrase matches",
    matchedPhrases("both student governments agreed").join() === "student government",
);
check(
    "the association's full name matches on the phrase inside it",
    matchedPhrases("the Student Government Association (SGA)").join() === "sga,student government",
    matchedPhrases("the Student Government Association (SGA)"),
);
check(
    // Articles are stored one paragraph per line, so a phrase can straddle one.
    "a phrase broken across a line still matches",
    matchedPhrases("the student\ngovernment voted").join() === "student government",
);
check("the older name matches", matchedPhrases("Student Council met").join() === "student council");
check(
    "a piece mentioning none of them matches nothing",
    matchedPhrases("The lacrosse team beat Maryland on Saturday.").length === 0,
);
check(
    // Recorded on the row, so the order has to be the configured one and not
    // the order they happen to appear in the prose.
    "phrases come back in a stable order",
    matchedPhrases("Student Council became the student government, now the SGA.").join() ===
    "sga,student government,student council",
    matchedPhrases("Student Council became the student government, now the SGA."),
);
check(
    // The whole reason the test is re-run against the fetched text.
    "an abbreviation the paper uses but the archive does not search is not a match",
    matchedPhrases("StuCo met on Tuesday.").length === 0,
);

console.log("\nthe stored text");

const markdown = articleMarkdown(article!);

check(
    "the headline is the document's one heading",
    markdown.startsWith(
        "# SGA discusses construction and swears in new members in semester\u2019s last meeting\n",
    ),
    markdown.slice(0, 90),
);
check(
    // A quote lifted into a summary has to carry its source with it.
    "the byline names the reporter, the paper and the day",
    markdown.includes("*By HENRY SERRINGER · The Johns Hopkins News-Letter · November 20, 2025*"),
    markdown.split("\n").find((line) => line.startsWith("*")),
);
check(
    "the subhead sits between the headline and the byline",
    markdown.indexOf("Senators heard from facilities") > markdown.indexOf("# SGA discusses") &&
    markdown.indexOf("Senators heard from facilities") < markdown.indexOf("*By HENRY"),
);
check(
    "the body follows in the order the paper printed it",
    markdown.indexOf("The University\u2019s Student Government") <
    markdown.indexOf("The discussion kicked off") &&
    markdown.indexOf("The discussion kicked off") < markdown.indexOf("To round out"),
);
check(
    // Citation offsets index into this string, so an unchanged article
    // re-fetched must hash identically or every run would store a revision.
    "the same article renders identically twice",
    articleMarkdown(article!) === articleMarkdown(parseArticle(ARTICLE_PAGE, ARTICLE_URL)!),
);
check(
    "an article with no subhead has no empty line where it would be",
    !articleMarkdown(archived!).includes("\n\n\n"),
    articleMarkdown(archived!).slice(0, 120),
);
check(
    "an unsigned article's byline still names the paper",
    articleMarkdown(
        parseArticle(UNDATED_PAGE, "https://www.jhunewsletter.com/article/2019/04/a-piece")!,
    ).includes("*By STAFF WRITER · The Johns Hopkins News-Letter*"),
);
check(
    // The listing blurb is the first thing the paper wrote, not the byline the
    // archive wrote above it.
    "the body alone carries no byline",
    !articleBody(article!).includes("News-Letter") &&
    articleBody(article!).startsWith("The University\u2019s Student Government Association"),
    articleBody(article!).slice(0, 60),
);
check(
    "the phrases the archive keeps an article for are found in what it stores",
    matchedPhrases(articleMarkdown(article!)).length > 0,
);

console.log("\ndating and session");

check(
    // Sessions turn over in June, so the autumn and spring of one academic
    // year are one session and coverage of them files together.
    "November 2025 coverage belongs to the session sitting from 2025",
    sessionForDate(new Date(Date.UTC(2025, 10, 20, 12))) === 113,
    sessionForDate(new Date(Date.UTC(2025, 10, 20, 12))),
);
check(
    "March 2008 coverage belongs to the session sitting from 2007",
    sessionForDate(new Date(Date.UTC(2008, 2, 26, 12))) === 95,
    sessionForDate(new Date(Date.UTC(2008, 2, 26, 12))),
);
check(
    "a June article belongs to the incoming session, not the outgoing one",
    sessionForDate(new Date(Date.UTC(2026, 5, 3, 12))) === 114 &&
    sessionForDate(new Date(Date.UTC(2026, 4, 30, 12))) === 113,
);

console.log("\nan article is not an SGA record");

check(
    "the kind is one the taxonomy knows",
    isDocumentKind("newsletter.article") && isSecondaryKind("newsletter.article"),
);
check(
    "an SGA document is not secondary",
    !isSecondaryKind("minutes.senate") && !isSecondaryKind("") && !isSecondaryKind(undefined),
);
check(
    // "Newsletter / Article" would read as something the SGA sends out.
    "the label is the paper's name",
    documentKindLabel("newsletter.article") === "News-Letter article",
    documentKindLabel("newsletter.article"),
);
check(
    // A reporter's account of a meeting must never be quotable as the rules.
    "an article can never source a claim about how the SGA works",
    !(AUTHORITATIVE_KINDS as readonly string[]).includes("newsletter.article"),
);
check(
    "two articles about the same committee are not two drafts to diff",
    !(COMPARABLE_KINDS as readonly string[]).includes("newsletter.article"),
);

/** A headline that reads, to every rule in lib/meetings.ts, like minutes. */
const HEADLINE_MEETING = {
    id: "article",
    title: "Senate GBM #13 minutes released after SGA vote",
    folderPath: "",
    sessionNumber: 113,
    kind: "newsletter.article",
    driveCreatedTime: new Date("2025-11-20T12:00:00Z"),
};

check(
    // Without the guard this is keyed "113:senate:13" and paired with the
    // SGA's own agenda for that meeting, as though the paper had held it.
    "a meeting-shaped headline is not made into a meeting",
    meetingFor(HEADLINE_MEETING).key === "" && meetingFor(HEADLINE_MEETING).role === "",
    meetingFor(HEADLINE_MEETING),
);
check(
    "the same title from the master folder still is a meeting",
    meetingFor({ ...HEADLINE_MEETING, kind: "minutes.senate", folderPath: "General SGA/Minutes" })
        .key === "113:senate:13",
    meetingFor({ ...HEADLINE_MEETING, kind: "minutes.senate", folderPath: "General SGA/Minutes" }),
);
check(
    "a headline listing several meetings is not a running log of them",
    meetingLog({
        ...HEADLINE_MEETING,
        content: "Present: nobody\n9/15/25 the Senate met\n10/2/25 the Senate met again",
    }) === null,
);
check(
    // "A fresh start for Student Council" restyled as "JHU SGA Constitution
    // (96th Session)" would put an opinion column forward as the document.
    "a headline is never rewritten into an SGA house name",
    canonicalTitle({
        id: "article",
        title: "SGA Constitution",
        folderPath: "",
        sessionNumber: 113,
        kind: "newsletter.article",
    }) === null,
);
check(
    "an SGA file with that name still gets the house name",
    canonicalTitle({
        id: "doc",
        title: "SGA Constitution",
        folderPath: "Guiding Documents",
        sessionNumber: 113,
        kind: "guiding.constitution",
    }) === "JHU SGA Constitution (113th Session)",
    canonicalTitle({
        id: "doc",
        title: "SGA Constitution",
        folderPath: "Guiding Documents",
        sessionNumber: 113,
        kind: "guiding.constitution",
    }),
);

const displayed = standardTitles([
    {
        id: "article",
        title: "SGA passes CLERPA reform after two readings",
        folderPath: "",
        sessionNumber: 113,
        kind: "newsletter.article",
    },
    {
        id: "minutes",
        title: "MINUTES of Senate GBM #14",
        folderPath: "General SGA/General Body Meetings/Minutes",
        sessionNumber: 113,
        kind: "minutes.senate",
        driveCreatedTime: new Date("2026-03-10T16:00:00Z"),
    },
]);

check(
    // Un-shouting a headline turns the acronyms headlines do use into words.
    "a headline is shown exactly as the paper set it",
    displayed.get("article") === "SGA passes CLERPA reform after two readings",
    displayed.get("article"),
);
check(
    "an SGA filename beside it is still tidied and renamed",
    displayed.get("minutes")?.startsWith("Senate General Body Meeting #14 — Minutes") === true,
    displayed.get("minutes"),
);

console.log("\nan article is summarised as reporting, not as an SGA act");

/**
 * An article does get a plain-language summary, and the difference is the voice
 * it is written in. Asserted on the instructions themselves because that is what
 * can be checked with no database, no key and no model call: what a summary of a
 * secondary source may claim is decided entirely by which of these two prompts
 * the document is read under.
 */
const articlePrompt = summarySystemPrompt("newsletter.article");
const documentPrompt = summarySystemPrompt("minutes.senate");

check(
    "an article is read under its own prompt, not the one for SGA records",
    articlePrompt !== documentPrompt,
);
check(
    "an SGA document still gets the prompt it always got",
    documentPrompt.startsWith(
        "You restate a single Johns Hopkins University Student Government Association document",
    ) && documentPrompt.includes("State what the document says as fact."),
    documentPrompt.slice(0, 80),
);
check(
    // The line that makes an SGA record readable is the line that would make an
    // article a forgery: stated as fact, a reporter's sentence becomes the
    // archive's own claim about what the SGA did.
    "an article is never told to state what it says as fact",
    !articlePrompt.includes("State what the document says as fact.") &&
    !articlePrompt.includes('Never write "the document says", "according to"'),
);
check(
    "an article's claims are attributed to the reporting",
    articlePrompt.includes('"the News-Letter reported that ..."') &&
    articlePrompt.includes("Attribute every claim to the reporting"),
);
check(
    // "The Senate approved the budget" beside an article is the archive
    // asserting an SGA act on a newspaper's authority.
    "the SGA is never the bare subject of a sentence in an article's summary",
    articlePrompt.includes(
        "The SGA, the Senate, a committee, an officer or a student is never the bare subject of a sentence.",
    ),
);
check(
    "the summary says whose account it is",
    articlePrompt.includes("saying that this is a News-Letter article"),
);
check(
    "the prompt states that the SGA did not write, file or approve the article",
    articlePrompt.includes("The SGA did not write it, file it, or approve it"),
);

check(
    // The whole promise of the site: a claim survives only if the text backing
    // it is in the stored source. Relaxing this for a secondary source would not
    // publish looser summaries, it would publish unverifiable ones.
    "the verification rules are the same rules for both",
    [
        "- Each \"quote\" is copied EXACTLY, character for character, from the document. Do not paraphrase, tidy, shorten with ellipses, or fix typos.",
        "- Quote a full sentence or clause, not a few words.",
        "- Every bullet that states a fact ends with one or more markers like [1] or [1][2].",
        "- Every citation must be used at least once, and every marker must have a citation.",
    ].every((rule) => articlePrompt.includes(rule) && documentPrompt.includes(rule)),
);
check(
    "an article is grounded in itself alone",
    articlePrompt.includes("Use only this article. Never use outside knowledge"),
);

check(
    // Written to the two prompts separately, so that revising what an article is
    // told does not invalidate the SGA summaries the archive already holds.
    "the two prompts are versioned apart",
    summaryPromptVersion("newsletter.article") !== summaryPromptVersion("minutes.senate"),
    [summaryPromptVersion("newsletter.article"), summaryPromptVersion("minutes.senate")],
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
