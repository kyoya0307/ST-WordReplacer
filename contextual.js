import {compileContext,createContextOptions,CONTEXT_RULES} from './legacy.js';
import {filterReason,filterExplanation} from './filters.js';
import {protectionPattern,rangesFor} from './conditions.js';
export function compileContextGroups(s){
    const rows=(s.ruleGroups??[]).filter(g=>g.enabled).flatMap(g=>g.rules.filter(r=>r.enabled&&r.kind==='context').map(r=>{
        const options=structuredClone(s.contextOptions??createContextOptions());
        for(const [key,value]of Object.entries(options.rules)){value.enabled=key===r.template;value.replacement=key===r.template&&r.action!=='context'?(r.action==='word'?'':r.to):null;}
        const row={g,r,stage:CONTEXT_RULES.find(t=>t.id===r.template).stage,guard:protectionPattern(s,g.id,'context'),onPreserve:null};
        row.engine=compileContext(options,{safe:r.safeContext!==false,keep:r.contextKeep,onPreserve:e=>row.onPreserve?.(e)});return row;
    }));
    const run=(text,stage,replace,hit,preserved,explain,record=()=>{})=>{
        for(const row of rows){
            const {g,r,engine,stage:ownStage,guard}=row;
            if(stage!==ownStage)continue;
            const emit=e=>record({group:g.name,groupId:g.id,rule:r.name||r.template,ruleId:r.id,sourceType:'condition',...e});
            row.onPreserve=explain?e=>{if(preserved.length<100)preserved.push({...e,group:g.name});emit({...e,kind:'protect',sourceType:'builtin',reason:e.reason});}:null;
            text=engine.run(text,stage,(from,to)=>hit(from,to,`条件规则 · ${g.name} · ${r.name}`),null,(input,pattern,fn)=>{
                const ranges=rangesFor(guard,input);
                return replace(input,pattern,(...args)=>{
                    const start=args[typeof args.at(-1)==='object'?args.length-3:args.length-2],end=start+args[0].length;
                    const protectors=ranges.filter(p=>p.start<end&&p.end>start),reason=protectors.length?'命中保护内容':filterReason(input,{start,end},r.filters);
                    if(reason){if(explain){if(preserved.length<100)preserved.push({text:args[0],reason,group:g.name,rule:r.name});emit({start,end,text:args[0],kind:protectors.length||reason.includes('保留')||reason.includes('汉字相连')?'protect':'skip',reason:filterExplanation(input,{start,end},r.filters,reason),protectors:protectors.map(p=>({...p,text:input.slice(p.start,p.end)}))});}return args[0];}
                    const output=fn(...args);
                    if(explain&&output!==args[0])emit({start,end,text:args[0],to:output,kind:output===''?'delete':'replace',reason:'命中语境规则'});
                    return output;
                });
            });
            row.onPreserve=null;
        }
        return text;
    };
    // Preflight only normal-use decisions. These guards apply to overlapping
    // expression processing, while deliberate single-character replacements stay independent.
    const normalRows=rows.filter(row=>row.r.safeContext!==false);
    run.normalRanges=input=>{
        const ranges=[];
        for(const row of normalRows){
            row.onPreserve=e=>{
                let start=e.start,text=e.text;
                if(['direction','kinship','prefix'].includes(row.r.template)){
                    const family=/(?:你|他|她|它|牠|祂|[tT][aA])(?:妈|娘)的?/.exec(text);
                    if(family){start+=family.index;text=family[0];}
                }
                ranges.push({...e,start,end:start+text.length,text,group:row.g.name,groupId:row.g.id,ruleId:row.r.id,sourceType:'builtin'});
            };
            row.engine.run(input,row.stage,()=>{},null,(text,pattern,fn)=>text.replace(pattern,(...args)=>{fn(...args);return args[0];}));
            row.onPreserve=null;
        }
        return ranges;
    };
    return run;
}
