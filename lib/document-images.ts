/** Image metadata passed to the viewer; image bytes stay on the server. */
export type DocumentImage = {
    offset: number;
    inline?: boolean;
    src: string;
    alt: string;
    width: number;
    height: number;
};
