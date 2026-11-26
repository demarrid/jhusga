/**
 * Fold offices written several ways onto the one name `canonicalOffice` gives
 * them: "Disabled Students" and "Disability Senator" onto "Disabled Students
 * Caucus Senator", "KSAS 3" onto "KSAS Senator", and so on.
 *
 * node --env-file=.env --import tsx scripts/merge-duplicate-offices.ts [--apply]
 *
 * Cells that were never an office ("?", an email address from a shifted roster
 * column) lose their seats. So do seats held by a "person" whose name is itself
 * an office or constituency -- "Budget Specialist", "Student Athletes" -- the
 * same shifted columns read the other way round.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { canonicalOffice, canonicalOffices } from "../lib/offices";

async function main() {
    const apply = process.argv.includes("--apply");
    const categories = await prisma.hopkinsCategory.findMany({
        where: { type: "position" },
        select: {
            id: true,
            name: true,
            hopkinsRelationships: {
                select: { id: true, hopkinsAffiliateId: true, startedAt: true, endedAt: true, hopkinsAffiliate: { select: { name: true } } },
            },
        },
    });
    const officeNames = new Set(categories.map((category) => category.name.toLowerCase()));
    // A holder that is itself an office: named like one, or a spelling that
    // canonicalOffice rewrites ("Disabled Students"). A person's name passes
    // through canonicalOffice unchanged.
    const isOfficeName = (name: string) =>
        officeNames.has(name.toLowerCase()) || canonicalOffice(name) !== name;

    const moves: { from: string; to: string[]; seats: number }[] = [];
    const strayHolders: { office: string; holder: string; id: string }[] = [];
    for (const category of categories) {
        for (const seat of category.hopkinsRelationships) {
            if (isOfficeName(seat.hopkinsAffiliate.name)) {
                strayHolders.push({ office: category.name, holder: seat.hopkinsAffiliate.name, id: seat.id });
            }
        }
        const to = canonicalOffices(category.name);
        if (to.length === 1 && to[0] === category.name) continue;
        moves.push({ from: category.name, to, seats: category.hopkinsRelationships.length });
    }

    for (const move of moves) console.log(`${move.from} (${move.seats})  ->  ${move.to.length ? move.to.join(" + ") : "[not an office: seats removed]"}`);
    console.log("\nseats held by an office name rather than a person:");
    for (const stray of strayHolders) console.log(`  ${stray.holder} holds ${stray.office}`);
    console.log(`\n${moves.length} offices to fold, ${strayHolders.length} stray seats${apply ? "" : " (dry run; pass --apply)"}`);
    if (!apply) return;

    await mkdir(".archive-local", { recursive: true });
    const file = `.archive-local/offices-merge-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, JSON.stringify({ moves, strayHolders, categories }, null, 2));
    console.log(`backup: ${file}`);

    const strayIds = new Set(strayHolders.map((stray) => stray.id));
    await prisma.hopkinsRelationship.deleteMany({ where: { id: { in: [...strayIds] } } });

    for (const category of categories) {
        const to = canonicalOffices(category.name);
        if (to.length === 1 && to[0] === category.name) continue;
        await prisma.$transaction(async (tx) => {
            const targets = [];
            for (const name of to) {
                targets.push(await tx.hopkinsCategory.upsert({
                    where: { type_name: { type: "position", name } },
                    create: { type: "position", name },
                    update: {},
                    select: { id: true },
                }));
            }
            for (const seat of category.hopkinsRelationships) {
                if (strayIds.has(seat.id)) continue;
                for (const target of targets) {
                    // findFirst: a seat with no recorded start cannot use the compound key.
                    const clash = await tx.hopkinsRelationship.findFirst({
                        where: { hopkinsAffiliateId: seat.hopkinsAffiliateId, hopkinsCategoryId: target.id, startedAt: seat.startedAt },
                        select: { id: true, endedAt: true },
                    });
                    if (clash) {
                        // Keep the seat open if either record says it still is.
                        if (clash.endedAt && !seat.endedAt) {
                            await tx.hopkinsRelationship.update({ where: { id: clash.id }, data: { endedAt: null } });
                        }
                        continue;
                    }
                    await tx.hopkinsRelationship.create({
                        data: { hopkinsAffiliateId: seat.hopkinsAffiliateId, hopkinsCategoryId: target.id, startedAt: seat.startedAt, endedAt: seat.endedAt },
                    });
                }
            }
            await tx.hopkinsRelationship.deleteMany({ where: { hopkinsCategoryId: category.id } });
            await tx.hopkinsCategory.delete({ where: { id: category.id } });
        });
    }
    console.log("done");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
