import Link from "next/link";

import { getSections, type Section } from "@/api/sections";
import GeneratedProse from "@/app/(components)/GeneratedProse";
import { getSessionString } from "@/app/utils";
import { SECTION_KEYS } from "@/lib/sections";

// Read from the database on request rather than at build, so the daily sync is
// reflected without a redeploy and a build never needs the database.
export const dynamic = "force-dynamic";

/**
 * One position, described from the constitution and bylaws.
 *
 * Every description carries the clause it was written from, so a position is
 * explained by the rules that create it rather than by whoever holds it.
 */
function Position({
    title,
    section,
    level = 3,
}: {
    title: string;
    section: Section | null;
    level?: 3 | 4;
}) {
    const Heading = level === 3 ? "h3" : "h4";
    return (
        <div className="my-4">
            <Heading>{title}</Heading>
            <GeneratedProse section={section} />
        </div>
    );
}

export default async function About() {
    const sections = await getSections(SECTION_KEYS);
    const session = getSessionString();
    const at = (key: string): Section | null => sections[key] ?? null;

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1>About</h1>

            <p>
                The Student Government Association (SGA) at Johns Hopkins
                University is an official representative body of the
                undergraduate student body. Through elections and appointments,
                SGA members are tasked with advocating for students with
                University administration.
            </p>

            <GeneratedProse section={at("about.overview")} />

            <h2>What Does the SGA... Do?</h2>

            <p>
                The purpose of the SGA is for motivated students to deliberate
                and cooperate with one another to pass legislation and persuade
                University administrators to support student interests.
            </p>

            <p>
                Outside of hosting public Senate, Committee, Executive, and
                Judicial meetings, as well as funding Registered Student
                Organizations (RSOs), consulting faculty, and recordkeeping,
                some examples of the most impactful work of the SGA is:
            </p>
            <ul>
                <li>Lowering Bloomberg Student Center (BSC) dining prices</li>
                <li>Adding a Boba shop to Levering Hall dining</li>
                <li>Making iClicker free for students (in classes which require it)</li>
            </ul>

            <h2>Structure</h2>

            <p>
                Mirroring the federal government of the United States, the
                majority of SGA positions are in the Executive, Legislative, and
                Judicial branches. Two further bodies sit outside them: the
                Committee on Student Elections, which runs the elections, and
                the Programming Councils, which run each class&apos;s events.
            </p>

            <p className="text-foreground-400">
                For who currently holds each of these positions, see the{" "}
                <Link href="/contact">{session} contact directory</Link>.
            </p>

            <h2>Executive Branch</h2>
            <GeneratedProse section={at("about.executive.overview")} />

            <Position title="Student Body President" section={at("about.executive.president")} />
            <Position
                title="Student Body Vice President"
                section={at("about.executive.vice_president")}
            />
            <Position title="Secretary" section={at("about.executive.secretary")} />
            <Position title="Treasurer" section={at("about.executive.treasurer")} />
            <Position
                title="Director of Communications"
                section={at("about.executive.communications")}
            />
            <Position
                title="Student Body Chair of Programming"
                section={at("about.executive.programming")}
            />

            <h2>Legislative Branch</h2>
            <GeneratedProse section={at("about.legislative.overview")} />

            <Position
                title="President of the Senate"
                section={at("about.legislative.president_of_senate")}
            />
            <Position
                title="Class Senators and Class Presidents"
                section={at("about.legislative.class_senators")}
            />
            <Position
                title="KSAS and WSE Senators"
                section={at("about.legislative.academic_senators")}
            />
            <Position
                title="Student Organization Senators"
                section={at("about.legislative.rso_senators")}
            />
            <Position
                title="Caucuses and Caucus Chairs"
                section={at("about.legislative.caucuses")}
            />

            <h3>Committees</h3>
            <GeneratedProse section={at("about.legislative.committees")} />
            <Position
                title="Committee chairs"
                section={at("about.legislative.committee_chairs")}
                level={4}
            />

            <h2>Judicial Branch</h2>
            <GeneratedProse section={at("about.judicial.overview")} />

            <Position title="Chief Justice" section={at("about.judicial.chief_justice")} />
            <Position title="Justices" section={at("about.judicial.justices")} />

            <h2>Committee on Student Elections</h2>
            <GeneratedProse section={at("about.cse.overview")} />

            <h2>Programming Councils</h2>
            <GeneratedProse section={at("about.programming.overview")} />

            <Position
                title="Council officers"
                section={at("about.programming.officers")}
            />
        </div>
    );
}
