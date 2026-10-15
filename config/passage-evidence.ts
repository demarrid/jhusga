/** A historical PDF has no surviving hyperlinks. Its agenda links this file
 * as "Affirmative Action Resolution"; its official minutes record approval. */
export const REVIEWED_PASSAGE_EVIDENCE = [{
    legislationFileId: "1nI7x9ozTYTFgOECWW5e21JxFovZts_w9cAYU4pPMOF0",
    minutesFileId: "1cB5HB8ZxL08Z4ONNzlH0oyW0TfpIf01I",
    quote: `a. Affirmative Action Resolution- Senator Nayshawn and Senator
Cynthia
i. Naqvi said that they met with the advisors a couple of
times. The SGA will go over the edits, and then the Senate
will discuss.
ii. Black Caucus Chair Nayshawn Ferebee said that some
parts were removed to shorten the resolution and keep it
focused.
iii. Hispanic/Latinx Caucus Chair Cynthia Hidalgo combined
the sections to condense from nine pages to six pages.
iv. Naqvi asked to allocate a few minutes for the SGA
members to read through it. She asked if the Senate feels
confident to discuss this resolution today.
v. The motion to vote passed. Then, the motion to approve
also passed.`,
}] as const;

/** User-confirmed adoption and passage date (confirmed 2026-10-15),
 * distinct from machine-read vote evidence.
 * Its "100% voted" line alone is not evidence of adoption or unanimity. */
export const CONFIRMED_RESOLUTION_PASSAGE = [{
    legislationFileId: "1ze1tTgXIUzN3ErSRL4cnGa-KYFyuEB7cAUSM0rWPagk",
    minutesFileId: "1pwXD1WNdPYbHdu_2qbFjLh2ElbToOOPiTAwx-q1jya4",
    passedOn: "2023-09-05",
}] as const;
