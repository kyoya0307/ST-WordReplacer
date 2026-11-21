import { preservePairedMarks, sentenceUnits } from './templates.js';
import { compileSentenceRules } from './sentences.js';
import { protectionTerms } from './model.js';
import {filterReason,filterExplanation,keywordMatches,expandMatches} from './filters.js';
import {correctionSpans} from './corrections.js';
import {triggerTitle} from './presets.js';
import {clipDialogueSpans,literalAnchors,finishDialogueSpans,mergeDeletionSpans} from './dialogue.js';
import {subtractRanges} from './protection.js';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function protectionPattern(s,target='all',sharedTarget){
    const terms=[...new Set([...protectionTerms(s,target),...(sharedTarget?protectionTerms(s,sharedTarget):[])])].filter(Boolean).sort((a,b)=>b.length-a.length),structures=[];
    if(s.protectCode)structures.push('```[\\s\\S]*?(?:```|$)','~~~[\\s\\S]*?(?:~~~|$)','`[^`\\n]+`');
    if(s.protectTitles)structures.push('《[^《》\\r\\n]+》');
    const parts=[...structures,...terms.map(escape)];
    if(!parts.length)return null;
    const pattern=new RegExp(parts.join('|'),'gu');
    pattern.literalTerms=terms;pattern.structures=structures.join('|');
    pattern.termDetails=(s.protectionGroups??[]).filter(g=>g.enabled&&g.targets.some(t=>t==='all'||t===target||t===sharedTarget)).flatMap(g=>g.terms.filter(t=>t.enabled).map(t=>({term:t.text,sourceType:'manual',ruleId:t.id,groupId:g.id,rule:t.text,group:g.name,reason:'命中手动保护词'})));
    return pattern;
}
export function rangesFor(pattern,text){
    if(!pattern)return [];
    const structural=pattern.literalTerms===undefined?pattern.source:pattern.structures;
    const ranges=structural?[...text.matchAll(new RegExp(structural,pattern.flags))].map(m=>({start:m.index,end:m.index+m[0].length,sourceType:'builtin',rule:m[0].startsWith('《')?'《书名》保护':'代码保护',group:'通用保护',reason:'命中已开启的范围保护'})):[];
    const details=pattern.termDetails?.length?pattern.termDetails:(pattern.literalTerms??[]).map(term=>({term,sourceType:'manual',rule:term,group:'保护词',reason:'命中手动保护词'}));
    for(const detail of details)for(let at=text.indexOf(detail.term);at>=0;at=text.indexOf(detail.term,at+1))ranges.push({...detail,start:at,end:at+detail.term.length});
    return ranges;
}
const overlaps=(a,b)=>a.start<b.end&&a.end>b.start;
export function compileConditions(s){
    const rows=(s.ruleGroups??[]).filter(g=>g.enabled).flatMap(g=>{
        const guard=protectionPattern(s,g.id);
        return g.rules.filter(r=>r.enabled&&r.kind!=='context').map(r=>{
        const action=r.inheritAction?g.defaultAction:r.action;
        let pattern=null;
        if(r.kind==='pattern')pattern=new RegExp(`${escape(r.prefix)}\\p{Script=Han}{${r.min},${r.max}}${escape(r.suffix)}`,'gu');
        if(r.kind==='markers')pattern=new RegExp(`${escape(r.start)}[\\s\\S]*?${escape(r.end)}`,'gu');
        const boundary=r.kind==='boundary'?compileSentenceRules([{keyword:r.keyword,startChars:r.startChars,endChars:r.endChars,enabled:true}]):null;
        return {g,r,action,pattern,guard,boundary};
    });});
    return (input,{explain=false,normalRanges=[]}={})=>{
        const candidates=[],preserved=[],dialogueGuards=[],allGuards=[],events=[],guardCache=new Map();
        for(const [priority,{g,r,action,pattern,guard,boundary}]of rows.entries()){
            const emit=e=>{if(explain&&events.length<=1000)events.push({group:g.name,groupId:g.id,rule:triggerTitle(r),ruleId:r.id,sourceType:'condition',...e});};
            const blocked=(span,guards)=>{if(explain)emit({...span,kind:'protect',text:input.slice(span.start,span.end),reason:'保护优先，保留命中文字',protectors:guards.map(p=>({...p,text:input.slice(p.start,p.end)}))});};
            const related=normalRanges.filter(p=>r.kind==='keywords'&&r.keywords.some(word=>word.length>1&&p.text?.includes(word)));
            if(r.respectProtection&&!guardCache.has(guard))guardCache.set(guard,rangesFor(guard,input));
            const protectedRanges=r.respectProtection?[...guardCache.get(guard),...related]:[];
            allGuards.push(...protectedRanges);
            let spans=[],matches=[];
            if(r.kind==='boundary'){
                if(explain)for(let at=input.indexOf(r.keyword);at>=0;at=input.indexOf(r.keyword,at+r.keyword.length)){
                    const hit={start:at,end:at+r.keyword.length},guards=protectedRanges.filter(p=>overlaps(p,hit));if(guards.length)blocked(hit,guards);
                }
                spans=boundary(input,protectedRanges,true).deletions;
            }
            else{
                matches=r.kind==='correction'?correctionSpans(input,r):pattern?[...input.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length})):keywordMatches(input,r,protectedRanges,hit=>{
                    if(explain&&preserved.length<100)preserved.push({text:input.slice(hit.start,hit.end),reason:'关键词位于受保护的文字内',group:g.name,rule:triggerTitle(r)});
                    blocked(hit,protectedRanges.filter(p=>overlaps(p,hit)));
                });
                matches=matches.filter(hit=>{
                    const reason=filterReason(input,hit,r.filters);if(reason&&explain){if(preserved.length<100)preserved.push({text:input.slice(hit.start,hit.end),reason,group:g.name,rule:triggerTitle(r)});emit({...hit,kind:reason.includes('保留')||reason.includes('汉字相连')?'protect':'skip',text:input.slice(hit.start,hit.end),reason:filterExplanation(input,hit,r.filters,reason)});}return !reason;
                });
                if(['clause','sentence'].includes(action))spans=expandMatches(input,matches,action);
                else spans=matches.flatMap(m=>m.members??[m]);
            }
            const clauseRange=r.kind==='correction'||(r.kind!=='boundary'&&['clause','sentence'].includes(action));
            if(clauseRange){
                const anchors=r.kind==='correction'?literalAnchors(input,spans.map(span=>({...span,keywords:r.keywords}))):matches.flatMap(m=>m.members??[m]);
                spans=clipDialogueSpans(input,spans,anchors);
                dialogueGuards.push(...protectedRanges);
            }
            spans=spans.filter(span=>{
                const blocked=protectedRanges.some(p=>overlaps(span,p)),reason=filterReason(input,span,r.kind==='boundary'?r.filters:undefined);
                if(explain){
                    if(reason)emit({...span,kind:'skip',text:input.slice(span.start,span.end),reason});
                    else if(blocked)for(const p of protectedRanges.filter(p=>overlaps(span,p)))emit({start:Math.max(span.start,p.start),end:Math.min(span.end,p.end),kind:'protect',text:input.slice(Math.max(span.start,p.start),Math.min(span.end,p.end)),reason:'保护优先，其余命中内容继续清理',protectors:[{...p,text:input.slice(p.start,p.end)}]});
                }
                if((blocked||reason)&&explain&&preserved.length<100)preserved.push({text:reason||['replace','trimPrefix'].includes(action)?input.slice(span.start,span.end):protectedRanges.filter(p=>overlaps(span,p)).map(p=>input.slice(Math.max(span.start,p.start),Math.min(span.end,p.end))).join('、'),reason:reason||'保留命中的保护文字，其余清理继续',group:g.name,rule:triggerTitle(r)});
                return !reason&&(!blocked||!['replace','trimPrefix'].includes(action));
            });
            if(!['replace','trimPrefix'].includes(action))spans=subtractRanges(spans,protectedRanges);
            candidates.push(...spans.map(span=>({...span,text:action==='replace'?r.to:action==='trimPrefix'?input.slice(span.start+r.prefix.length,span.end):'',clauseRange,priority,source:`条件规则 · ${g.name}`,group:g.name,groupId:g.id,ruleId:r.id,sourceType:'condition',rule:triggerTitle(r),keywords:r.keywords??[r.kind==='boundary'?r.keyword:r.kind==='pattern'?`${r.prefix}…${r.suffix}`:r.start]})));
        }
        // Deletion ranges form a union; replacements use the longest match then category order.
        const deletions=candidates.filter(e=>e.text==='').sort((a,b)=>a.start-b.start||a.end-b.end),merged=[];
        for(const e of deletions){const last=merged.at(-1);if(last&&e.start<=last.end){last.end=Math.max(last.end,e.end);last.clauseRange ||= e.clauseRange;last.keywords=[...new Set([...last.keywords,...e.keywords])];}else merged.push({...e});}
        // Adjacent rules can jointly remove the tail or the whole sentence.
        // Reconcile its punctuation after union, then retain paired dialogue marks.
        const units=merged.some(e=>e.clauseRange)?sentenceUnits(input):[];
        for(const e of merged)if(e.clauseRange)for(const unit of units){
            if(e.end<unit.contentEnd||e.start>=unit.contentEnd||e.start<unit.start)continue;
            if(e.start<=unit.start)e.end=Math.max(e.end,unit.end);
            else if(',，'.includes(input[e.start-1]))e.start--;
        }
        const dialogue=finishDialogueSpans(input,merged.filter(e=>e.clauseRange),dialogueGuards);
        // Punctuation and dialogue cleanup may expand an edit. Reapply only the
        // protected pieces that no applicable deletion explicitly permits removing.
        const retained=subtractRanges(allGuards,candidates.filter(e=>e.text===''));
        const clean=mergeDeletionSpans(subtractRanges([...preservePairedMarks(input,dialogue),...merged.filter(e=>!e.clauseRange)],retained));
        const chosen=[...clean];
        for(const e of candidates.filter(e=>e.text!=='').sort((a,b)=>(b.end-b.start)-(a.end-a.start)||b.priority-a.priority))if(!chosen.some(c=>overlaps(e,c)))chosen.push(e);
        chosen.sort((a,b)=>a.start-b.start);
        if(explain)for(const e of candidates){
            if(events.length>1000)break;
            const winner=chosen.find(c=>overlaps(c,e));
            const active=e.text===''?chosen.some(c=>c.text===''&&overlaps(c,e)):chosen.includes(e);
            events.push({start:e.start,end:e.end,kind:active?(e.text===''?'delete':'replace'):'overridden',sourceType:'condition',group:e.group,groupId:e.groupId,rule:e.rule,ruleId:e.ruleId,text:input.slice(e.start,e.end),to:e.text,reason:active?(rows[e.priority].r.respectProtection?'命中规则，保护内容优先保留':'本规则清理优先'):'与删除范围或更优先的替换重叠',winner:winner?{group:winner.group,groupId:winner.groupId,rule:winner.rule,ruleId:winner.ruleId}:undefined});
        }
        if(explain)for(const span of subtractRanges(clean,candidates.filter(e=>e.text===''))){
            if(events.length>1000)break;
            events.push({start:span.start,end:span.end,kind:'delete',sourceType:'builtin',group:'清理收尾',rule:'对白与标点收尾',text:input.slice(span.start,span.end),to:'',reason:'相关内容已删空，整理引导语、引号或标点'});
        }
        let text='',pos=0;
        for(const e of chosen){text+=input.slice(pos,e.start)+e.text;pos=e.end;}
        return {text:text+input.slice(pos),edits:chosen,hits:chosen.map(e=>({from:input.slice(e.start,e.end),to:e.text,group:e.source,count:1})),deletions:clean.map(e=>({...e,text:input.slice(e.start,e.end)})),preserved,events};
    };
}
