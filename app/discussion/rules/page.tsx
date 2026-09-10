import Link from "next/link";

import { ALLOWED_EMAIL_DOMAINS, SESSION_DAYS } from "@/config/forum";

/**
 * How the forum works, written out in full.
 *
 * On its own page and linked from everywhere that asks somebody to post,
 * because the rules a forum runs by are most of whether it is worth posting
 * on, and a claim of anonymity that cannot be checked is worth nothing. What
 * follows describes what the code actually does; where it gives something up,
 * it says so.
 */
export default function Rules() {
    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1>How the discussion works</h1>

            <p>
                Raise issues anonymously. Freedom of (publicly moderated) spech.
            </p>

            <section className="my-6">
                <h2>Anonymous</h2>
                <p>
                    Only if a person holds office will their name be displayed. 
                    Otherwise, nothing server-side is known about the poster.
                </p>
            </section>

            <section className="my-6">
                <h2>Hopkins Affiliates Only</h2>
                <p>
                    Posting requires a valid address (
                    {ALLOWED_EMAIL_DOMAINS.join(", ")}), which is sent a
                    one-time code. The address is checked against a one-way hash
                    and then dropped; what is stored is a session saying
                    somebody at Hopkins signed in, with no record of which
                    address did. Sessions last {SESSION_DAYS} days and can be
                    ended at any time from the{" "}
                    <Link className="text-primary-700" href="/auth">
                        sign-in page
                    </Link>
                    .
                </p>
            </section>

            <section className="my-6">
                <h2>Screening</h2>
                <p>
                    Submissions are screened
                    for malice (harassment, doxxing, etc.) and automated flooding. Anger,
                    rudeness, and contempt for the SGA are not on that list and
                    are not screened for.
                </p>
                <p>
                    A flagged post is held back rather than published, so spam
                    does not land in front of everyone before anyone has looked
                    at it. The hold is announced the moment it happens: the{" "}
                    <Link className="text-primary-700" href="/discussion/moderation">
                        moderation log
                    </Link>{" "}
                    names what is being held, on what grounds, and how long it
                    has been waiting, and the text itself is readable there. A
                    moderator then either publishes it or upholds the hold under
                    their own name.
                </p>
                <p className="text-foreground-400">
                    If the screening cannot run at all, submissions go up
                    unscreened. Screening that breaks must not become screening
                    that blocks everything.
                </p>
            </section>

            <section className="my-6">
                <h2>Posts are permanent</h2>
                <p>
                    They may only be delisted by a moderator,
                        relocating it to logs. 
                </p>
            </section>

            <section className="my-6">
                <h2>Moderation happens in public</h2>
                <p>
                    Every moderation action is logged and visible: what was
                    hidden, when, by whom, and on what grounds.
                </p>
                <p>
                    Moderators act under their own names; the{" "}
                    <Link className="text-primary-700" href="/discussion/moderation">
                        log
                    </Link>{" "}
                    is public.
                </p>
            </section>

            <p>
                <Link className="text-primary-700" href="/discussion">
                    Back to the discussion
                </Link>
            </p>
        </div>
    );
}
