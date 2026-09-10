import Link from "next/link";

import { getViewer } from "@/api/auth";
import SignIn from "@/app/(components)/SignIn";
import SignOutButton from "@/app/(components)/SignOutButton";

import styles from "./auth.module.css";

export const dynamic = "force-dynamic";

/**
 * The only page on the site that asks who you are, and the only thing it does
 * with the answer is let you write.
 *
 * Nothing else here is gated. The documents, the search, the directory and the
 * forum itself are readable without ever coming to this page, which is the
 * reason it can afford to keep so little.
 */
export default async function Auth({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    const viewer = await getViewer();
    const { next } = await searchParams;

    // Only same-site destinations, so this page cannot be used to bounce
    // somebody somewhere else with a Hopkins sign-in behind them.
    const destination = next?.startsWith("/") ? next : undefined;

    return (
        <main className={styles.page}>
          <header className={styles.masthead}>
            <p>Discussion access</p>
            <div>
              <h1>Sign in</h1>
              <p>Read everything without an account. Sign in only when you want to post or reply.</p>
            </div>
          </header>

          <section className={styles.content}>
            <div className={styles.sectionLabel}><span>01</span> Hopkins verification</div>
            <div className={styles.panel}>
            {viewer ? (
                <>
                    <p className={styles.lead}>
                        You are signed in
                        {viewer.affiliateName
                            ? ` as ${viewer.affiliateName}${viewer.officeLabel ? `, ${viewer.officeLabel}` : ""}`
                            : " anonymously"}
                        .{" "}
                        <Link className={styles.inlineLink} href={destination ?? "/discussion"}>
                            Go to the discussion
                        </Link>
                        .
                    </p>

                    {viewer.affiliateId ? (
                        <p className={styles.supporting}>
                            Because you hold office, each post asks whether you
                            want your name on it. It is off unless you turn it
                            on, and a post you make anonymously is as anonymous
                            as anyone else&rsquo;s.
                        </p>
                    ) : (
                        <p className={styles.supporting}>
                            Your session records that somebody at Hopkins signed
                            in. It does not record which address, and there is
                            no column anywhere joining it to what you post.
                        </p>
                    )}

                    {viewer.role === "moderator" && (
                        <p className={styles.supporting}>
                            You can moderate. Every action you take is published
                            under your name in the{" "}
                            <Link className={styles.inlineLink} href="/discussion/moderation">
                                moderation log
                            </Link>
                            .
                        </p>
                    )}

                    <SignOutButton />
                </>
            ) : (
                <>
                    <SignIn next={destination} />

                    <p className={styles.supporting}>
                        What happens to the address is set out in the{" "}
                        <Link className={styles.inlineLink} href="/discussion/rules">
                            forum rules
                        </Link>
                        , along with everything else the forum does and does not
                        keep.
                    </p>
                </>
            )}
            </div>
          </section>
        </main>
    );
}
