import sharp from "sharp";

/**
 * Whether an embedded image is the SGA seal in public/logo.png: the blue jay
 * on a gavel. Bills typed on the current letterhead embed a small, compressed
 * copy of it, and the bill header draws the site's own copy instead. The gold
 * seal on older bills (Johns Hopkins's portrait, "Veritas vos liberabit") is a
 * different image and stays as the author embedded it.
 *
 * Images are compared as 16x16 thumbnails with their margins trimmed, by mean
 * absolute difference per channel (0-255). Across the archive's stored images,
 * copies of this seal scored under 7 and everything else over 40, the gold
 * seal included. The reference is stored here rather than read from public/,
 * which deployed functions do not carry; scripts/seal.check.ts fails when it
 * no longer matches logo.png.
 */
export const SEAL_FINGERPRINT =
    "/////////f3+////8/X4uMPUf5OycIOka4Gkh5m0t8LT8fP3/////P39/v7//////////f3+////vsjWWG+URV6HPluJZHmcaH2fS2OLMU19TGaQr73S/////f3+/////v7+////qLXJNFKBU2yVtsHS5ezy6O/16fD23un0pbvWQW2iKkp9nq3F/////v7+////uMPUNFGAcIep6O70+/7/8fb69vj6zeT1h67Pjqe7xNjpdIemQ1yFt8LT////+Pn6RGCPSGSS7PD19vn87PH26/H2////qcnke4+gzs/S9Pn93+buWXCWV3CX8fP3usXUL01+q7vQ/P//6/H27vT4////tsvhYaPeZ6XawM3Z7PD09/z+pbTKK0t9sr7Qipu2Q16J5evx8vf67/T49Pn8oLLCP2CJPmiYbZ/P2eXu+fr7////4+nvME5/fJCwcYWla3+e7PH27vP48/j7tr3HNVV7hZ67ztnk5+zw////sMDVbYiv0tznYXeaY3ugan+jWnKZ7/T4+/7/7/HynbPF1uf0////2tvc0dba2+TsSmSYAA9el6nFXHSaY3mfhpi0RWGM2uLr1t/rjqW+UnahoLLMiZ/AdoyrSl15X3qiNFePABhkZnulVm+Vg5azt8HSOleFboWrMleNPF+NkaTCq7vSxtLh3OTu6O/3/f//tMLXO1+UXnigQFqGr7zQ9vf5UmyVN1eJnK7B4ejv////+v7++Pv+9fj78fX56/H2+/3+4ObuM1WJSGSQ8fT3////r73SBC5yVXKf5Ovz+v3+8/f78fb68vf69vn8/v//3OXuPVuQABhkq7rQ/////f3+////kqbDACJoOFSFn7DI3OTt5+715+zz1t/qmavDMU2BAB5njaLA/////f3+/////f3+////t8PVPVqJJkV2NVF+O1mJUGmSNVF/KURzQFyItMHU/////f3+/////////////f3+////8/X4r73SeI2tWHKbXXeehZaxsL3R7/L3/////P39/v//////";

const SIZE = 16;
/** Halfway between the two groups the archive's images fell into. */
const MAX_DISTANCE = 20;

/** An image reduced to the thumbnail the fingerprint is made from. */
export async function sealFingerprint(bytes: Uint8Array): Promise<Buffer> {
    return sharp(bytes, { limitInputPixels: 40_000_000 }).flatten({ background: "#ffffff" }).trim({ threshold: 20 })
        .resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
}

/** Mean absolute difference per channel from the site's seal. */
export async function sealDistance(bytes: Uint8Array): Promise<number> {
    const reference = Buffer.from(SEAL_FINGERPRINT, "base64");
    const thumbnail = await sealFingerprint(bytes);
    let total = 0;
    for (let index = 0; index < reference.length; index++) total += Math.abs(thumbnail[index]! - reference[index]!);
    return total / reference.length;
}

/** Unreadable images are not the seal. */
export async function isSiteSeal(bytes: Uint8Array): Promise<boolean> {
    try {
        return await sealDistance(bytes) <= MAX_DISTANCE;
    } catch {
        return false;
    }
}
