import Link from "next/link";

import { getContactDirectory } from "@/api/contact";
import SourceChip from "@/app/(components)/SourceChip";
import { getSessionString } from "@/app/utils";
import { OFFICE_HOURS, OFFICE_HOURS_CHECKED } from "@/config/office-hours";
import { formatDateShort } from "@/lib/dates";
import {
    membersByGroup,
    type DirectoryCitation,
    type GroupInbox,
} from "@/lib/directory";

export const dynamic = "force-dynamic";

/**
 * Student Leadership and Involvement's walkthrough for both halves of a
 * funding request. Hosted on CampusGroups rather than mirrored here, so that
 * a reader always gets the version SLI is currently working from.
 */
const FUNDING_GUIDE_URL =
    "https://jhu.campusgroups.com/get_file?eid=c53d17eb5f9e16b199c8d0db55a27983";

const SLI_FINANCE_EMAIL = "SLIFinance@jhu.edu";


function chipFrom(citation: DirectoryCitation) {
    return {
        documentTitle: citation.documentTitle,
        quote: citation.quote,
        href: `/documents/${citation.documentId}`,
        orphaned: false,
    };
}

export default async function Contact() {
    const directory = await getContactDirectory();
    const sections = membersByGroup(directory.members);
    const session = getSessionString();

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1>Contact</h1>

            <FinanceYourClub />

            <p>
                Members of the {session} Student Government Association, with
                emails where the published {session} list has them. Each office
                and address is chipped to the current-session document it was
                read from.
            </p>

            {directory.sources.length > 0 && (
                <p className="text-foreground-400">
                    Read from{" "}
                    {directory.sources.map((source, index) => (
                        <span key={source.id}>
                            {index > 0 &&
                                (index === directory.sources.length - 1 ? " and " : ", ")}
                            <Link className="text-primary-700" href={`/documents/${source.id}`}>{source.title}</Link>
                        </span>
                    ))}
                    .
                </p>
            )}

            {directory.inboxes.length > 0 && (
                <section className="my-6">
                    <h2>Write to SGA</h2>
                    <p>
                        Shared inboxes the current session&apos;s documents tell
                        people to email.
                    </p>
                    <ul>
                        {directory.inboxes.map((inbox) => (
                            <InboxRow key={inbox.email} inbox={inbox} />
                        ))}
                    </ul>
                </section>
            )}

            <OfficeHours />

            {sections.length === 0 ? (
                <p className="text-foreground-400 italic">
                    No {session} contact list is on file yet. Run{" "}
                    <code>npm run sync</code> if the archive has one.
                </p>
            ) : (
                sections.map((section) => (
                    <section key={section.group} className="my-6">
                        <h2>{section.label}</h2>
                        {section.subgroups.map((subgroup) => (
                            <div key={subgroup.key ?? section.group}>
                                {subgroup.label && <h3>{subgroup.label}</h3>}
                                <ul>
                                    {subgroup.members.map((member) => (
                                        <li key={member.name} className="my-1">
                                            {member.id ? (
                                                <Link href={`/documents?person=${member.id}`} className="text-secondary-700">
                                                    {member.name}
                                                </Link>
                                            ) : (
                                                member.name
                                            )}
                                            {member.positions.map((position, index) => (
                                                <span key={`${member.name}-${position}`}>
                                                    {index === 0 ? " — " : ", "}
                                                    {position}
                                                    {member.positionSources?.[index] && (
                                                        <SourceChip mini={true} 
                                                            citation={chipFrom(
                                                                member.positionSources[index]!,
                                                            )}
                                                        />
                                                    )}
                                                </span>
                                            ))}
                                            {member.email && (
                                                <>
                                                    {member.positions.length > 0 ? " · " : " — "}
                                                    <a href={`mailto:${member.email}`}>
                                                        {member.email}
                                                    </a>
                                                    {member.emailSource && (
                                                        <SourceChip mini={true}
                                                            citation={chipFrom(member.emailSource)}
                                                        />
                                                    )}
                                                </>
                                            )}  
                                            {member.committees && member.committees.length > 0 && (
                                                <div className="text-foreground-400 text-sm">
                                                    {`Committees: ${member.committees.join(", ")}`}
                                                    {member.committeeSource && (
                                                        <SourceChip mini={true}
                                                            citation={chipFrom(
                                                                member.committeeSource,
                                                            )}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </section>
                ))
            )}
        </div>
    );
}

function InboxRow({ inbox }: { inbox: GroupInbox }) {
    return (
        <li>
            <strong>{inbox.label}</strong>
            {" — "}
            <a className="text-primary-700" href={`mailto:${inbox.email}`}>{inbox.email}</a>
            <SourceChip
                citation={{
                    documentTitle: inbox.documentTitle,
                    quote: inbox.evidence,
                    href: `/documents/${inbox.documentId}`,
                    orphaned: false,
                }}
            />
        </li>
    );
}

/**
 * How a Registered Student Organization gets money, first on the page.
 *
 * This is what most people arrive at the contact page looking for, and the
 * home page links straight to it, so it sits above the directory rather than
 * below it. The procedure belongs to Student Leadership and Involvement, not
 * to the SGA, so this points at their guide instead of restating it: a
 * paraphrase here would go stale the first time SLI changed a form.
 *
 * `scroll-mt-24` keeps the heading clear of the sticky header when the reader
 * arrives on the #funding anchor.
 */
function FinanceYourClub() {
    return (
        <section id="funding" className="bg-primary-100 rounded-md p-4 my-6 scroll-mt-24">
            <h2>Finance your club</h2>

            <p>
                Registered Student Organizations request money from the Student
                Activities Commission through Hopkins Groups. It takes two
                submissions: a funding request, which is what the SGA votes to
                approve, and then a purchase request, which is what actually
                releases the money.
            </p>

            <p className="my-3">
                <a
                    className="text-primary-700"
                    href={FUNDING_GUIDE_URL}
                    target="_blank"
                    rel="noreferrer"
                >
                    How to submit a funding or purchase request in Hopkins Groups
                </a>{" "}
                <span className="text-foreground-400">
                    — the walkthrough, from Homewood Student Affairs
                </span>
            </p>

            <ul>
                <li>
                    Start from your organisation&apos;s page in{" "}
                    <a className="text-primary-700" href="https://jhu.campusgroups.com/">
                        Hopkins Groups
                    </a>{" "}
                    and create a budget request. Every item for one event goes on
                    the same request.
                </li>
                <li>
                    A submitted request reads &ldquo;Pending Approval&rdquo; until
                    the SGA has voted on it. Once it is approved, the request
                    payment button becomes active.
                </li>
                <li>
                    The purchase request is a separate form, and SLI cannot pay
                    anything out until it has been completed and signed.
                </li>
                <li>
                    Questions about a request go to{" "}
                    <a className="text-primary-700" href={`mailto:${SLI_FINANCE_EMAIL}`}>
                        {SLI_FINANCE_EMAIL}
                    </a>
                    .
                </li>
            </ul>
        </section>
    );
}

/**
 * When members can be found in person.
 *
 * Kept in config/office-hours.ts and maintained by hand, which the note says
 * outright: everything else on this page carries a chip to the document it was
 * read from, and this cannot, so it should not look as though it could.
 */
function OfficeHours() {
    if (OFFICE_HOURS.length === 0) return null;

    const checked = OFFICE_HOURS_CHECKED ? new Date(OFFICE_HOURS_CHECKED) : null;

    return (
        <section className="my-6">
            <h2>Office hours</h2>

            <p className="text-foreground-400">
                Kept by hand rather than read from the archive, so it can be
                wrong in a way the rest of this page cannot.
                {checked && ` Last checked ${formatDateShort(checked)}.`}
            </p>

            <ul>
                {OFFICE_HOURS.map((hour) => (
                    <li key={`${hour.name}-${hour.when}`} className="my-1">
                        <strong>{hour.name}</strong>
                        {hour.position && ` — ${hour.position}`}
                        {` · ${hour.when} · ${hour.where}`}
                        {hour.href && (
                            <>
                                {" · "}
                                <a className="text-primary-700" href={hour.href}>
                                    Book a slot
                                </a>
                            </>
                        )}
                        {hour.note && (
                            <div className="text-foreground-400 text-sm">{hour.note}</div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
