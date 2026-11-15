-- CreateTable
CREATE TABLE "ReviewedAdministrator" (
    "id" TEXT NOT NULL,
    "hopkinsAffiliateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewedAdministrator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewedAdministratorForm" (
    "id" TEXT NOT NULL,
    "administratorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,

    CONSTRAINT "ReviewedAdministratorForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedAdministrator_hopkinsAffiliateId_key" ON "ReviewedAdministrator"("hopkinsAffiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewedAdministratorForm_text_key" ON "ReviewedAdministratorForm"("text");

-- CreateIndex
CREATE INDEX "ReviewedAdministratorForm_administratorId_idx" ON "ReviewedAdministratorForm"("administratorId");

-- AddForeignKey
ALTER TABLE "ReviewedAdministrator" ADD CONSTRAINT "ReviewedAdministrator_hopkinsAffiliateId_fkey" FOREIGN KEY ("hopkinsAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewedAdministratorForm" ADD CONSTRAINT "ReviewedAdministratorForm_administratorId_fkey" FOREIGN KEY ("administratorId") REFERENCES "ReviewedAdministrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The roster maintainers checked against official sources, moved here from
-- config/reviewed-people.ts. A missing person row is created, so a fresh
-- database gets the roster too.

-- Ronald J. Daniels
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Ronald J. Daniels', 'ronald j daniels', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", '14th President of Johns Hopkins University (since 2009)', 'https://president.jhu.edu/profiles/ronald-j-daniels/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'ronald j daniels';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Ronald J. Daniels', NULL::date, NULL::date),
    ('Ronald Daniels', NULL::date, NULL::date),
    ('Ron Daniels', NULL::date, NULL::date),
    ('President Daniels', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'ronald j daniels';

-- Robert C. Lieberman
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Robert C. Lieberman', 'robert c lieberman', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Provost (July 2013 – June 2016)', 'https://provost.jhu.edu/about/history/former-provosts/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'robert c lieberman';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Robert C. Lieberman', NULL::date, NULL::date),
    ('Robert Lieberman', NULL::date, NULL::date),
    ('Provost Lieberman', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'robert c lieberman';

-- Sunil Kumar
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Sunil Kumar', 'sunil kumar', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Provost (2016 – 2023)', 'https://provost.jhu.edu/about/history/former-provosts/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'sunil kumar';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Sunil Kumar', NULL::date, NULL::date),
    ('Provost Kumar', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'sunil kumar';

-- Ray Jayawardhana
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Ray Jayawardhana', 'ray jayawardhana', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Provost (2023 – 2026)', 'https://provost.jhu.edu/about/history/former-provosts/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'ray jayawardhana';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Ray Jayawardhana', NULL::date, NULL::date),
    ('Provost Jayawardhana', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'ray jayawardhana';

-- Lainie Rutkow
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Lainie Rutkow', 'lainie rutkow', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice Provost for Interdisciplinary Initiatives, later Executive Vice Provost and Interim Provost (from February 2026)', 'https://provost.jhu.edu/about/history/former-provosts/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'lainie rutkow';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Lainie Rutkow', NULL::date, NULL::date),
    ('Provost Rutkow', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'lainie rutkow';

-- Kevin Shollenberger
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Kevin Shollenberger', 'kevin shollenberger', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice Provost for Student Affairs (2013 – 2019), then Vice Provost for Student Health and Well-Being', 'https://wellbeing.jhu.edu/ViceProvost/staff/kevin-shollenberger/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'kevin shollenberger';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Kevin Shollenberger', NULL::date, NULL::date),
    ('Kevin G. Shollenberger', NULL::date, NULL::date),
    ('Shollenberger', NULL::date, NULL::date),
    ('Schollenberger', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'kevin shollenberger';

-- Alanna Shanahan
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Alanna Shanahan', 'alanna shanahan', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Director of Athletics and Recreation (2016 – 2019), then Vice Provost for Student Affairs (August 2019 – 2021)', 'https://hub.jhu.edu/2019/08/06/student-affairs-leadership-restructuring/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'alanna shanahan';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Alanna Shanahan', NULL::date, NULL::date),
    ('Alanna W. Shanahan', NULL::date, NULL::date),
    ('Vice Provost Shanahan', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'alanna shanahan';

-- Rachelle Hernandez
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Rachelle Hernandez', 'rachelle hernandez', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice Provost for Student Affairs (from March 2022)', 'https://hub.jhu.edu/2021/12/20/rachelle-hernandez-vice-provost-student-affairs/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'rachelle hernandez';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Rachelle Hernandez', NULL::date, NULL::date),
    ('Vice Provost Hernandez', NULL::date, NULL::date),
    ('Dr. Hernandez', '2022-03-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'rachelle hernandez';

-- Janet Schreck
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Janet Schreck', 'janet schreck', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Provost''s office education and accreditation lead; now Vice Provost for Academic Affairs and Innovation', 'https://provost.jhu.edu/office-of-the-provost/people/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'janet schreck';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Janet Schreck', NULL::date, NULL::date),
    ('Janet Shreck', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'janet schreck';

-- Lee Hawthorne
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Lee Hawthorne', 'lee hawthorne', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Vice Provost for Strategic Student Initiatives', 'https://provost.jhu.edu/office-of-the-provost/people/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'lee hawthorne';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Lee Hawthorne', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'lee hawthorne';

-- Tiffany Mfume
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Tiffany Mfume', 'tiffany mfume', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Vice Provost for Student Success and Retention Initiatives (from July 2023)', 'https://provost.jhu.edu/members/tiffany-mfume/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'tiffany mfume';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Tiffany Mfume', NULL::date, NULL::date),
    ('Dr. Mfume', '2023-07-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'tiffany mfume';

-- Brittini Brown
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Brittini Brown', 'brittini brown', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Vice Provost for Student Engagement and Dean of Students (from July 2023)', 'https://provost.jhu.edu/members/brittini-brown/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'brittini brown';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Brittini Brown', NULL::date, NULL::date),
    ('Dr. Brown', '2023-07-01'::date, NULL::date),
    ('Dean Brown', '2023-07-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'brittini brown';

-- Sarah K. Cunningham
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Sarah K. Cunningham', 'sarah k cunningham', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Assistant Vice Provost for Student Life Strategy and Policy (July 2018 – February 2021)', 'https://www.slu.edu/news/2020/december/vice-president-student-development.php', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'sarah k cunningham';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Sarah K. Cunningham', '2018-07-01'::date, '2021-02-28'::date),
    ('Sarah Cunningham', '2018-07-01'::date, '2021-02-28'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'sarah k cunningham';

-- Erin Yun
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Erin Yun', 'erin yun', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Deputy to the Vice Provost for Student Affairs (2011 – 2019)', 'https://www.jhunewsletter.com/2017/10/05/sga-invites-input-on-smoking-ban-resolution/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'erin yun';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Erin Yun', '2011-08-01'::date, '2019-11-30'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'erin yun';

-- Terry Martinez
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Terry Martinez', 'terry martinez', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Vice Provost and Dean of Student Life (July 2014 – July 2017)', 'https://hub.jhu.edu/2017/05/15/terry-martinez-hamilton-college/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'terry martinez';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Terry Martinez', NULL::date, NULL::date),
    ('Dean Martinez', '2014-07-01'::date, '2017-07-14'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'terry martinez';

-- Tiffany Sanchez
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Tiffany Sanchez', 'tiffany sanchez', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Dean of Student Engagement, then Interim Dean of Student Life (summer 2017 – February 2018)', 'https://www.jhunewsletter.com/article/2018/09/new-dean-of-student-life-smita-ruzicka-will-focus-on-inclusion-mental-health', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'tiffany sanchez';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Tiffany Sanchez', NULL::date, NULL::date),
    ('Dean Sanchez', '2013-07-01'::date, '2018-02-28'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'tiffany sanchez';

-- Smita Ruzicka
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Smita Ruzicka', 'smita ruzicka', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Dean of Student Life (August 2018 – July 2021)', 'https://hub.jhu.edu/2021/06/10/smita-ruzicka-named-vp-for-student-affairs-middlebury/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'smita ruzicka';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Smita Ruzicka', NULL::date, NULL::date),
    ('Dean Ruzicka', NULL::date, NULL::date),
    ('Dean Ruzika', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'smita ruzicka';

-- Allison Avolio
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Allison Avolio', 'allison avolio', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Director of Residential Life (2014 – 2019), Deputy to the Dean of Student Life, then Interim Dean of Student Life (July 2021 – April 2023)', 'https://www.jhunewsletter.com/article/2021/06/smita-ruzicka-reflects-on-her-tenure-as-dean-of-student-life', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'allison avolio';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Allison Avolio', NULL::date, NULL::date),
    ('Alison Avolio', NULL::date, NULL::date),
    ('Dean Avolio', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'allison avolio';

-- Andrew Wilson
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Andrew Wilson', 'andrew wilson', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Dean of Student Development, later Dean of Academic and Student Services (until 2022)', 'https://hub.jhu.edu/2022/02/08/andrew-wilson-named-vp-for-student-success-loyola/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'andrew wilson';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Andrew Wilson', NULL::date, '2022-03-31'::date),
    ('Andy Wilson', NULL::date, '2022-03-31'::date),
    ('Dean Wilson', '2015-07-01'::date, '2022-03-31'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'andrew wilson';

-- Toni Blackwell
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Toni Blackwell', 'toni blackwell', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Senior Associate Dean of Students (June 2016 – July 2021)', 'https://linkedin.com/in/toni-blackwell-59475b47', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'toni blackwell';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Toni Blackwell', NULL::date, NULL::date),
    ('Tony Blackwell', '2016-06-01'::date, '2021-07-31'::date),
    ('Dean Blackwell', '2016-06-01'::date, '2021-07-31'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'toni blackwell';

-- Moses Davis
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Moses Davis', 'moses davis', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Dean for Diversity and Inclusion (July 2017 – March 2021)', 'https://hub.jhu.edu/2019/10/30/vice-provost-for-institutional-equity-search/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'moses davis';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Moses Davis', NULL::date, NULL::date),
    ('Dean Davis', '2017-07-01'::date, '2021-03-31'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'moses davis';

-- Dana Broadnax
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Dana Broadnax', 'dana broadnax', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Director of Student Conduct and Academic Ethics (September 2017 – May 2020)', 'https://ii.library.jhu.edu/2019/05/02/lunch-and-learn-strategies-to-minimize-cheating-a-faculty-brainstorming-session/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'dana broadnax';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Dana Broadnax', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'dana broadnax';

-- Calvin L. Smith Jr.
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Calvin L. Smith Jr.', 'calvin l smith jr', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Director of Fraternity and Sorority Life, Director of Student Leadership and Involvement, then Senior Director of LEED (2015 – 2024)', 'https://studentaffairs.jhu.edu/parents-families/wp-content/uploads/sites/18/2021/07/Coffee-and-Conversations-Panel-II.pdf', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'calvin l smith jr';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Calvin L. Smith', NULL::date, NULL::date),
    ('Calvin Smith', '2015-07-01'::date, '2024-03-31'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'calvin l smith jr';

-- Matthew Torres
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Matthew Torres', 'matthew torres', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Executive Director of the Homewood Counseling Center', 'https://hub.jhu.edu/at-work/2019/07/29/milestones-august-2019/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'matthew torres';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Matthew Torres', NULL::date, '2022-06-30'::date),
    ('Matt Torres', NULL::date, '2022-06-30'::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'matthew torres';

-- Brent Mosser
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Brent Mosser', 'brent mosser', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Director of Student Disability Services (2010 – March 2018)', 'https://www.jhunewsletter.com/article/2018/09/hopkins-hires-director-of-student-disability-services', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'brent mosser';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Brent Mosser', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'brent mosser';

-- Roanna Kessler
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Roanna Kessler', 'roanna kessler', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Homewood Medical Director (from December 2016), then Chief Medical Director for Student Health and Well-Being (from June 2021)', 'https://wellbeing.jhu.edu/PrimaryCare/staff/roanna-kessler-md/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'roanna kessler';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Roanna Kessler', NULL::date, NULL::date),
    ('Dr. Kessler', '2016-12-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'roanna kessler';

-- Jennifer Howes
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Jennifer Howes', 'jennifer howes', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Chief Mental Health Director, Division of Student Well-Being (from June 2022)', 'https://wellbeing.jhu.edu/MentalHealthServices/staff/jennifer-howes/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'jennifer howes';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Jennifer Howes', NULL::date, NULL::date),
    ('Dr. Howes', '2022-06-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'jennifer howes';

-- Christina Presberry
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Christina Presberry', 'christina presberry', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Executive Director of Campus Safety and Security, Homewood (from 2017)', 'https://hub.jhu.edu/2017/11/09/campus-safety-security-christina-presberry/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'christina presberry';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Christina Presberry', NULL::date, NULL::date),
    ('Presberry', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'christina presberry';

-- Branville G. Bard Jr.
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Branville G. Bard Jr.', 'branville g bard jr', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice President for Public Safety (from August 2021) and Chief of the Johns Hopkins Police Department (from April 2023)', 'https://publicsafety.jhu.edu/about/our-leadership/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'branville g bard jr';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Branville Bard', NULL::date, NULL::date),
    ('Branville G. Bard', NULL::date, NULL::date),
    ('Brandville Bard', NULL::date, NULL::date),
    ('Dr. Bard', '2021-08-30'::date, NULL::date),
    ('Chief Bard', '2021-08-30'::date, NULL::date),
    ('VP Bard', '2021-08-30'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'branville g bard jr';

-- Beverly Wendland
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Beverly Wendland', 'beverly wendland', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'James B. Knapp Dean of the Krieger School of Arts and Sciences (2014 – June 2020)', 'https://hub.jhu.edu/2020/01/14/wendland-washington-university-provost-999-em0-art1-admin-news/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'beverly wendland';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Beverly Wendland', NULL::date, NULL::date),
    ('Dean Wendland', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'beverly wendland';

-- Christopher S. Celenza
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Christopher S. Celenza', 'christopher s celenza', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'James B. Knapp Dean of the Krieger School of Arts and Sciences (from January 2021)', 'https://krieger.jhu.edu/directory/christopher-s-celenza/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'christopher s celenza';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Christopher S. Celenza', NULL::date, NULL::date),
    ('Christopher Celenza', NULL::date, NULL::date),
    ('Chris Celenza', NULL::date, NULL::date),
    ('Dean Celenza', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'christopher s celenza';

-- Joel Schildbach
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Joel Schildbach', 'joel schildbach', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice Dean for Undergraduate Education, Krieger School (July 2015 – June 2021)', 'https://hub.jhu.edu/2018/10/29/undergraduate-academic-advising-study-eaa/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'joel schildbach';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Joel Schildbach', NULL::date, NULL::date),
    ('Schildbach', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'joel schildbach';

-- Erin Rowe
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Erin Rowe', 'erin rowe', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice Dean for Undergraduate Education, Krieger School', 'https://krieger.jhu.edu/directory/erin-rowe/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'erin rowe';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Erin Rowe', NULL::date, NULL::date),
    ('Dean Rowe', '2021-07-01'::date, NULL::date),
    ('Vice Dean Roe', '2021-07-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'erin rowe';

-- Aliza Watters
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Aliza Watters', 'aliza watters', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Dean of Undergraduate Curriculum, Krieger School, who oversees the Foundational Abilities curriculum', 'https://krieger.jhu.edu/directory/aliza-watters/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'aliza watters';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Aliza Watters', NULL::date, NULL::date),
    ('Dean Watters', '2020-07-01'::date, NULL::date),
    ('Dr. Watters', '2020-07-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'aliza watters';

-- Jessie Martin
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Jessie Martin', 'jessie martin', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Associate Dean of Academic Advising and Support, Krieger School', 'https://krieger.jhu.edu/directory/jessie-martin/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'jessie martin';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Jessie Martin', NULL::date, NULL::date),
    ('Dean Martin', '2019-01-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'jessie martin';

-- Jim Fry
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Jim Fry', 'jim fry', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Assistant Dean for Academic Advising, Krieger School (from 2008)', 'https://pages.jh.edu/gazette/2008/21jul08/21appoint.html', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'jim fry';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Jim Fry', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'jim fry';

-- Ed Schlesinger
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Ed Schlesinger', 'ed schlesinger', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Benjamin T. Rome Dean of the Whiting School of Engineering', 'https://engineering.jhu.edu/faculty/ed-schlesinger/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'ed schlesinger';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Ed Schlesinger', NULL::date, NULL::date),
    ('Dean Schlesinger', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'ed schlesinger';

-- Michael Falk
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Michael Falk', 'michael falk', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Vice Dean for Undergraduate Education, Whiting School of Engineering (from July 2017)', 'https://engineering.jhu.edu/faculty/michael-falk/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'michael falk';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Michael Falk', NULL::date, NULL::date),
    ('Dean Falk', NULL::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'michael falk';

-- Elisabeth Long
INSERT INTO "HopkinsAffiliate" ("id", "name", "nameKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Elisabeth Long', 'elisabeth long', CURRENT_TIMESTAMP) ON CONFLICT ("nameKey") DO NOTHING;
INSERT INTO "ReviewedAdministrator" ("id", "hopkinsAffiliateId", "title", "source", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Sheridan Dean of University Libraries (from January 2023)', 'https://www.library.jhu.edu/about/dean/', CURRENT_TIMESTAMP FROM "HopkinsAffiliate" WHERE "nameKey" = 'elisabeth long';
INSERT INTO "ReviewedAdministratorForm" ("id", "administratorId", "text", "validFrom", "validTo")
SELECT gen_random_uuid()::text, r."id", v."text", v."validFrom", v."validTo"
FROM "ReviewedAdministrator" r JOIN "HopkinsAffiliate" a ON a."id" = r."hopkinsAffiliateId",
(VALUES ('Elisabeth Long', NULL::date, NULL::date),
    ('Elisabeth M. Long', NULL::date, NULL::date),
    ('Elizabeth Long', '2023-01-01'::date, NULL::date),
    ('Dean Long', '2023-01-01'::date, NULL::date)) AS v("text", "validFrom", "validTo")
WHERE a."nameKey" = 'elisabeth long';

-- Credits already written from the roster are derived from it from now on, so
-- removing a form from the table removes its credits on the next reprocess.
UPDATE "DocumentContributor" SET "source" = 'reviewed'
WHERE "source" = 'manual' AND "role" = 'mentioned'
  AND "note" LIKE 'Reviewed identity: %Named in the text; this does not establish attendance or a speaking turn.';
