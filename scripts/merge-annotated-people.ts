/**
 * Fold "Veda Kommineni (LATE)", "KIRR ANGEL (?)" and "Noh (No) Mebrahtu" onto
 * the person written without the note.
 *
 * node --env-file=.env --import tsx scripts/merge-annotated-people.ts [--apply]
 *
 * A row whose bare name is already somebody is merged onto them. A row whose
 * note is a status or pronunciation tag and has no bare twin is renamed. A
 * nickname with no bare twin ("Caitlin (Kate) Dwyer") is left alone, as is
 * anything a transcriber marked [unclear] or [illegible].
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { nameKey } from "../lib/contributors";
import {
    applyManualNameAliases,
    mergeAffiliate,
    resetNameResolverCache,
    withoutNameAnnotations,
} from "../lib/names";

function bareName(name: string): string {
    return name
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/(?<=[A-Za-z])\?+$/, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function main() {
    const apply = process.argv.includes("--apply");
    const people = await prisma.hopkinsAffiliate.findMany({
        where: { OR: [{ name: { contains: "(" } }, { name: { endsWith: "?" } }] },
        select: { id: true, name: true, email: true, userId: true, _count: { select: { contributions: true } } },
    });

    type Step = { id: string; name: string; action: "merge" | "rename"; into: string; intoId?: string };
    const steps: Step[] = [];
    const skipped: string[] = [];

    for (const person of people) {
        if (/\[/.test(person.name)) continue;
        const bare = bareName(person.name);
        if (bare.split(" ").length < 2) {
            skipped.push(`${person.name} (too little left)`);
            continue;
        }
        const target =
            (await prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey(bare) }, select: { id: true, name: true } })) ??
            (await prisma.hopkinsAlias.findUnique({
                where: { aliasKey: nameKey(bare) },
                select: { hopkinsAffiliate: { select: { id: true, name: true } } },
            }))?.hopkinsAffiliate ??
            null;

        if (target && target.id !== person.id) {
            if (person.email || person.userId) {
                // The annotated row is the verified one: fold the bare row
                // into it, then give it the bare name.
                const twin = await prisma.hopkinsAffiliate.findUniqueOrThrow({ where: { id: target.id }, select: { email: true, userId: true } });
                if (twin.email || twin.userId) {
                    skipped.push(`${person.name} (two verified identities)`);
                    continue;
                }
                steps.push({ id: target.id, name: target.name, action: "merge", into: person.name, intoId: person.id });
                steps.push({ id: person.id, name: person.name, action: "rename", into: bare });
                continue;
            }
            steps.push({ id: person.id, name: person.name, action: "merge", into: target.name, intoId: target.id });
        } else if (withoutNameAnnotations(person.name) !== person.name) {
            steps.push({ id: person.id, name: person.name, action: "rename", into: withoutNameAnnotations(person.name) });
        } else {
            skipped.push(`${person.name} (nickname, no bare twin)`);
        }
    }

    for (const step of steps) console.log(`${step.action.padEnd(6)} ${step.name}  ->  ${step.into}`);
    console.log(`\nleft alone:\n  ${skipped.join("\n  ")}`);
    console.log(`\n${steps.length} changes${apply ? "" : " (dry run; pass --apply)"}`);
    if (!apply) return;

    await mkdir(".archive-local", { recursive: true });
    const backup = await prisma.hopkinsAffiliate.findMany({
        where: { id: { in: steps.flatMap((step) => [step.id, step.intoId ?? step.id]) } },
        include: { contributions: true, aliases: true, hopkinsRelationships: true },
    });
    const file = `.archive-local/annotated-people-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, JSON.stringify({ steps, backup }, null, 2));
    console.log(`backup: ${file}`);

    for (const step of steps) {
        if (step.action === "merge") {
            await mergeAffiliate(step.id, step.intoId!);
        } else {
            await prisma.$transaction([
                prisma.hopkinsAffiliate.update({ where: { id: step.id }, data: { name: step.into, nameKey: nameKey(step.into) } }),
                prisma.hopkinsAlias.upsert({
                    where: { aliasKey: nameKey(step.name) },
                    create: { alias: step.name, aliasKey: nameKey(step.name), hopkinsAffiliateId: step.id, source: "manual" },
                    update: { hopkinsAffiliateId: step.id, source: "manual" },
                }),
            ]);
        }
    }
    console.log(`confirmed aliases applied: ${await applyManualNameAliases()}`);
    resetNameResolverCache();
    console.log("done");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
