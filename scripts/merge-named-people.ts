/**
 * Fold people a maintainer has confirmed are one person onto their full name,
 * and remove rows that were never a person.
 *
 * node --env-file=.env --import tsx scripts/merge-named-people.ts [--apply]
 *
 * Each group keeps the full name, not a title: "President Daniels", "Ron
 * Daniels" and "Ronny D" become Ronald J. Daniels. Every folded spelling stays
 * an alias, so later documents that write it still credit the kept person.
 * A verified row (email or login) is always the one kept; a group with two is
 * refused.
 *
 * Left out on purpose: Wendell E. Dunn, Jr. and Wendell E. Dunn III are two
 * generations of the family the Dunn award honours, and the archive names
 * both in the same sentence.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { nameKey } from "../lib/contributors";
import { mergeAffiliate, resetNameResolverCache } from "../lib/names";

/** The kept name, then every spelling the archive holds for that person. */
const PEOPLE: [keep: string, ...rows: string[]][] = [
    ["Rain Cheng", "Rain (MP)", "Rain Cheng"],
    ["Vanessa Zi Qi Ching", "Vanessa Ching", "Vanessa Zi Qi Ching"],
    ["William Cho", "Will Cho", "William Cho"],
    ["Ryan Chou", "President Ryan Chou", "Ryan Chouh34v", "Ryan Chou"],
    ["Ronald J. Daniels", "Ronny D", "ronny d’s", "Romy D", "President Daniels", "Ron Daniels", "Ronald J. Daniels"],
    ["Anna Du", "President Du", "Anna Du"],
    ["Andrei Leuca Espelien", "Andrei Espelien", "Andrei Leuca Espelien"],
    ["Jazzlyn Fernandez", "Jazz Fernandez", "Jazzlyn Fernandez"],
    ["Grace Guan", "Grace G", "Grace Guan"],
    ["Aleksis Garcia", "Aleks Garcia", "Aleksis Garcia"],
    ["Samantha Gomes", "Sam Gomes", "Samantha Gomes"],
    ["Charlotte Nell Green", "Charlie Green", "Charlotte Green", "Charlotte “Charlie” Green", "Charlotte Nell Green"],
    ["Rachelle Hernandez", "Rachel H", "Rachel Hernandez", "Rachelle Hernandez"],
    ["Cynthia Sanchez Hidalgo", "Cynthia Hidalgo", "Cynthia Hidalgo-Sanchez", "Sanchez Hidalgo", "Cynthia Sanchez Hidalgo"],
    ["Rachel Huang", "R Huang", "Rachel Huang"],
    ["Tim Huang", "T. Huang", "Tim Huang"],
    ["Kobi Khong", "President Khong", "Kobi Khong"],
    ["Sienna San Kim", "Sienna Kim", "Sienna San Kim"],
    ["Aarshi Lamichhane", "RC Lamichhane", "Aarshi Lamichhane"],
    ["Ruth Marie Landry", "Ruth Landry", "Ruth Marie Landry"],
    ["Wyatt Larkin", "Major Larkin", "Wyatt Larkin"],
    ["Elisabeth Long", "dean long", "Elisabeth Long"],
    ["Karen Meritxell Velazquez Luna", "Karen Velazquez Luna", "Karen Valezquez Luna", "Karen Vasquez Luna", "Karen Luna", "Karen Meritxell Velazquez Luna"],
    ["Jessie Martin", "dean martin", "Jessie Martin"],
    ["Terry Martinez", "Dean Martinez", "Terry Martinez"],
    ["Gia Grier McGinnis", "Gia McGinnis", "Gia Grier McGinnis"],
    ["Jahan Mirchandani", "Jahan Mirichandi", "Jahan Mirchandani"],
    ["Alberto Muniz", "Alberto Pepe Muniz", "Pepe Muniz", "Muniz", "Alberto Muniz"],
    ["Honora Muratori", "Nora Muratori", "Honora Muratori"],
    ["Charles O. Norman III", "Charles Norman", "Dr. Charles Norman", "Charles O Norman III", "Charles Norman III"],
    ["Oluwatobi Ogunbiyi", "Tobi Ogunbiyi", "Oluwatobi Ogunbiyi"],
    ["Rocío Oliva", "RocÃ­o Oliva", "Rocío Oliva"],
    ["Srigouri Oruganty", "gouri Oruganty", "Srigouri Oruganty"],
    ["Natalie Bernstein", "Natalie (Member of Public)", "Natalie Bernstein"],
    ["Luis Muñoz Rivera", "Luis MuÃ±oz Rivera", "Luis Muñoz Rivera"],
    // "Stephen M. Ruckman" is how he signs.
    ["Stephen Ruckman", "Steven Ruckman", "Stephen Ruckman"],
    ["Smita Ruzicka", "Dean Ruzicka", "Dean Smita Ruzicka", "Dr. Ruzicka", "Smita Ruzicka, Ph.D.", "Smita Ruzicka"],
    ["Angela Sadlowski", "Angela S.", "Angela Sadlowski"],
    ["Tiffany Sanchez", "Dean Sanchez", "Tiffany Sanchez"],
    ["Samuel Sands", "Sam Sands", "Samuel Sands"],
    // "Sam S" sits on the 2018-19 Class of 2021 council and committees with
    // him; Samuel Sands appears only 2014-17.
    ["Sam Schatmeyer", "Sam S", "Sam Schat", "Schatmeyer", "Sam Schatmeyer"],
    ["Edward Scheinerman", "Ed Scheinerman", "Edward Scheinerman"],
    ["Benjamin Scherzer", "Ben Scherzer", "Benjamin Scherzer"],
    ["T. E. Schlesinger", "Ed Schlesinger", "T.E. “Ed” Schlesinger", "T. E. Schlesinger"],
    ["Sean Durkis-Dervogne", "Senator Seán", "Sean Durkis-Dervogne"],
    ["Mahima Sanghera", "Mahima Singh", "Mahima Sanghera"],
    ["Alex Tan", "The Man with the Tan", "Alex Tan"],
    ["Daniel Teran", "Dan Teran", "Daniel Teran"],
    ["Mamadou Moctar Thiam", "Mamadou Thiam", "Mamadou Moctar Thiam"],
    ["Shizheng Tie", "JJ Tie", "Shizheng “JJ” Tie", "Shizheng Tie"],
    // The archive writes "Turning" throughout; "Turring" appears nowhere.
    ["Robert Turning", "Rob Turning", "Rob Turrining", "Robert Turning"],
    ["Kinsey Tyler", "Chair Tyler", "Kinsey Tyler"],
    ["Aliza Watters", "Eliza Waters", "Aliza Watters"],
    ["Andrew Wilson", "Andy Wilson", "Dean Wilson", "Andrew Wilson"],
    ["Calvin Wise", "Dean Wise", "Calvin Wise"],
    ["Jason Yu", "Jason Y", "Jason Yu"],
    ["Kimberly Zou", "Kim Zou", "Kimberly Zou"],
];

/** Read as a person by mistake: an action item, the mascot, a caucus. */
const NOT_PEOPLE = ["send follow-up to Jake", "Blue Jay", "Jay the Blue Jay", "Disabled Students"];

const select = {
    id: true, name: true, email: true, userId: true,
    _count: { select: { contributions: true } },
} as const;

async function main() {
    const apply = process.argv.includes("--apply");
    type Row = { id: string; name: string; email: string | null; userId: string | null; _count: { contributions: number } };
    type Plan = { keep: string; into: Row; from: Row[] };
    const plans: Plan[] = [];
    const problems: string[] = [];

    for (const [keep, ...names] of PEOPLE) {
        const rows: Row[] = [];
        for (const name of names) {
            const row = await prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey(name) }, select });
            if (row && !rows.some((other) => other.id === row.id)) rows.push(row);
        }
        if (rows.length === 0) {
            problems.push(`${keep}: none of its spellings is a row`);
            continue;
        }
        const verified = rows.filter((row) => row.email || row.userId);
        if (verified.length > 1) {
            problems.push(`${keep}: two verified rows (${verified.map((row) => row.name).join(", ")})`);
            continue;
        }
        const into =
            verified[0] ??
            rows.find((row) => nameKey(row.name) === nameKey(keep)) ??
            [...rows].sort((a, b) => b._count.contributions - a._count.contributions)[0]!;
        const clash = await prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey(keep) }, select: { id: true } });
        if (clash && !rows.some((row) => row.id === clash.id)) {
            problems.push(`${keep}: another row already has that name`);
            continue;
        }
        const from = rows.filter((row) => row.id !== into.id);
        if (from.length > 0 || into.name !== keep) plans.push({ keep, into, from });
    }

    const removals: Row[] = [];
    for (const name of NOT_PEOPLE) {
        const row = await prisma.hopkinsAffiliate.findUnique({ where: { nameKey: nameKey(name) }, select });
        if (!row) continue;
        if (row.email || row.userId) problems.push(`${name}: verified; not removed`);
        else removals.push(row);
    }

    for (const plan of plans) {
        const folded = plan.from.map((row) => `${row.name} (${row._count.contributions})`).join(", ");
        const rename = plan.into.name !== plan.keep ? `  [renamed from ${plan.into.name}]` : "";
        console.log(`${plan.keep}${rename}\n  <- ${folded || "(rename only)"}`);
    }
    for (const row of removals) console.log(`remove ${row.name} (${row._count.contributions} documents)`);
    if (problems.length) console.log(`\nproblems:\n  ${problems.join("\n  ")}`);
    console.log(`\n${plans.length} people, ${plans.reduce((sum, plan) => sum + plan.from.length, 0)} rows folded, ${removals.length} removed${apply ? "" : " (dry run; pass --apply)"}`);
    if (!apply) return;

    await mkdir(".archive-local", { recursive: true });
    const ids = [...plans.flatMap((plan) => [plan.into.id, ...plan.from.map((row) => row.id)]), ...removals.map((row) => row.id)];
    const backup = await prisma.hopkinsAffiliate.findMany({
        where: { id: { in: ids } },
        include: { contributions: true, aliases: true, hopkinsRelationships: true, reviewedAdministrator: true },
    });
    const file = `.archive-local/named-people-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, JSON.stringify({ plans, removals, backup }, null, 2));
    console.log(`backup: ${file}`);

    for (const plan of plans) {
        for (const row of plan.from) await mergeAffiliate(row.id, plan.into.id);
        if (plan.into.name !== plan.keep) {
            await prisma.$transaction([
                prisma.hopkinsAffiliate.update({ where: { id: plan.into.id }, data: { name: plan.keep, nameKey: nameKey(plan.keep) } }),
                prisma.hopkinsAlias.upsert({
                    where: { aliasKey: nameKey(plan.into.name) },
                    create: { alias: plan.into.name, aliasKey: nameKey(plan.into.name), hopkinsAffiliateId: plan.into.id, source: "manual" },
                    update: { hopkinsAffiliateId: plan.into.id, source: "manual" },
                }),
            ]);
        }
    }
    for (const row of removals) {
        await prisma.reviewedAdministrator.deleteMany({ where: { hopkinsAffiliateId: row.id } });
        // Credits, seats and aliases cascade; lib/names.ts keeps the name from coming back.
        await prisma.hopkinsAffiliate.delete({ where: { id: row.id } });
    }
    resetNameResolverCache();
    console.log("done");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
