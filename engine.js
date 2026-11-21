import { DEFAULT_GROUPS } from './defaults.js';
import { createContextOptions, validateContextOptions, compileContext } from './legacy.js';
import { compileSentenceRules, validateSentenceRules } from './sentences.js';
import { TextTrace } from './trace.js';
import { upgradeStructure } from './model.js';
import { compileConditions, protectionPattern, rangesFor } from './conditions.js';
import {compileContextGroups} from './contextual.js';
import {WORD_PAGE_SIZES,WORD_ORDERS} from './words-view.js';
import {ExplanationTrace} from './explanation.js';

export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const THEMES = Object.freeze({st:'跟随 ST',pink:'粉色',green:'绿色',beige:'米色',black:'黑色',white:'白色'});
export function validateExceptions(values=[]) {
    if(!Array.isArray(values)||values.some(s=>typeof s!=='string'))throw new Error('保护词应为文字数组。');
    const out=[...new Set(values.filter(Boolean))];
    if(out.length>5000||out.some(s=>s.length>2000))throw new Error('保护词最多 5000 条，每条最多 2000 字。');
    return out;
}
// to 始终保存当前生效文字；候选是可选数据，普通词条无需迁移。
export function replacementData(rule) {
    if(typeof rule.to!=='string'||rule.to.length>10000)throw new Error('替换词必须为不超过 10000 字的文字。');
    const out={to:rule.to};
    if(rule.multiple!==undefined&&typeof rule.multiple!=='boolean')throw new Error('多个替换词开关格式不正确。');
    if(rule.alternatives!==undefined){
        if(!Array.isArray(rule.alternatives)||!rule.alternatives.length||rule.alternatives.length>50||rule.alternatives.some(s=>typeof s!=='string'||s.length>10000))throw new Error('每条词最多 50 个候选，每个候选不超过 10000 字。');
        if(!rule.alternatives.includes(rule.to))throw new Error('当前替换词必须在候选列表中。');
        out.alternatives=[...new Set(rule.alternatives)];out.multiple=rule.multiple===true;
    }else if(rule.multiple)throw new Error('请先添加候选替换词。');
    return out;
}
export function setReplacement(rule,value) {
    if(typeof value!=='string'||value.length>10000)throw new Error('替换词不能超过 10000 字。');
    if(rule.alternatives)rule.alternatives=[...new Set(rule.alternatives.map(x=>x===rule.to?value:x))];
    rule.to=value;
}
export function enableAlternatives(rule,enabled) {
    if(enabled){rule.alternatives??=[rule.to];rule.multiple=true;}
    else if(rule.alternatives)rule.multiple=false;
}
export function addAlternative(rule,value) {
    if(typeof value!=='string'||value.length>10000)throw new Error('候选文字不能超过 10000 字。');
    if(!rule.multiple)throw new Error('请先启用此词的多个替换词。');
    if(rule.alternatives.includes(value))throw new Error('已有相同候选，无需重复添加。');
    if(rule.alternatives.length>=50)throw new Error('每条词最多 50 个候选。');
    rule.alternatives.push(value);
}
export function editAlternative(rule,index,value) {
    if(!rule.alternatives||!Number.isInteger(index)||index<0||index>=rule.alternatives.length)throw new Error('候选已不存在。');
    if(typeof value!=='string'||value.length>10000)throw new Error('候选文字不能超过 10000 字。');
    if(rule.alternatives.some((x,i)=>i!==index&&x===value))throw new Error('已有相同候选，请选择已有项。');
    const active=rule.to===rule.alternatives[index];rule.alternatives[index]=value;if(active)rule.to=value;
}
export function removeAlternative(rule,index) {
    if(!rule.alternatives||!Number.isInteger(index)||index<0||index>=rule.alternatives.length)throw new Error('候选已不存在。');
    if(rule.alternatives[index]===rule.to)throw new Error('请先选择另一个候选，再删除当前使用项。');
    rule.alternatives.splice(index,1);
}
export function selectAlternative(rule,value) {
    if(!rule.multiple||!rule.alternatives?.includes(value))throw new Error('候选未启用或不存在。');
    rule.to=value;
}
export const matchesRule = (rule,query) => [rule.from,rule.to,...(rule.alternatives??[])].some(x=>x.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
const sameReplacement=(a,b)=>JSON.stringify(replacementData(a))===JSON.stringify(replacementData(b));
function copyReplacement(target,source) {
    const data=replacementData(source);delete target.alternatives;delete target.multiple;Object.assign(target,data);
}
function baseSettings() {
    return { version: 3, theme:'st', wordPageSize:15,wordOrder:'default',enabled: true, assistant: true, user: false, edited: true, display: true, prompt: true,
        contextual: true, contextOptions:createContextOptions(), sentenceRules:[], protectCode: true, protectTitles: false, exceptions: [], groups:[] };
}
export function createSettings() {
    return {...baseSettings(),groups:structuredClone(DEFAULT_GROUPS)};
}
export function createBlankSettings(){
    return {...baseSettings(),version:4,contextual:false,groups:[{id:uid(),name:'日常用词',enabled:false,rules:[]}],ruleGroups:[],protectionGroups:[]};
}
export function validateSettings(data) {
    if (!data || ![1,2,3,4].includes(data.version) || !Array.isArray(data.groups)) throw new Error('支持 version 1～4 的词库备份。');
    if (data.groups.length > 200) throw new Error('分类不能超过 200 个。');
    const base = baseSettings();
    base.theme=typeof data.theme==='string'&&Object.hasOwn(THEMES,data.theme)?data.theme:'st';
    base.wordPageSize=WORD_PAGE_SIZES.includes(data.wordPageSize)?data.wordPageSize:15;
    base.wordOrder=Object.hasOwn(WORD_ORDERS,data.wordOrder)?data.wordOrder:'default';
    for (const key of ['enabled','assistant','user','edited','display','prompt','contextual','protectCode','protectTitles']) {
        if (typeof data[key] === 'boolean') base[key] = data[key];
    }
    // 旧版的 edited=false 是默认值；新版采用可随时关闭的推荐配置。
    if(data.version===1)base.edited=true;
    base.contextOptions=validateContextOptions(data.contextOptions);
    base.sentenceRules=validateSentenceRules(data.sentenceRules).map(r=>({...r,id:uid()}));
    let count = 0;
    base.groups = data.groups.map(g => {
        if (!g || typeof g.name !== 'string' || !g.name.trim() || !Array.isArray(g.rules)) throw new Error('分类格式有误。');
        if(g.deleteScope!==undefined&&!['word','clause','sentence'].includes(g.deleteScope))throw new Error('未知的分类删除范围。');
        return {id: uid(), name: g.name.slice(0,100), enabled: g.enabled !== false,...(g.deleteScope?{deleteScope:g.deleteScope}:{}), rules: g.rules.map(r => {
            if (++count > 20000) throw new Error('词条不能超过 20000 条。');
            if (!r || typeof r.from !== 'string' || !r.from || typeof r.to !== 'string' || r.from.length > 2000 || r.to.length > 10000) throw new Error('词条必须包含非空原词 from 和替换词 to。');
            return {id: uid(), from: r.from, ...replacementData(r), enabled: r.enabled !== false};
        })};
    });
    base.exceptions = validateExceptions(data.exceptions);
    return upgradeStructure(base,data);
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 长词优先、一次替换。后面的分类覆盖前面分类中的同名词；替换结果不再次参与匹配。
export function compile(settings) {
    const contextual=settings.contextual?compileContext(settings.contextOptions):null;
    const conditions=compileConditions(settings);
    const contextGroups=compileContextGroups(settings);
    const rules = new Map(),wordSources=new Map();
    for (const group of settings.groups) if (group.enabled) for (const rule of group.rules) {
        if (!rule.enabled || !rule.from) continue;
        const sources=wordSources.get(rule.from)??[];sources.push({...rule,group:group.name,groupId:group.id});wordSources.set(rule.from,sources);
        rules.set(rule.from, {...rule, group:group.name,groupId:group.id,deleteScope:rule.to===''?group.deleteScope:undefined});
    }
    const categoryRules=[],categoryKeywords=new Map();
    for(const rule of rules.values())if(['clause','sentence'].includes(rule.deleteScope)){
        const keywords=categoryKeywords.get(rule.groupId)??[];keywords.push(rule.from);categoryKeywords.set(rule.groupId,keywords);
    }
    for(const group of settings.groups){
        const keywords=categoryKeywords.get(group.id)??[];
        if(keywords.length)categoryRules.push({id:group.id,name:group.name,keywords,matchMode:'any',scope:group.deleteScope,enabled:true,respectProtection:true});
    }
    const sentences=compileSentenceRules(settings.contextual?settings.sentenceRules:[],categoryRules);
    for(const [key,rule] of rules)if(['clause','sentence'].includes(rule.deleteScope))rules.delete(key);
    const keys = [...rules.keys()].sort((a,b) => b.length-a.length);
    const matcher = keys.length ? new RegExp(keys.map(escape).join('|'), 'gu') : null;
    const guard=protectionPattern(settings);
    const groupGuards=new Map(settings.groups.map(g=>[g.id,protectionPattern(settings,g.id)]));
    const contextGuard=settings.contextual?protectionPattern(settings,'context'):null;
    return {
        conflicts:inspectRules(settings).filter(x=>x.kind==='conflict').map(x=>x.from),
        run(input,{trace=false,explain=false}={}) {
            if (typeof input !== 'string' || !settings.enabled) return {text:input,hits:[]};
            const tracking=trace?new TextTrace(input):null,diagnostics=explain?new ExplanationTrace(input):null;
            const record=e=>diagnostics?.record(e);
            if(diagnostics){
                const seen=new Set();
                for(const pattern of [guard,...settings.groups.filter(g=>g.enabled).map(g=>groupGuards.get(g.id)),...settings.ruleGroups?.filter(g=>g.enabled).map(g=>protectionPattern(settings,g.id))??[]])for(const p of rangesFor(pattern,input)){
                    const key=JSON.stringify([p.start,p.end,p.ruleId,p.rule,p.groupId]);if(seen.has(key))continue;seen.add(key);
                    record({...p,kind:'protect',text:input.slice(p.start,p.end),reason:p.reason,passive:true});
                }
            }
            const hitMap = new Map();
            const hit = (from,to,group) => {
                const key = JSON.stringify([from,to,group]);
                const old = hitMap.get(key);
                if (old) old.count++; else hitMap.set(key,{from,to,group,count:1});
            };
            let normalInput,normalCache;
            const normalFor=text=>{if(text!==normalInput){normalInput=text;normalCache=contextGroups.normalRanges(text);}return normalCache;};
            const conditional=conditions(input,{explain,normalRanges:normalFor(input)}),preserved=conditional.preserved;
            for(const e of conditional.events??[])record(e);
            if(conditional.edits.length){tracking?.apply(conditional.edits);diagnostics?.apply(conditional.edits);input=conditional.text;for(const h of conditional.hits)hit(h.from,h.to,h.group);}
            let deletions=[];
            if(settings.contextual||categoryRules.length){
                const protectedRanges=guard?[...input.matchAll(new RegExp(guard.source,guard.flags))].map(m=>({start:m.index,end:m.index+m[0].length})):[];
                const result=sentences(input,protectedRanges);input=result.text;deletions=result.deletions;
                if(explain)for(const span of deletions)record({...span,kind:'delete',text:span.text,to:'',sourceType:'condition',group:'旧版句段规则',rule:span.keywords.join(' / '),reason:'命中句段删除'});
                diagnostics?.apply(deletions.map(span=>({...span,text:''})));
                tracking?.apply(deletions.map(span=>({...span,text:''})));
                for(const span of deletions)hit(span.text,'',`句段删除 · ${span.keywords.join(' / ')}`);
            }
            const process = str => {
                const replace=(text,pattern,fn)=>{
                    if(!tracking&&!diagnostics)return text.replace(pattern,fn);
                    const edits=[];
                    const output=text.replace(pattern,(...args)=>{
                        const value=fn(...args);
                        if(value!==args[0]){
                            const start=args[typeof args.at(-1)==='object'?args.length-3:args.length-2];
                            edits.push({start,end:start+args[0].length,text:value});
                        }
                        return value;
                    });
                    tracking?.apply(edits);diagnostics?.apply(edits);return output;
                };
                const replaceContext=(text,pattern,fn)=>{
                    const ranges=rangesFor(contextGuard,text);
                    return replace(text,pattern,(...args)=>{const offset=args[typeof args.at(-1)==='object'?args.length-3:args.length-2];
                        return ranges.some(r=>r.start<offset+args[0].length&&r.end>offset)?args[0]:fn(...args);});
                };
                if (settings.contextual) {
                    str = contextual.run(str,'before',(from,to,name)=>hit(from,to,`特殊句式 · ${name}`),null,replaceContext);
                }
                str=contextGroups(str,'before',replace,hit,preserved,explain,record);
                const scopedRanges=new Map([...groupGuards].map(([id,pattern])=>[id,rangesFor(pattern,str)]));
                const normalRanges=normalFor(str);
                if (matcher) str = replace(str,matcher, (word,offset) => {
                    const rule = rules.get(word);
                    const protectors=[...scopedRanges.get(rule.groupId)??[],...normalRanges.filter(p=>word.length>1&&p.text?.includes(word))].filter(r=>r.start<offset+word.length&&r.end>offset);
                    const event=explain?{start:offset,end:offset+word.length,text:word,rule:word,ruleId:rule.id,group:rule.group,groupId:rule.groupId,sourceType:'dictionary'}:null;
                    if(explain)for(const other of (wordSources.get(word)??[]).slice(0,-1))if(other.to!==rule.to)record({...event,ruleId:other.id,groupId:other.groupId,group:other.group,kind:'overridden',to:other.to,reason:'相同原词采用靠后的已启用分类',winner:{rule:word,ruleId:rule.id,group:rule.group,groupId:rule.groupId}});
                    if(protectors.length){
                        if(explain)record({...event,kind:'protect',reason:'保护优先，本次词语替换保留',protectors:protectors.map(p=>({...p,text:str.slice(p.start,p.end)}))});
                        if(explain&&preserved.length<100)preserved.push({text:word,reason:'命中保护词或代码块',group:rule.group,rule:word});return word;
                    }
                    if(explain)record({...event,kind:rule.to===''?'delete':'replace',to:rule.to,reason:'命中词库；长词优先，同名原词按后置分类处理'});
                    hit(word,rule.to,rule.group);
                    return rule.to;
                });
                if (settings.contextual) {
                    str = contextual.run(str,'after',(from,to,name)=>hit(from,to,`特殊句式 · ${name}`),null,replaceContext);
                }
                str=contextGroups(str,'after',replace,hit,preserved,explain,record);
                return str;
            };
            const text=process(input);
            const allDeletions=[...conditional.deletions,...deletions];
            return {text,hits:[...hitMap.values()],...(allDeletions.length?{deletions:allDeletions}:{}),...(tracking?{edits:tracking.edits(text)}:{}),...(explain?{preserved,events:diagnostics.events,eventsTruncated:diagnostics.truncated}:{})};
        },
    };
}

// 只检查同时启用的分类和词条；相同替换仅提示重复，不同替换才是冲突。
export function inspectRules(settings) {
    const byFrom=new Map();
    for(const group of settings.groups)for(const rule of group.rules){
        if(!group.enabled||!rule.enabled||!rule.from)continue;
        const rows=byFrom.get(rule.from)??[];
        rows.push({groupId:group.id,group:group.name,ruleId:rule.id,from:rule.from,to:rule.to,deleteScope:rule.to===''?(group.deleteScope??'word'):'word',active:group.enabled&&rule.enabled});
        byFrom.set(rule.from,rows);
    }
    return [...byFrom].filter(([,rows])=>rows.length>1).map(([from,rows])=>{
        const key=x=>JSON.stringify([x.to,x.deleteScope]);
        const conflict=new Set(rows.map(key)).size>1;
        return {from,rows,kind:conflict?'conflict':'duplicate',activeConflict:conflict,winner:rows.at(-1)};
    });
}

export function planPaste(target, incoming) {
    const additions=[],duplicates=[],conflicts=[];
    const staged=target.rules.map(r=>({...r}));
    for(const rule of incoming){
        if(!rule||typeof rule.from!=='string'||!rule.from||typeof rule.to!=='string')throw new Error('复制词条格式不正确。');
        const matches=staged.filter(r=>r.from===rule.from);
        replacementData(rule);
        if(matches.length&&matches.every(r=>sameReplacement(r,rule))){duplicates.push(rule);continue;}
        if(matches.length)conflicts.push({incoming:rule,existing:matches});
        else additions.push(rule);
        staged.push(rule);
    }
    return {additions,duplicates,conflicts};
}
export function pasteRules(target, incoming, policy='skip', capacity=20000) {
    if(!['skip','overwrite','disabled'].includes(policy))throw new Error('未知的冲突处理方式。');
    const plan=planPaste(target,incoming),draft=structuredClone(target.rules);
    for(const rule of incoming){
        const matches=draft.filter(r=>r.from===rule.from);
        if(matches.length&&matches.every(r=>sameReplacement(r,rule)))continue;
        if(matches.length){
            if(policy==='skip')continue;
            if(policy==='overwrite'){
                // 保留同名规则的开关，只统一替换值，避免旧规则悄悄覆盖新值。
                matches.forEach(r=>copyReplacement(r,rule));continue;
            }
            if(matches.some(r=>sameReplacement(r,rule)))continue;
        }
        draft.push({...structuredClone(rule),...replacementData(rule),id:uid(),enabled:matches.length?false:rule.enabled!==false});
    }
    if(draft.length-target.rules.length>capacity)throw new Error('粘贴后词条总数超过 20000 条。');
    target.rules=draft;
    return plan;
}

export function createTransfer(source, ids, mode='copy') {
    if(!['copy','cut'].includes(mode))throw new Error('未知的剪贴方式。');
    const rules=structuredClone(source.rules.filter(r=>ids.has(r.id)));
    if(!rules.length)throw new Error('请先勾选词条。');
    return {mode,sourceId:source.id,sourceName:source.name,rules};
}
export function pasteTransfer(settings,targetId,transfer,policy='skip') {
    const target=settings.groups.find(g=>g.id===targetId);
    if(!target||!transfer?.rules?.length)throw new Error('没有可粘贴的词条或目标分类已删除。');
    const source=settings.groups.find(g=>g.id===transfer.sourceId);
    const cutting=transfer.mode==='cut';
    if(cutting){
        if(!source)throw new Error('剪切来源分类已删除，请重新选择。');
        if(source===target)throw new Error('请切换到其他分类后粘贴；原词条尚未移除。');
        for(const item of transfer.rules){
            const current=source.rules.find(r=>r.id===item.id);
            if(!current||current.from!==item.from||!sameReplacement(current,item)||current.enabled!==item.enabled)throw new Error('待剪切词条已被修改或删除，请重新剪切；本次未移动任何词条。');
        }
    }
    const draft={...target,rules:target.rules.map(r=>({...r}))};
    pasteRules(draft,transfer.rules,policy,Infinity);
    // 只移除目标中确实存在相同文字和开关状态的条目。跳过冲突或降为停用的启用项仍留在源分类。
    const moved=cutting?transfer.rules.filter(r=>draft.rules.some(x=>x.from===r.from&&sameReplacement(x,r)&&x.enabled===r.enabled)):[];
    const movedIds=new Set(moved.map(r=>r.id));
    const total=settings.groups.reduce((n,g)=>n+g.rules.length,0)+draft.rules.length-target.rules.length-moved.length;
    if(total>20000)throw new Error('粘贴后词条总数超过 20000 条。');
    target.rules=draft.rules;
    if(cutting)source.rules=source.rules.filter(r=>!movedIds.has(r.id));
    return {moved:moved.length,remaining:cutting?transfer.rules.filter(r=>!movedIds.has(r.id)):transfer.rules};
}

export function parseBatch(text) {
    const rules = [];
    const errors = [];
    text.split(/\r?\n/).forEach((line,index) => {
        if (!line.trim() || line.trimStart().startsWith('#')) return;
        const sep = /\t|=>|->|→|=|＝/.exec(line);
        if (!sep) { errors.push(`第 ${index+1} 行缺少 = 分隔符`); return; }
        const from = line.slice(0,sep.index).trim();
        const to = line.slice(sep.index+sep[0].length).trim();
        if (!from) errors.push(`第 ${index+1} 行原词为空`);
        else rules.push({id:uid(),from,to,enabled:true});
    });
    if (errors.length) throw new Error(errors.slice(0,8).join('\n'));
    return rules;
}

