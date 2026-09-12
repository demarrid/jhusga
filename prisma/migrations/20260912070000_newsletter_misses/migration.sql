-- Articles the archive fetched from The Johns Hopkins News-Letter and did not
-- keep, because the article's own text used none of the phrases searched for.
--
-- The paper's search matches loose words across a whole page, so most of what it
-- offers is a false candidate -- twenty-six of thirty in a sampled year. Without
-- this table each of those is fetched again on every run, which is a nightly job
-- making a hundred requests to a third-party site in order to store nothing.
CREATE TABLE "NewsletterMiss" (
    "fileId" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterMiss_pkey" PRIMARY KEY ("fileId")
);
