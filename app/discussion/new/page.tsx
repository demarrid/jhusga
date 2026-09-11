import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/api/auth";
import NewPostForm from "@/app/(components)/NewPostForm";

import DiscussionHeader from "../DiscussionHeader";
import styles from "../discussion.module.css";

export const dynamic = "force-dynamic";

export default async function NewPost() {
    const viewer = await getViewer();

    // The only redirect to sign-in anywhere on the site. Reading needs nothing;
    // this page is a form and there is nothing to show without a session.
    if (!viewer) redirect("/auth?next=/discussion/new");

    return (
        <main className={styles.page}>
          <DiscussionHeader eyebrow="Discussion" title="Start a thread" compact />
          <div className={styles.content}>
            <p className={styles.proseIntro}>
                {viewer.affiliateId
                    ? "Anonymous unless you tick the box below. Nothing is stored linking this to you unless you do."
                    : "This will be anonymous. Your session records that somebody at Hopkins is signed in, not who, and the post carries no author at all."}{" "}
                <Link className={styles.inlineLink} href="/discussion/rules">
                    The rules
                </Link>{" "}
                set out what that means in full.
            </p>

            <NewPostForm officeLabel={viewer.affiliateId ? viewer.officeLabel : null} />
          </div>
        </main>
    );
}
