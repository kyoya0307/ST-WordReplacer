// Literal-text templates: no user-supplied regular expression or model request.
export const TEMPLATE_MATCHES={any:'包含任意一个词',all:'同一句同时包含所有词（不限顺序）'};
export const TEMPLATE_SCOPES={clause:'删除命中的连续分句（逗号分隔）',sentence:'删除完整句子'};
const ends=new Set('。.!！?？；;…\r\n');
const commas=new Set('，,');
const pairs={'”':'“','’':'‘','」':'「','』':'『','）':'（',')':'(','】':'【',']':'['};
export function templateRule(keywords=[],matchMode='any',scope='clause') {
    return {name:'',keywords,matchMode,scope,enabled:true,respectProtection:true};
}
export function validateTemplateRule(r,index=0) {
    if(!Array.isArray(r.keywords)||!r.keywords.length||r.keywords.length>20000||r.keywords.some(k=>typeof k!=='string'||!k.trim()||k.length>2000||/[\r\n]/.test(k)))throw new Error('模板关键词每行一个，不能为空或包含换行，每个词最多 2000 字。');
    if(!Object.hasOwn(TEMPLATE_MATCHES,r.matchMode))throw new Error('未知的模板匹配方式。');
    if(!Object.hasOwn(TEMPLATE_SCOPES,r.scope))throw new Error('未知的模板删除范围。');
    if(r.respectProtection!==undefined&&typeof r.respectProtection!=='boolean')throw new Error('模板保护开关必须为布尔值。');
    return {id:typeof r.id==='string'?r.id:`template-${index}`,name:typeof r.name==='string'?r.name.slice(0,100):'',keywords:[...new Set(r.keywords)],matchMode:r.matchMode,scope:r.scope,enabled:r.enabled!==false,respectProtection:r.respectProtection!==false};
}
function units(text) {
    const out=[];let start=0;
    while(start<text.length){
        if(ends.has(text[start])){start++;continue;}
        let end=start;while(end<text.length&&!ends.has(text[end]))end++;
        const contentEnd=end;
        while(end<text.length&&ends.has(text[end])&&!/[\r\n]/.test(text[end]))end++;
        // Only include closing marks whose opener belongs to this sentence.
        while(end<text.length){
            const close=text[end],open=pairs[close],part=text.slice(start,end);
            if((open&&part.split(open).length>part.split(close).length)||(close==='"'&&(part.split('"').length-1)%2===1))end++;
            else break;
        }
        const clauses=[];let from=start;
        for(let i=start;i<contentEnd;i++)if(commas.has(text[i])){clauses.push({start:from,end:i,separator:i});from=i+1;}
        clauses.push({start:from,end:contentEnd,separator:contentEnd});
        out.push({start,contentEnd,end,clauses});start=Math.max(end,start+1);
    }
    return out;
}
function hitsIn(text,unit,keywords) {
    const hits=[];const found=new Set();
    keywords.forEach((keyword,k)=>{
        let cursor=unit.start;
        while(cursor<unit.contentEnd){
            const at=text.indexOf(keyword,cursor);
            if(at<0||at+keyword.length>unit.contentEnd)break;
            hits.push({start:at,end:at+keyword.length,keyword});found.add(k);cursor=at+keyword.length;
        }
    });
    return {hits,found};
}
export function templateSpans(input,rules,protectedRanges=[]) {
    const spans=[];
    if(!rules.length)return spans;
    const overlap=(a,b)=>a.start<b.end&&a.end>b.start;
    for(const unit of units(input)){
        const selected=new Map();
        for(const rule of rules){
            const {hits,found}=hitsIn(input,unit,rule.keywords);
            if(!hits.length||(rule.matchMode==='all'&&found.size!==rule.keywords.length))continue;
            const ranges=rule.matchMode==='all'?[{start:hits.reduce((n,h)=>Math.min(n,h.start),Infinity),end:hits.reduce((n,h)=>Math.max(n,h.end),0),keywords:rule.keywords}]:hits.map(h=>({...h,keywords:[h.keyword]}));
            for(const hit of ranges){
                let first=unit.clauses.findIndex(c=>c.end>hit.start);
                let last=unit.clauses.findLastIndex(c=>c.start<hit.end);
                if(first<0||last<0)continue;
                if(rule.scope==='sentence'){first=0;last=unit.clauses.length-1;}
                const candidate={start:unit.clauses[first].start,end:unit.clauses[last].end};
                if(rule.respectProtection&&protectedRanges.some(p=>overlap(candidate,p)))continue;
                for(let i=first;i<=last;i++){
                    const record=selected.get(i)??{keywords:new Set(),names:new Set()};
                    hit.keywords.forEach(k=>record.keywords.add(k));if(rule.name)record.names.add(rule.name);selected.set(i,record);
                }
            }
        }
        for(let i=0;i<unit.clauses.length;i++){
            if(!selected.has(i))continue;
            const first=i,keywords=new Set(),names=new Set();
            do{selected.get(i).keywords.forEach(k=>keywords.add(k));selected.get(i).names.forEach(n=>names.add(n));i++;}while(selected.has(i));
            const last=i-1;let start=unit.clauses[first].start,end;
            if(first===0&&last===unit.clauses.length-1){start=unit.start;end=unit.end;}
            else if(last===unit.clauses.length-1){start=unit.clauses[first-1].separator;end=unit.contentEnd;}
            else end=unit.clauses[last].separator+1;
            spans.push({start,end,keywords:[...keywords],names:[...names]});i=last;
        }
    }
    return spans;
}
// Preserve a paired quote/bracket when only one half lies in a deleted clause.
// This keeps surviving dialogue balanced without adding or rewriting words.
export function preservePairedMarks(text,spans) {
    const openings=new Set(Object.values(pairs)),stack=[],keep=new Set();let doubleQuote=null;
    const removed=at=>spans.some(s=>s.start<=at&&at<s.end);
    const retainPair=(a,b)=>{if(removed(a)!==removed(b))keep.add(removed(a)?a:b);};
    for(let i=0;i<text.length;i++){
        const char=text[i];
        if(char==='"'){if(doubleQuote===null)doubleQuote=i;else{retainPair(doubleQuote,i);doubleQuote=null;}}
        else if(openings.has(char))stack.push({char,at:i});
        else if(pairs[char]){const index=stack.findLastIndex(x=>x.char===pairs[char]);if(index>=0){retainPair(stack[index].at,i);stack.splice(index,1);}}
    }
    const points=[...keep].sort((a,b)=>a-b),out=[];
    for(const span of spans){let start=span.start;for(const at of points){if(at<start||at>=span.end)continue;if(start<at)out.push({...span,start,end:at});start=at+1;}if(start<span.end)out.push({...span,start});}
    return out;
}
