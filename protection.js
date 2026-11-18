// Subtract protected intervals while retaining the original offsets and edit metadata.
export function subtractRanges(spans, guards) {
    let result = spans.map(span => ({...span}));
    for (const guard of guards) result = result.flatMap(span => {
        if (span.end <= guard.start || span.start >= guard.end) return [span];
        return [{...span, end: Math.min(span.end, guard.start)},
            {...span, start: Math.max(span.start, guard.end)}].filter(s => s.start < s.end);
    });
    return result;
}
