import DiscussionHeader from "@/app/discussion/DiscussionHeader";
import styles from "@/app/discussion/discussion.module.css";

export const metadata = { title: "Privacy and metrics" };

export default function Privacy() {
    return <div className={styles.page}>
        <DiscussionHeader eyebrow="Site information" title="Privacy and metrics" compact>
            <p>Understand how the site measures usage while collecting as little as possible.</p>
        </DiscussionHeader>
        <div className={styles.content}><div className={styles.rulesList}>
        <section className={styles.rule}>
            <h2>What we measure</h2>
        <p>We use minimal first-party metrics to understand hosting costs and reliability: request counts for broad site sections, database operation counts, failures, and total processing time.</p>
        </section>
        <section className={styles.rule}>
            <h2>What we leave out</h2>
        <p>These metrics do not contain IP addresses, visitor IDs, account information, document or discussion IDs, search terms, query strings, referrers, raw browser headers, or database query contents. They do not count unique people or build browsing profiles.</p>
        </section>
        <section className={styles.rule}>
            <h2>Privacy by default</h2>
        <p>There are no analytics cookies, fingerprinting, session replay, advertising integrations, or third-party analytics scripts. Requests carrying Do Not Track or Global Privacy Control are omitted from audience counts automatically. No settings or extra interaction are required.</p>
        </section>
        <section className={styles.rule}>
            <h2>What the counts mean</h2>
        <p>Automation labels reflect what software declares, not verified identity. All other traffic remains unknown. Database totals are separate system-health counters with no visitor or request identifiers; they remain active regardless of browser privacy signals.</p>
        </section>
        <section className={styles.rule}>
            <h2>Hosting and security</h2>
        <p>Hosting providers may separately retain request and security logs. These protections apply to our added metrics, not those provider logs. Existing sign-in and abuse prevention remain separate from audience measurement.</p>
        </section>
    </div></div>
    </div>;
}
