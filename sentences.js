// 用途：按标点划分与清理句段。
import {validateTemplateRule,templateSpans,preservePairedMarks} from './templates.js';
import {clipDialogueSpans,literalAnchors,finishDialogueSpans} from './dialogue.js';
import {subtractRanges} from './protection.js';
export const SENTENCE_ENDS='。.!！?？；;…';
export const SENTENCE_STARTS='，,：:'+SENTENCE_ENDS;
export function sentenceTemplate(keyword,preset='punctuation') {
    return {keyword,enabled:true,startChars:preset==='sentence'?SENTENCE_ENDS:SENTENCE_STARTS,endChars:SENTENCE_ENDS};
}
export function validateSentenceRules(rules=[]) {
    if(!Array.isArray(rules)||rules.length>200)throw new Error('句段删除规则最多 200 条。');
    return rules.map((r,index)=>{
        if(r&&('keywords' in r||'matchMode' in r||'scope' in r))return validateTemplateRule(r,index);
        if(!r||typeof r.keyword!=='string'||!r.keyword.trim()||r.keyword.length>2000||/[\r\n]/.test(r.keyword))throw new Error('句段关键词不能为空、不能换行，最多 2000 字。');
        const out={id:typeof r.id==='string'?r.id:`sentence-${index}`,keyword:r.keyword,enabled:r.enabled!==false};
        for(const key of ['startChars','endChars']){
            const value=r[key]??(key==='startChars'?SENTENCE_STARTS:SENTENCE_ENDS);
            if(typeof value!=='string'||value.length>100)throw new Error('句段边界应为不超过 100 个字符的文字。');
            out[key]=[...new Set(value.replace(/[\r\n]/g,''))].join('');
        }
        return out;
    });
}
const closingPairs={'”':'“','’':'‘','」':'「','』':'『','）':'（',')':'(','】':'【',']':'['};
const count=(text,char)=>text.split(char).length-1;
function includeClosingMarks(text,start,end) {
    while(end<text.length){
        const close=text[end],open=closingPairs[close],removed=text.slice(start,end);
        if((open&&count(removed,open)>count(removed,close))||(close==='"'&&count(removed,'"')%2===1))end++;
        else break;
    }
    return end;
}
export function compileSentenceRules(rules,categoryRules=[]) {
    const enabled=[...validateSentenceRules(rules),...validateSentenceRules(categoryRules)].filter(r=>r.enabled),templates=enabled.filter(r=>r.keywords);
    const compiled=enabled.filter(r=>!r.keywords).map(r=>({...r,starts:new Set([...r.startChars,'\r','\n']),ends:new Set([...r.endChars,'\r','\n'])}));
    return function(input,protectedRanges=[],preserveWords=false) {
        let spans=templateSpans(input,templates,protectedRanges);
        for(const rule of compiled){
            let cursor=0;
            while(cursor<input.length){
                const index=input.indexOf(rule.keyword,cursor);if(index<0)break;
                cursor=index+rule.keyword.length;
                if(preserveWords&&protectedRanges.some(p=>p.start<cursor&&p.end>index))continue;
                let start=index,end=cursor;
                while(start>0&&!rule.starts.has(input[start-1]))start--;
                while(end<input.length&&!rule.ends.has(input[end]))end++;
                // 保留换行，避免把相邻段落拼接起来；连续句末标点一并移除。
                while(end<input.length&&!/[\r\n]/.test(input[end])&&rule.ends.has(input[end]))end++;
                end=includeClosingMarks(input,start,end);
                // 同一关键词在已覆盖句段中再次出现时，无需重复扫描至句末。
                cursor=Math.max(cursor,end);
                if(!preserveWords&&protectedRanges.some(r=>r.start<end&&r.end>start))continue;
                spans.push({start,end,keywords:[rule.keyword]});
            }
        }
        spans=clipDialogueSpans(input,spans,literalAnchors(input,spans));
        if(preserveWords)spans=subtractRanges(spans,protectedRanges);
        spans=preservePairedMarks(input,finishDialogueSpans(input,spans,protectedRanges));
        spans.sort((a,b)=>a.start-b.start||a.end-b.end);
        const merged=[];
        for(const span of spans){
            const last=merged.at(-1);
            if(last&&span.start<=last.end){last.end=Math.max(last.end,span.end);last.keywords=[...new Set([...last.keywords,...span.keywords])];}
            else merged.push({...span});
        }
        let text='',pos=0;
        for(const span of merged){span.text=input.slice(span.start,span.end);text+=input.slice(pos,span.start);pos=span.end;}
        return {text:text+input.slice(pos),deletions:merged};
    };
}
