import {sentenceUnits} from './templates.js';
export const FILTER_FIELDS={before:'前接其中之一时处理',after:'后接其中之一时处理',exceptBefore:'前接其中之一时保留',exceptAfter:'后接其中之一时保留',contains:'范围内同时包含这些词',excludes:'范围内出现其中之一时保留'};
export const FILTER_EXAMPLES={
    before:['例如：关键词“苹果”，前接“红”','红苹果 → 红水果；青苹果保持原样。'],
    after:['例如：关键词“苹果”，后接“汁”','苹果汁 → 水果汁；苹果树保持原样。'],
    exceptBefore:['例如：关键词“苹果”，前接“青”时保留','青苹果保持原样；红苹果 → 红水果。'],
    exceptAfter:['例如：关键词“苹果”，后接“公司”时保留','苹果公司保持原样；桌上有苹果 → 桌上有水果。'],
    contains:['例如：关键词“草稿”，伴随词“【待整理】”','【待整理】这份草稿。 → 命中；这份草稿。 → 保留。'],
    excludes:['例如：关键词“苹果”，保留词“品牌”','这个品牌叫苹果。 → 保留；桌上有苹果。 → 命中。'],
};
export const BOUNDARIES={any:'任意位置',han:'两侧为非汉字边界',separated:'两侧为标点、空白或文本边缘'};
export function validateFilters(value){
    if(value===undefined)return undefined;
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('补充条件格式有误。');
    const out={scope:value.scope??'sentence',boundary:value.boundary??'any',distance:value.distance??0};
    if(!['clause','sentence'].includes(out.scope)||!Object.hasOwn(BOUNDARIES,out.boundary))throw new Error('请选择条件的判断范围与文字边界。');
    if(!Number.isInteger(out.distance)||out.distance<0||out.distance>2000)throw new Error('关键词间隔范围为 0～2000 字；0 表示不限。');
    if(value.maxClauses!==undefined){if(!Number.isInteger(value.maxClauses)||value.maxClauses<0||value.maxClauses>50)throw new Error('涉及分句数范围为 0～50；0 表示不限。');if(value.maxClauses)out.maxClauses=value.maxClauses;}
    if(value.ordered!==undefined&&typeof value.ordered!=='boolean')throw new Error('关键词顺序条件应为开关。');
    if(value.ordered)out.ordered=true;
    for(const key of Object.keys(FILTER_FIELDS)){
        const rows=value[key]??[];
        if(!Array.isArray(rows)||rows.length>500||rows.some(x=>typeof x!=='string'||!x.trim()||x.length>2000||/[\r\n]/.test(x)))throw new Error(`${FILTER_FIELDS[key]}：每行一项，每项 1～2000 字，最多 500 项。`);
        out[key]=[...new Set(rows)];
    }
    return out;
}
export function contextRange(input,hit,scope='sentence'){
    const unit=sentenceUnits(input).find(u=>u.start<=hit.start&&u.end>=hit.end);
    if(!unit)return {start:hit.start,end:hit.end};
    if(scope==='sentence')return {start:unit.start,end:unit.contentEnd};
    const first=unit.clauses.find(c=>c.end>=hit.start),last=unit.clauses.findLast(c=>c.start<=hit.end);
    return {start:first?.start??unit.start,end:last?.end??unit.contentEnd};
}
export function filterReason(input,hit,filters){
    if(!filters)return '';
    const before=input.slice(0,hit.start),after=input.slice(hit.end);
    // Only inspect adjacent code points; do not split the entire message into
    // characters or sentences for a simple prefix/suffix condition.
    const prev=Array.from(before.slice(-2)).at(-1)??'',next=Array.from(after.slice(0,2))[0]??'';
    if(filters.boundary==='han'&&[prev,next].some(c=>/\p{Script=Han}/u.test(c)))return '匹配片段与其他汉字相连';
    if(filters.boundary==='separated'&&[prev,next].some(c=>c&&!/[\s\p{P}\p{S}]/u.test(c)))return '匹配片段两侧仍有文字';
    if(filters.before?.length&&!filters.before.some(s=>before.endsWith(s)))return '前接条件未命中';
    if(filters.after?.length&&!filters.after.some(s=>after.startsWith(s)))return '后接条件未命中';
    if(filters.exceptBefore?.some(s=>before.endsWith(s)))return '命中前接保留条件';
    if(filters.exceptAfter?.some(s=>after.startsWith(s)))return '命中后接保留条件';
    if(filters.contains?.length||filters.excludes?.length){
        const range=contextRange(input,hit,filters.scope),part=input.slice(range.start,range.end);
        if(filters.contains?.length&&!filters.contains.every(s=>part.includes(s)))return '范围内的伴随词尚未齐全';
        if(filters.excludes?.some(s=>part.includes(s)))return '命中范围内保留词';
    }
    if(filters.maxClauses&&hit.members?.length>1){
        const unit=sentenceUnits(input).find(u=>u.start<=hit.start&&u.contentEnd>=hit.end);
        const count=unit?.clauses.filter(c=>c.end>hit.start&&c.start<hit.end).length;
        if(!count||count>filters.maxClauses)return '涉及分句数超过设定范围';
    }
    if(filters.ordered&&hit.members?.length>1){
        const keys=[...new Set([...hit.members].sort((a,b)=>a.start-b.start).map(m=>m.key))];
        if(keys.some((key,i)=>key!==i))return '关键词出现顺序与填写顺序不同';
    }
    if(filters.distance&&hit.members?.length>1){
        let cursor=hit.start,chars=0;
        for(const member of [...hit.members].sort((a,b)=>a.start-b.start)){if(member.start>cursor)chars+=Array.from(input.slice(cursor,member.start)).length;cursor=Math.max(cursor,member.end);}
        if(chars>filters.distance)return '关键词间隔超过设定范围';
    }
    return '';
}
export function filterExplanation(input,hit,filters,reason){
    if(!reason||!filters)return reason;
    const before=input.slice(0,hit.start),after=input.slice(hit.end),range=contextRange(input,hit,filters.scope),part=input.slice(range.start,range.end);
    for(const [key,test]of [['exceptBefore',s=>before.endsWith(s)],['exceptAfter',s=>after.startsWith(s)],['excludes',s=>part.includes(s)]]){
        const value=filters[key]?.find(test);if(value)return `${reason}：${FILTER_FIELDS[key]}“${value}”`;
    }
    if(reason==='前接条件未命中')return `${reason}：需要前接 ${filters.before.join(' / ')}`;
    if(reason==='后接条件未命中')return `${reason}：需要后接 ${filters.after.join(' / ')}`;
    if(reason==='范围内的伴随词尚未齐全')return `${reason}：${filters.contains.join(' / ')}`;
    return reason;
}
export function keywordMatches(input,r,protectedRanges=[],onProtected=()=>{}){
    const groups=[];
    for(const unit of sentenceUnits(input)){
        const ranges=r.filters?.scope==='clause'?unit.clauses:[{start:unit.start,end:unit.contentEnd}];
        for(const range of ranges){
            const hits=[];r.keywords.forEach((word,k)=>{let cursor=range.start;while(cursor<range.end){const start=input.indexOf(word,cursor);if(start<0||start+word.length>range.end)break;const hit={start,end:start+word.length,key:k};if(!protectedRanges.some(p=>p.start<hit.end&&p.end>hit.start))hits.push(hit);else onProtected(hit);cursor=start+word.length;}});
            hits.sort((a,b)=>a.start-b.start||b.end-a.end);
            if(r.matchMode==='all'){
                if(new Set(hits.map(h=>h.key)).size!==r.keywords.length)continue;
                if(r.filters?.distance||r.filters?.maxClauses||r.filters?.ordered){
                    for(let i=0;i<hits.length;i++){const members=[];for(let j=i;j<hits.length;j++){members.push(hits[j]);if(new Set(members.map(h=>h.key)).size===r.keywords.length){groups.push({start:hits[i].start,end:Math.max(...members.map(h=>h.end)),members:[...members]});break;}}}
                }else groups.push({start:hits[0].start,end:Math.max(...hits.map(h=>h.end)),members:hits});
            }else groups.push(...hits.map(h=>({...h,members:[h]})));
        }
    }
    return groups;
}
export function expandMatches(input,hits,scope){
    const spans=[];
    for(const unit of sentenceUnits(input)){
        const selected=new Set();
        for(const hit of hits){if(hit.start>=unit.contentEnd||hit.end<=unit.start)continue;
            unit.clauses.forEach((c,i)=>{if(scope==='sentence'||(c.end>hit.start&&c.start<hit.end))selected.add(i);});
        }
        for(let i=0;i<unit.clauses.length;i++)if(selected.has(i)){
            const first=i;while(selected.has(i+1))i++;const last=i;let start=unit.clauses[first].start,end;
            if(first===0&&last===unit.clauses.length-1){start=unit.start;end=unit.end;}
            else if(last===unit.clauses.length-1){start=unit.clauses[first-1].separator;end=unit.contentEnd;}
            else end=unit.clauses[last].separator+1;
            spans.push({start,end});
        }
    }
    return spans;
}
export function compatibleFilters(first,second){
    const a=first??{},b=second??{};
    for(const [required,except,method]of [['before','exceptBefore','endsWith'],['after','exceptAfter','startsWith']]){
        const left=a[required]??[],right=b[required]??[],excluded=[...a[except]??[],...b[except]??[]];let choices;
        if(left.length&&right.length)choices=left.flatMap(x=>right.flatMap(y=>x[method](y)?[x]:y[method](x)?[y]:[]));
        else choices=left.length?left:right.length?right:null;
        if(choices&&!choices.some(value=>!excluded.some(ex=>value[method](ex))))return false;
    }
    if((a.scope??'sentence')===(b.scope??'sentence')){
        const required=[...a.contains??[],...b.contains??[]],excluded=[...a.excludes??[],...b.excludes??[]];
        if(required.some(word=>excluded.some(ex=>word.includes(ex))))return false;
    }
    return true;
}
