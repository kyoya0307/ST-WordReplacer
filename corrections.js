// Local correction template. Configured words and cues are literal text.
import {sentenceUnits} from './templates.js';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const separators=/[ \t，,:：—–－-]/;
const meta=/^(?:(?:刚才|这里|此处|前面|上面|先前)(?:的描述|的表述)?|我)?(?:写错了|说错了|用词不当|表述有误|描述有误|笔误)$/;
const lead=/^(?:应该是|应该说|应当是|应当说|准确地说|确切地说|应为|改为|改成|是)[ \t]*(?:[，,:：][ \t]*)?/;
export function correctionSpans(input,rule){
    const spans=[],cues=[...rule.cues].sort((a,b)=>b.length-a.length).map(escape).join('|');
    const source=`(?:—+|–+|－{2,}|-{2,})[ \\t]*(?:${cues})(?=[，,:：。.!！?？；;…—–－\\s-]|$)`;
    for(const unit of sentenceUnits(input)){
        const part=input.slice(unit.start,unit.contentEnd);
        for(const marker of part.matchAll(new RegExp(source,'gu'))){
            const at=unit.start+marker.index,clause=unit.clauses.find(c=>c.start<=at&&c.end>=at);
            if(!clause)continue;
            const wrong=input.slice(clause.start,at),words=rule.keywords.filter(word=>wrong.includes(word));
            if(!words.length)continue;
            let end=at+marker[0].length;
            while(end<unit.contentEnd&&separators.test(input[end]))end++;
            while(end<unit.contentEnd){
                let stop=end;while(stop<unit.contentEnd&&!',，'.includes(input[stop]))stop++;
                const text=input.slice(end,stop).trim();
                if(!words.some(word=>text.includes(word))&&!meta.test(text))break;
                end=stop<unit.contentEnd?stop+1:stop;
                while(end<unit.contentEnd&&/[ \t]/.test(input[end]))end++;
            }
            const connective=lead.exec(input.slice(end,unit.contentEnd));
            if(connective)end+=connective[0].length;
            spans.push({start:clause.start,end});
        }
    }
    return spans;
}
