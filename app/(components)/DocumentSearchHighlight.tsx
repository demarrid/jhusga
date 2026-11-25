'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { documentQueryHighlights } from '@/lib/document-query';

/** Paint ranges without changing the document DOM or its citation anchors. */
export default function DocumentSearchHighlight({ children }: { children: ReactNode }) {
    const root = useRef<HTMLDivElement>(null);
    const params = useSearchParams();
    const query = params.get('q') ?? '';
    useEffect(() => {
        if (!root.current || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
        const terms = documentQueryHighlights(query);
        if (!terms.length) return;
        const walker = document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT);
        const nodes: { node: Text; start: number; end: number }[] = [];
        let text = '';
        while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            nodes.push({ node, start: text.length, end: text.length + node.length });
            text += node.data;
        }
        const ranges: Range[] = [];
        for (const term of terms) {
            const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
                const start = nodes.find(item => item.start <= match.index && item.end > match.index);
                const endOffset = match.index + match[0].length;
                const end = nodes.find(item => item.start < endOffset && item.end >= endOffset);
                if (!start || !end) continue;
                const range = new Range();
                range.setStart(start.node, match.index - start.start);
                range.setEnd(end.node, endOffset - end.start);
                ranges.push(range);
            }
        }
        ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
        CSS.highlights.set('document-search', new Highlight(...ranges));
        if (!window.location.hash && ranges[0]) ranges[0].startContainer.parentElement?.scrollIntoView({ block: 'center' });
        return () => { CSS.highlights.delete('document-search'); };
    }, [query]);
    return <><style>{'::highlight(document-search) { background-color: #ffe58a; color: #191919; }'}</style><div ref={root}>{children}</div></>;
}
