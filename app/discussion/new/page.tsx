import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/api/auth";
import NewPostForm from "@/app/(components)/NewPostForm";

export const dynamic = "force-dynamic";

export default async function NewPost() {
    const viewer = await getViewer();

    // The only redirect to sign-in anywhere on the site. Reading needs nothing;
    // this page is a form and there is nothing to show without a session.
    if (!viewer) redirect("/auth?next=/discussion/new");

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1>Start a thread</h1>

            <p className="text-foreground-400">
                {viewer.affiliateId
                    ? "Anonymous unless you tick the box below. Nothing is stored linking this to you unless you do."
                    : "This will be anonymous. Your session records that somebody at Hopkins is signed in, not who, and the post carries no author at all."}{" "}
                <Link className="text-primary-700" href="/discussion/rules">
                    The rules
                </Link>{" "}
                set out what that means in full.
            </p>

            <NewPostForm officeLabel={viewer.affiliateId ? viewer.officeLabel : null} />
        </div>
    );
}
