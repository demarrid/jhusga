/** Parse before loading credentials or touching the database. */
export function parseHistoryArgs(args: string[]) {
    const options = { force: false, dryRun: false, extractOnly: false, limit: undefined as number | undefined };
    const slugs: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]!;
        if (arg === "--force") options.force = true;
        else if (arg === "--dry-run") options.dryRun = true;
        else if (arg === "--extract-only") options.extractOnly = true;
        else if (arg === "--limit") {
            const value = args[++index];
            if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                throw new Error("--limit takes a non-negative whole number");
            }
            options.limit = Number(value);
        } else if (arg.startsWith("-")) throw new Error(`Unknown history option: ${arg}`);
        else slugs.push(arg);
    }
    return { options, slugs };
}
