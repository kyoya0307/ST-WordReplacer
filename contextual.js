import {compileContext,createContextOptions,CONTEXT_RULES} from './legacy.js';
import {filterReason} from './filters.js';
import {protectionPattern,rangesFor} from './conditions.js';
export function compileContextGroups(s){
    const rows=(s.ruleGroups??[]).filter(g=>g.enabled).flatMap(g=>g.rules.filter(r=>r.enabled&&r.kind==='context').map(r=>{
        const options=structuredClone(s.contextOptions??createContextOptions());
        for(const [key,value]of Object.entries(options.rules)){value.enabled=key===r.template;value.replacement=key===r.template&&r.action!=='context'?(r.action==='word'?'':r.to):null;}
        const row={g,r,options,stage:CONTEXT_RULES.find(t=>t.id===r.template).stage,guard:protectionPattern(s,g.id),shared:protectionPattern(s,'context'),onPreserve:null};
        row.engine=compileContext(options,{safe:r.safeContext!==false,onPreserve:e=>row.onPreserve?.(e)});return row;
    }));
    return (text,stage,replace,hit,preserved,explain)=>{
        for(const row of rows){
            const {g,r,engine,stage:ownStage,guard,shared}=row;
            if(stage!==ownStage)continue;
            row.onPreserve=e=>{if(explain&&preserved.length<100)preserved.push({...e,group:g.name});};
            text=engine.run(text,stage,(from,to)=>hit(from,to,`条件规则 · ${g.name} · ${r.name}`),null,(input,pattern,fn)=>{
                const ranges=[...rangesFor(guard,input),...rangesFor(shared,input)];
                return replace(input,pattern,(...args)=>{
                    const start=args[typeof args.at(-1)==='object'?args.length-3:args.length-2],end=start+args[0].length;
                    const reason=ranges.some(p=>p.start<end&&p.end>start)?'命中保护词或代码块':filterReason(input,{start,end},r.filters);
                    if(reason){if(explain&&preserved.length<100)preserved.push({text:args[0],reason,group:g.name,rule:r.name});return args[0];}
                    return fn(...args);
                });
            });
            row.onPreserve=null;
        }
        return text;
    };
}
