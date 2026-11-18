import { preservePairedMarks, sentenceUnits } from './templates.js';
import { compileSentenceRules } from './sentences.js';
import { protectionTerms } from './model.js';
import {filterReason,keywordMatches,expandMatches} from './filters.js';
import {triggerTitle} from './presets.js';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function protectionPattern(s,target='all'){
    const parts=protectionTerms(s,target).filter(Boolean).sort((a,b)=>b.length-a.length).map(escape);
    if(s.protectCode)parts.unshift('```[\\s\\S]*?(?:```|$)','~~~[\\s\\S]*?(?:~~~|$)','`[^`\\n]+`');
    return parts.length?new RegExp(parts.join('|'),'gu'):null;
}
export function rangesFor(pattern,text){return pattern?[...text.matchAll(new RegExp(pattern.source,pattern.flags))].map(m=>({start:m.index,end:m.index+m[0].length})):[];}
const overlaps=(a,b)=>a.start<b.end&&a.end>b.start;
export function compileConditions(s){
    const rows=(s.ruleGroups??[]).filter(g=>g.enabled).flatMap(g=>g.rules.filter(r=>r.enabled&&r.kind!=='context').map(r=>{
        const action=r.inheritAction?g.defaultAction:r.action;
        let pattern=null;
        if(r.kind==='pattern')pattern=new RegExp(`${escape(r.prefix)}\\p{Script=Han}{${r.min},${r.max}}${escape(r.suffix)}`,'gu');
        if(r.kind==='markers')pattern=new RegExp(`${escape(r.start)}[\\s\\S]*?${escape(r.end)}`,'gu');
        return {g,r,action,pattern,guard:protectionPattern(s,g.id)};
    }));
    return (input,{explain=false}={})=>{
        const candidates=[],preserved=[];
        for(const [priority,{g,r,action,pattern,guard}]of rows.entries()){
            const protectedRanges=r.respectProtection?rangesFor(guard,input):[];
            let spans=[],matches=[];
            if(r.kind==='boundary')spans=compileSentenceRules([{keyword:r.keyword,startChars:r.startChars,endChars:r.endChars,enabled:true}])(input,protectedRanges).deletions;
            else{
                matches=pattern?[...input.matchAll(new RegExp(pattern.source,pattern.flags))].map(m=>({start:m.index,end:m.index+m[0].length})):keywordMatches(input,r);
                matches=matches.filter(hit=>{
                    const reason=filterReason(input,hit,r.filters);if(reason&&explain&&preserved.length<100)preserved.push({text:input.slice(hit.start,hit.end),reason,group:g.name,rule:triggerTitle(r)});return !reason;
                });
                if(['clause','sentence'].includes(action))spans=expandMatches(input,matches,action);
                else spans=matches.flatMap(m=>m.members??[m]);
            }
            spans=spans.filter(span=>{
                const blocked=protectedRanges.some(p=>overlaps(span,p)),reason=filterReason(input,span,r.kind==='boundary'?r.filters:undefined);
                if((blocked||reason)&&explain&&preserved.length<100)preserved.push({text:input.slice(span.start,span.end),reason:reason||'命中保护词或代码块',group:g.name,rule:triggerTitle(r)});
                return !blocked&&!reason;
            });
            candidates.push(...spans.map(span=>({...span,text:action==='replace'?r.to:'',clauseRange:r.kind!=='boundary'&&['clause','sentence'].includes(action),priority,source:`条件规则 · ${g.name}`,rule:triggerTitle(r),keywords:r.keywords??[r.kind==='boundary'?r.keyword:r.kind==='pattern'?`${r.prefix}…${r.suffix}`:r.start]})));
        }
        // Deletion ranges form a union; replacements use the longest match then category order.
        const deletions=candidates.filter(e=>e.text==='').sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
        for(const e of deletions){const last=merged.at(-1);if(last&&e.start<=last.end){last.end=Math.max(last.end,e.end);last.clauseRange ||= e.clauseRange;last.keywords=[...new Set([...last.keywords,...e.keywords])];}else merged.push({...e});}
        // Adjacent rules can jointly remove the tail or the whole sentence.
        // Reconcile its punctuation after union, then retain paired dialogue marks.
        for(const e of merged)if(e.clauseRange)for(const unit of sentenceUnits(input)){
            if(e.end<unit.contentEnd||e.start>=unit.contentEnd||e.start<unit.start)continue;
            if(e.start<=unit.start)e.end=Math.max(e.end,unit.end);
            else if(',，'.includes(input[e.start-1]))e.start--;
        }
        const clean=merged.flatMap(e=>e.clauseRange?preservePairedMarks(input,[e]):[e]);
        const chosen=[...clean];
        for(const e of candidates.filter(e=>e.text!=='').sort((a,b)=>(b.end-b.start)-(a.end-a.start)||b.priority-a.priority))if(!chosen.some(c=>overlaps(e,c)))chosen.push(e);
        chosen.sort((a,b)=>a.start-b.start);
        let text='',pos=0;
        for(const e of chosen){text+=input.slice(pos,e.start)+e.text;pos=e.end;}
        return {text:text+input.slice(pos),edits:chosen,hits:chosen.map(e=>({from:input.slice(e.start,e.end),to:e.text,group:e.source,count:1})),deletions:clean.map(e=>({...e,text:input.slice(e.start,e.end)})),preserved};
    };
}
