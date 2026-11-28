/** Image metadata passed to the viewer; image bytes stay on the server. */
export type DocumentImage = {
    offset: number;
    inline?: boolean;
    src: string;
    alt: string;
    width: number;
    height: number;
    /** A copy of the site's own seal (lib/seal.ts), so a bill header can draw public/logo.png instead. */
    seal?: boolean;
};
