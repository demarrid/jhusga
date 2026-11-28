import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { presentBill } from "../lib/bill-presentation";
import { renderDocument } from "../lib/render";
import { isSiteSeal, SEAL_FINGERPRINT, sealFingerprint } from "../lib/seal";

async function main() {
    const logo = readFileSync("public/logo.png");

    // The stored fingerprint is the site's logo; replacing logo.png means regenerating it.
    assert.equal((await sealFingerprint(logo)).toString("base64"), SEAL_FINGERPRINT,
        "SEAL_FINGERPRINT in lib/seal.ts no longer matches public/logo.png");

    // A letterhead embeds the seal small, recompressed and on a white page.
    const embedded = await sharp(logo).resize(174, 174).flatten({ background: "#ffffff" })
        .extend({ top: 6, bottom: 6, left: 6, right: 6, background: "#ffffff" }).jpeg({ quality: 70 }).toBuffer();
    assert.ok(await isSiteSeal(embedded), "a small embedded copy of the seal is recognised");

    // Other pictures are not the seal: a mirrored seal, a gold disc, a chart-like bar image.
    assert.ok(!await isSiteSeal(await sharp(logo).flop().resize(180, 180).png().toBuffer()), "a mirrored seal is not the seal");
    const gold = await sharp({ create: { width: 160, height: 160, channels: 3, background: "#c9a227" } }).png().toBuffer();
    assert.ok(!await isSiteSeal(gold), "a gold disc is not the seal");
    const bars = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#ffffff" } })
        .composite([{ input: { create: { width: 60, height: 150, channels: 3, background: "#16365e" } }, left: 40, top: 40 }])
        .png().toBuffer();
    assert.ok(!await isSiteSeal(bars), "a chart is not the seal");
    assert.ok(!await isSiteSeal(Buffer.from("not an image")), "an unreadable image is not the seal");

    // The title block keeps its seal instead of dropping it with the text-only header lines.
    const bill = "Senate\nof the\nStudent Government Association\nof\nThe Johns Hopkins University\n{ S. Bill. 26-27.01 }\nA Bill to Amend the Bylaws\nThe Example Act\nIntroduced by: Senator Example\nPresented for First Reading this First day of September in the year 2026\nSECTION 1. TITLE.\nThis Act may be referred to as the Example Act.\n";
    const image = { offset: 0, src: "/api/document-images/example", alt: "Document image 1", width: 174, height: 174, seal: true };
    const presented = presentBill(renderDocument(bill, [], { images: [image] }));
    assert.ok(presented.header.length > 0, "the bill header is recognised");
    assert.deepEqual(presented.images.map(found => [found.src, found.seal]), [[image.src, true]], "the header carries the seal");
    assert.ok(!JSON.stringify(presented.blocks).includes(image.src), "the seal is not repeated in the body");
    assert.deepEqual(presentBill(renderDocument("Meeting notes\nNothing to present.\n", [], { images: [image] })).images, [],
        "a document that is not a bill has no header images");

    console.log("seal checks passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
