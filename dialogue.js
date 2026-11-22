// 用途：清理删空对白与引导语。
// Quote-aware deletion uses original offsets so rich-message text patches remain reversible.
const quotePairs = { '“': '”', '‘': '’', '「': '」', '『': '』', '"': '"' };
const overlaps = (a, b) => a.start < b.end && a.end > b.start;

function quotes(text) {
    const stack = [], result = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i], top = stack.at(-1);
        if (top && quotePairs[top.char] === char) {
            result.push({ start: stack.pop().start, end: i });
        } else if (quotePairs[char]) stack.push({ char, start: i });
    }
    return result; // Inner quotes precede outer quotes.
}

export function literalAnchors(text, spans) {
    const hits = [];
    for (const span of spans) for (const word of span.keywords ?? []) {
        if (!word) continue;
        let at = text.indexOf(word, span.start);
        while (at >= 0 && at + word.length <= span.end) {
            hits.push({ start: at, end: at + word.length });
            at = text.indexOf(word, at + word.length);
        }
    }
    return hits;
}

// A match wholly inside one quote owns its dialogue, not the surrounding narration.
export function clipDialogueSpans(text, spans, hits) {
    const ranges = quotes(text);
    return spans.map(span => {
        const anchors = hits.filter(hit => overlaps(span, hit));
        const quote = anchors.length && ranges.find(q => anchors.every(h => h.start > q.start && h.end <= q.end));
        return quote ? { ...span, start: Math.max(span.start, quote.start + 1), end: Math.min(span.end, quote.end) } : { ...span };
    }).filter(span => span.start < span.end);
}

function leadStart(text, open) {
    const prefix = text.slice(0, open);
    // Match a short, explicit speech lead at a clause boundary. Independent action
    // clauses stay outside the match, including when the quote starts on a new line.
    const lead = /(?:^|[。.!！?？；;…\r\n，,：:“”‘’「」『』"])[ \t]*((?:(?:她们|他们|我们|你们|她|他|我|你|对方|那人|有人|[\p{Script=Han}·]{2,5})[ \t]*)?(?:(?:轻声|低声|小声|大声|高声|柔声|冷声|笑着|哭着|轻轻|缓缓|平静地|轻声地|低声地)[ \t]*)?(?:说|说道|说着|说了句|问|问道|回答|答道|回应|喊|喊道|叫道|喃喃道|嘀咕道)[：:,，][ \t\r\n]*)$/u.exec(prefix);
    if (!lead) return open;
    const content = lead[1];
    // A combined action-and-speech phrase needs its own authored boundary.
    if (/[推拉走跑转抬拿放坐站进出看]/u.test(content)) return open;
    return open - content.length;
}

export function mergeDeletionSpans(spans) {
    const result = [];
    for (const span of [...spans].sort((a, b) => a.start - b.start || a.end - b.end)) {
        const last = result.at(-1);
        if (last && span.start <= last.end) {
            last.end = Math.max(last.end, span.end);
            last.clauseRange ||= span.clauseRange;
            last.keywords = [...new Set([...(last.keywords ?? []), ...(span.keywords ?? [])])];
        } else result.push({ ...span });
    }
    return result;
}

export function finishDialogueSpans(text, spans, protectedRanges = []) {
    let result = mergeDeletionSpans(spans);
    for (const quote of quotes(text)) {
        const inside = { start: quote.start + 1, end: quote.end };
        const affected = result.filter(span => overlaps(span, inside));
        if (!affected.length) continue;
        let remaining = '', pos = inside.start;
        for (const span of affected) {
            remaining += text.slice(pos, Math.max(pos, span.start));
            pos = Math.max(pos, Math.min(span.end, inside.end));
        }
        remaining += text.slice(pos, inside.end);
        if (/[^\s\p{P}]/u.test(remaining)) continue;
        const range = { start: leadStart(text, quote.start), end: quote.end + 1 };
        let retainStop = -1;
        if (range.start < quote.start && /[,，]/.test(text[range.start - 1] ?? '')) {
            if (/[。.]/.test(text[quote.end - 1] ?? '')) {
                range.start--;
                retainStop = quote.end - 1;
            } else if (!text.slice(range.end).trim()) range.start--;
        }
        const lineStart = text.lastIndexOf('\n', range.start - 1) + 1;
        if (/^[ \t]*$/.test(text.slice(lineStart, range.start))) {
            const trailing = /^[ \t]*\r?\n/.exec(text.slice(range.end));
            if (trailing) { range.start = lineStart; range.end += trailing[0].length; }
        }
        // Respect protected text in an attribution as well as in the dialogue.
        if (protectedRanges.some(p => overlaps(range, p))) continue;
        result = mergeDeletionSpans([...result, { ...affected[0], ...range }]);
        if (retainStop >= 0) result = result.flatMap(span => {
            if (retainStop < span.start || retainStop >= span.end) return [span];
            return [{ ...span, end: retainStop }, { ...span, start: retainStop + 1 }].filter(s => s.start < s.end);
        });
    }
    return result;
}
