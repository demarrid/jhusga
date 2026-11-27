/**
 * Flag layout for the history timeline: every event in view gets a box above
 * the axis on a pole down to its date, stacked so no box covers another box or
 * pole. Where that does not fit, the crowded stretch is shown with less: a run
 * of nearby events becomes one box listing their titles, then one listing their
 * short labels, then a count to zoom into. Pure, so it can run every frame.
 */

export type FlagEvent = {
    id: string;
    start: number;
    dateLabel: string;
    title: string;
    /** At most four words. */
    label: string;
    summary: string;
    weight: 1 | 2 | 3;
};

/** Text width in px for a CSS font shorthand without its family, e.g. "600 12.5px". */
export type Measure = (text: string, font: string) => number;

export type FlagGroup<E extends FlagEvent = FlagEvent> = {
    key: string;
    events: E[];
    /** Pole positions of the first and last event. */
    x0: number;
    x1: number;
};

type Shape<E extends FlagEvent> =
    | { type: "event"; mode: "full" | "title" | "tag"; event: E; titleLines: number; descLines: number }
    | { type: "list"; mode: "titles" | "labels"; shown: E[]; more: number }
    | { type: "count" };

export type Flag<E extends FlagEvent = FlagEvent> = Shape<E> & {
    key: string;
    group: FlagGroup<E>;
    poleX: number;
    left: number;
    width: number;
    height: number;
    /** Height of the box's bottom above the lowest flag position. */
    y: number;
};

/** Box metrics, which Timeline.module.css must match. */
export const FLAG_METRICS = {
    width: 232,
    compactWidth: 196,
    /** Left accent 3 + right border 1 + padding 8 and 9. */
    chromeX: 21,
    /** Borders 1 + 1, padding 6 and 7. */
    chromeY: 15,
    metaLine: 13,
    titleLine: 16,
    descGap: 2,
    descLine: 15,
    listLine: 16,
    labelLine: 15,
    /** Bullet and its gap before the text. */
    bulletIndent: 12,
    /** Tag chrome: left accent 3 + right border 1 + padding 6 and 7. */
    tagChromeX: 17,
    tagHeight: 23,
    badgeHeight: 22,
    badgeChromeX: 22,
    labelBoxMax: 184,
    labelBoxMin: 104,
} as const;

export const FLAG_FONTS = {
    title: "600 12.5px",
    desc: "400 11.5px",
    list: "500 12px",
    label: "600 11.5px",
    badge: "700 11px",
} as const;

const GAP_X = 6;
const GAP_Y = 6;
const POLE_CLEAR = 3;
const TITLE_LINES = 2;
const DESC_LINES = 2;
const LIST_MAX = 6;
const LABEL_MAX = 8;
/** Events closer than this, in px, run together into one group. */
const GROUP_GAP_PX = 44;
/** And a group spans no more than this. */
const GROUP_SPAN_PX = 170;
const MAX_ROUNDS = 60;

export function lineCount(text: string, width: number, font: string, measure: Measure, max: number): number {
    if (!text) return 0;
    const space = measure(" ", font);
    let lines = 1;
    let line = -1;
    for (const word of text.split(" ")) {
        const size = measure(word, font);
        if (line < 0) line = size;
        else if (line + space + size <= width) line += space + size;
        else {
            lines += 1;
            line = size;
            if (lines >= max) return max;
        }
    }
    return Math.min(lines, max);
}

export function groupEvents<E extends FlagEvent>(events: E[], toX: (time: number) => number): FlagGroup<E>[] {
    const groups: FlagGroup<E>[] = [];
    let current: FlagGroup<E> | null = null;
    for (const event of events) {
        const x = toX(event.start);
        if (current && x - current.x1 < GROUP_GAP_PX && x - current.x0 < GROUP_SPAN_PX) {
            current.events.push(event);
            current.x1 = x;
            continue;
        }
        current = { key: event.id, events: [event], x0: x, x1: x };
        groups.push(current);
    }
    return groups;
}

const maxLevel = (group: FlagGroup) => (group.events.length > 1 ? 3 : 2);

function shapes<E extends FlagEvent>(
    group: FlagGroup<E>,
    level: number,
    toX: (time: number) => number,
    usable: number,
    measure: Measure,
    compact: boolean,
): Flag<E>[] {
    const m = FLAG_METRICS;
    const fullWidth = compact ? m.compactWidth : m.width;
    const inner = fullWidth - m.chromeX - 2;
    const at = (poleX: number, width: number) => Math.min(Math.max(2, poleX - 1), Math.max(2, usable - width - 2));
    const flag = (shape: Shape<E>, key: string, poleX: number, width: number, height: number): Flag<E> => ({
        ...shape,
        key,
        group,
        poleX,
        left: at(poleX, width),
        width,
        height,
        y: 0,
    });

    if (level === 0) {
        return group.events.map((event) => {
            const titleLines = Math.max(1, lineCount(event.title, inner, FLAG_FONTS.title, measure, TITLE_LINES));
            const descLines = lineCount(event.summary, inner, FLAG_FONTS.desc, measure, DESC_LINES);
            const height =
                m.chromeY + m.metaLine + titleLines * m.titleLine + (descLines ? m.descGap + descLines * m.descLine : 0);
            return flag({ type: "event", mode: "full", event, titleLines, descLines }, event.id, toX(event.start), fullWidth, height);
        });
    }

    const single = group.events.length === 1 ? group.events[0]! : null;
    if (level === 1) {
        if (single) {
            const titleLines = Math.max(1, lineCount(single.title, inner, FLAG_FONTS.title, measure, TITLE_LINES));
            const height = m.chromeY + m.metaLine + titleLines * m.titleLine;
            return [flag({ type: "event", mode: "title", event: single, titleLines, descLines: 0 }, single.id, group.x0, fullWidth, height)];
        }
        const count = group.events.length;
        const shown = group.events.slice(0, count > LIST_MAX ? LIST_MAX - 1 : count);
        const rows = shown.length + (count > shown.length ? 1 : 0);
        const height = m.chromeY + m.metaLine + rows * m.listLine;
        return [flag({ type: "list", mode: "titles", shown, more: count - shown.length }, `${group.key}:list`, group.x0, fullWidth, height)];
    }

    if (level === 2) {
        if (single) {
            const width = Math.min(m.labelBoxMax, Math.ceil(measure(single.label, FLAG_FONTS.label)) + m.tagChromeX + 2);
            return [flag({ type: "event", mode: "tag", event: single, titleLines: 0, descLines: 0 }, single.id, group.x0, width, m.tagHeight)];
        }
        const count = group.events.length;
        const shown = group.events.slice(0, count > LABEL_MAX ? LABEL_MAX - 1 : count);
        const rows = shown.length + (count > shown.length ? 1 : 0);
        const widest = Math.max(...shown.map((event) => measure(event.label, FLAG_FONTS.label)));
        const width = Math.min(m.labelBoxMax, Math.max(m.labelBoxMin, Math.ceil(widest) + m.bulletIndent + m.chromeX + 2));
        const height = m.chromeY + m.metaLine + rows * m.labelLine;
        return [flag({ type: "list", mode: "labels", shown, more: count - shown.length }, `${group.key}:labels`, group.x0, width, height)];
    }

    const width = Math.ceil(measure(`${group.events.length} events`, FLAG_FONTS.badge)) + m.badgeChromeX;
    return [flag({ type: "count" }, `${group.key}:count`, group.x0, width, m.badgeHeight)];
}

type Placed = { left: number; right: number; bottom: number; top: number; pole: number };

/** Lowest free height for each flag, or null where none fits under `maxHeight`. */
function place(flags: Flag[], maxHeight: number): (number | null)[] {
    const placed: Placed[] = [];
    const heights: (number | null)[] = new Array(flags.length).fill(null);
    // Right to left, so a pole always stands left of the boxes placed below it.
    const order = flags.map((_, index) => index).sort((a, b) => flags[b]!.poleX - flags[a]!.poleX);

    for (const index of order) {
        const flag = flags[index]!;
        const left = flag.left;
        const right = flag.left + flag.width;
        const near = placed.filter(
            (other) =>
                (other.left < right + GAP_X && other.right > left - GAP_X) ||
                (other.pole >= left - POLE_CLEAR && other.pole <= right + POLE_CLEAR),
        );
        const candidates = [0, ...near.map((other) => other.top + GAP_Y)].sort((a, b) => a - b);
        for (const y of candidates) {
            const top = y + flag.height;
            if (top > maxHeight) break;
            const clear = near.every((other) => {
                const besides = other.right + GAP_X <= left || other.left >= right + GAP_X;
                if (!besides && other.bottom < top + GAP_Y && other.top + GAP_Y > y) return false;
                // Their pole runs from the axis up to their box, so it must stay below ours.
                if (other.pole >= left - POLE_CLEAR && other.pole <= right + POLE_CLEAR && other.bottom > y) return false;
                // Ours runs up to `y`, so no box may sit across it below that.
                if (flag.poleX >= other.left - POLE_CLEAR && flag.poleX <= other.right + POLE_CLEAR && other.bottom < y) {
                    return false;
                }
                return true;
            });
            if (!clear) continue;
            heights[index] = y;
            placed.push({ left, right, bottom: y, top, pole: flag.poleX });
            break;
        }
    }
    return heights;
}

export function layoutFlags<E extends FlagEvent>(options: {
    /** Visible events, in date order. */
    events: E[];
    toX: (time: number) => number;
    /** Width of the track not covered by the detail panel. */
    usable: number;
    maxHeight: number;
    measure: Measure;
    compact: boolean;
}): Flag<E>[] {
    const { toX, usable, maxHeight, measure, compact } = options;
    const events = options.events.filter((event) => {
        const x = toX(event.start);
        return x >= 0 && x <= usable;
    });
    const groups = groupEvents(events, toX);
    const levels = groups.map(() => 0);
    const reach = compact ? FLAG_METRICS.compactWidth : FLAG_METRICS.width;

    let flags: Flag<E>[] = [];
    let heights: (number | null)[] = [];
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
        flags = groups.flatMap((group, index) => shapes(group, levels[index]!, toX, usable, measure, compact));
        heights = place(flags, maxHeight);
        const failed = new Set<FlagGroup>();
        heights.forEach((height, index) => height === null && failed.add(flags[index]!.group));
        if (failed.size === 0) break;

        // Simplify the most detailed group near each failure, the busiest first, so crowding is
        // resolved where it is rather than by whichever flag happened to be placed last.
        const simplify = new Set<number>();
        for (const group of failed) {
            let best = -1;
            groups.forEach((other, index) => {
                if (levels[index]! >= maxLevel(other)) return;
                if (other.x1 + reach < group.x0 || other.x0 > group.x1 + reach) return;
                if (
                    best < 0 ||
                    levels[index]! < levels[best]! ||
                    (levels[index] === levels[best] && other.events.length > groups[best]!.events.length) ||
                    (levels[index] === levels[best] && other.events.length === groups[best]!.events.length && other === group)
                ) {
                    best = index;
                }
            });
            if (best >= 0) simplify.add(best);
        }
        if (simplify.size === 0) break;
        for (const index of simplify) levels[index]! += 1;
    }

    // Simplifying in batches overshoots, so give detail back wherever it still fits: weightier
    // and smaller groups first.
    const build = () => groups.flatMap((group, index) => shapes(group, levels[index]!, toX, usable, measure, compact));
    const fits = (candidate: Flag<E>[]) => place(candidate, maxHeight).every((height) => height !== null);
    if (heights.every((height) => height !== null)) {
        const priority = groups
            .map((group, index) => ({ index, weight: Math.max(...group.events.map((event) => event.weight)), size: group.events.length }))
            .sort((a, b) => b.weight - a.weight || a.size - b.size || a.index - b.index);
        for (let pass = 0; pass < 3; pass += 1) {
            let improved = false;
            for (const { index } of priority) {
                if (levels[index] === 0) continue;
                levels[index]! -= 1;
                const candidate = build();
                if (fits(candidate)) {
                    improved = true;
                    flags = candidate;
                } else {
                    levels[index]! += 1;
                }
            }
            if (!improved) break;
        }
        heights = place(flags, maxHeight);
    }

    return flags.flatMap((flag, index) => {
        const y = heights[index];
        return y === null || y === undefined ? [] : [{ ...flag, y }];
    });
}
