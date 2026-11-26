/**
 * Fold people written two ways ("AJ Tsang" / "A.J Tsang", "Ronald Daniels" /
 * "Ronald J. Daniels") onto one row, without a full reprocess.
 *
 * node --env-file=.env --import tsx scripts/merge-duplicate-people.ts [--apply]
 *
 * Dry run by default. --apply first writes a backup of every affected row to
 * .archive-local/people-merge-<time>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { applyManualNameAliases, mergePeopleOneTypoApart } from "../lib/names";

async function main() {
    const apply = process.argv.includes("--apply");
    if (apply) console.log(`confirmed aliases applied: ${await applyManualNameAliases()}`);
    const plan = await mergePeopleOneTypoApart({ dryRun: true });
    for (const merge of plan) {
        console.log(`${merge.keptName} (${merge.documents}) <= ${merge.foldedNames.join(" | ")}`);
    }
    const folded = plan.reduce((count, merge) => count + merge.foldedNames.length, 0);
    console.log(`\n${plan.length} people, ${folded} rows to fold${apply ? "" : " (dry run; pass --apply)"}`);
    if (!apply || plan.length === 0) return;

    const affected = await prisma.hopkinsAffiliate.findMany({
        where: { id: { in: plan.map((merge) => merge.keptId) } },
        select: { id: true },
    });
    const names = plan.flatMap((merge) => merge.foldedNames);
    const backup = await prisma.hopkinsAffiliate.findMany({
        where: { OR: [{ id: { in: affected.map((row) => row.id) } }, { name: { in: names } }] },
        include: { contributions: true, aliases: true, hopkinsRelationships: true, reviewedAdministrator: { include: { forms: true } } },
    });
    await mkdir(".archive-local", { recursive: true });
    const file = `.archive-local/people-merge-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, JSON.stringify({ plan, backup }, null, 2));
    console.log(`backup: ${file}`);

    const merged = await mergePeopleOneTypoApart();
    const done = merged.reduce((count, merge) => count + merge.foldedNames.length, 0);
    console.log(`folded ${done} rows onto ${merged.length} people`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
