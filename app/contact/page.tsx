import Link from "next/link";

import { getContactDirectory } from "@/api/contact";
import SourceChip from "@/app/(components)/SourceChip";
import { getSessionString } from "@/app/utils";
import {
    membersByGroup,
    type DirectoryCitation,
    type GroupInbox,
} from "@/lib/directory";

export const dynamic = "force-dynamic";

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
                            <Link href={`/documents/${source.id}`}>{source.title}</Link>
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
                                                <Link href={`/documents?person=${member.id}`}>
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
                                                        <SourceChip
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
                                                        <SourceChip
                                                            citation={chipFrom(member.emailSource)}
                                                        />
                                                    )}
                                                </>
                                            )}
                                            {member.committees && member.committees.length > 0 && (
                                                <div className="text-foreground-400 text-sm">
                                                    {`Committees: ${member.committees.join(", ")}`}
                                                    {member.committeeSource && (
                                                        <SourceChip
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
            <a href={`mailto:${inbox.email}`}>{inbox.email}</a>
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

// office hours
// rso funding
