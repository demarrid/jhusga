export const metadata = { title: "Privacy and metrics" };

export default function Privacy() {
    return <article className="max-w-3xl mx-auto p-8 space-y-6">
        <h1 className="text-3xl font-semibold">Privacy and metrics</h1>
        <p>We use minimal first-party metrics to understand hosting costs and reliability: request counts for broad site sections, database operation counts, failures, and total processing time.</p>
        <p>These metrics do not contain IP addresses, visitor IDs, account information, document or discussion IDs, search terms, query strings, referrers, raw browser headers, or database query contents. They do not count unique people or build browsing profiles.</p>
        <p>There are no analytics cookies, fingerprinting, session replay, advertising integrations, or third-party analytics scripts. Requests carrying Do Not Track or Global Privacy Control are omitted from audience counts automatically. No settings or extra interaction are required.</p>
        <p>Automation labels reflect what software declares, not verified identity. All other traffic remains unknown. Database totals are separate system-health counters with no visitor or request identifiers; they remain active regardless of browser privacy signals.</p>
        <p>Hosting providers may separately retain request and security logs. These protections apply to our added metrics, not those provider logs. Existing sign-in and abuse prevention remain separate from audience measurement.</p>
    </article>;
}
