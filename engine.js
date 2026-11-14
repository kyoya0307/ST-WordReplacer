import { DEFAULT_GROUPS } from './defaults.js';
import { createContextOptions, validateContextOptions, compileContext } from './legacy.js';
import { compileSentenceRules, validateSentenceRules } from './sentences.js';

export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const THEMES = Object.freeze({st:'跟随 ST',pink:'粉色',green:'绿色',beige:'米色',black:'黑色',white:'白色'});
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
export function createSettings() {
    return { version: 2, theme:'st', enabled: true, assistant: true, user: false, edited: true, display: true, prompt: true,
        contextual: true, contextOptions:createContextOptions(), sentenceRules:[], protectCode: true, exceptions: [], groups: structuredClone(DEFAULT_GROUPS) };
}
export function validateSettings(data) {
    if (!data || ![1,2].includes(data.version) || !Array.isArray(data.groups)) throw new Error('不是支持的词库备份（version: 1 或 2）。');
    if (data.groups.length > 200) throw new Error('分类不能超过 200 个。');
    const base = createSettings();
    base.theme=typeof data.theme==='string'&&Object.hasOwn(THEMES,data.theme)?data.theme:'st';
    for (const key of ['enabled','assistant','user','edited','display','prompt','contextual','protectCode']) {
        if (typeof data[key] === 'boolean') base[key] = data[key];
    }
    // 旧版的 edited=false 是默认值；新版采用可随时关闭的推荐配置。
    if(data.version===1)base.edited=true;
    base.contextOptions=validateContextOptions(data.contextOptions);
    base.sentenceRules=validateSentenceRules(data.sentenceRules).map(r=>({...r,id:uid()}));
    let count = 0;
    base.groups = data.groups.map(g => {
        if (!g || typeof g.name !== 'string' || !g.name.trim() || !Array.isArray(g.rules)) throw new Error('分类格式有误。');
        return {id: uid(), name: g.name.slice(0,100), enabled: g.enabled !== false, rules: g.rules.map(r => {
            if (++count > 20000) throw new Error('词条不能超过 20000 条。');
            if (!r || typeof r.from !== 'string' || !r.from || typeof r.to !== 'string' || r.from.length > 2000 || r.to.length > 10000) throw new Error('词条必须包含非空原词 from 和替换词 to。');
            return {id: uid(), from: r.from, ...replacementData(r), enabled: r.enabled !== false};
        })};
    });
    if (data.exceptions !== undefined && (!Array.isArray(data.exceptions) || data.exceptions.some(s => typeof s !== 'string'))) throw new Error('保护词应为文字数组。');
    base.exceptions = [...new Set((data.exceptions ?? []).filter(Boolean))];
    if (base.exceptions.length > 5000 || base.exceptions.some(s => s.length > 2000)) throw new Error('保护词过多或过长。');
    return base;
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 长词优先、一次替换。后面的分类覆盖前面分类中的同名词；替换结果不再次参与匹配。
export function compile(settings) {
    const contextual=compileContext(settings.contextOptions);
    const sentences=compileSentenceRules(settings.sentenceRules);
    const rules = new Map();
    for (const group of settings.groups) if (group.enabled) for (const rule of group.rules) {
        if (!rule.enabled || !rule.from) continue;
        rules.set(rule.from, {...rule, group:group.name});
    }
    const keys = [...rules.keys()].sort((a,b) => b.length-a.length);
    const matcher = keys.length ? new RegExp(keys.map(escape).join('|'), 'gu') : null;
    const guards = [...new Set(settings.exceptions.filter(Boolean))].sort((a,b)=>b.length-a.length);
    const guardParts = [];
    if (settings.protectCode) guardParts.push('```[\\s\\S]*?(?:```|$)', '~~~[\\s\\S]*?(?:~~~|$)', '`[^`\\n]+`');
    guardParts.push(...guards.map(escape));
    const guard = guardParts.length ? new RegExp(guardParts.join('|'), 'gu') : null;
    return {
        conflicts:inspectRules(settings).filter(x=>x.kind==='conflict').map(x=>x.from),
        run(input) {
            if (typeof input !== 'string' || !settings.enabled) return {text:input,hits:[]};
            const hitMap = new Map();
            const hit = (from,to,group) => {
                const key = JSON.stringify([from,to,group]);
                const old = hitMap.get(key);
                if (old) old.count++; else hitMap.set(key,{from,to,group,count:1});
            };
            let deletions=[];
            if(settings.contextual){
                const protectedRanges=guard?[...input.matchAll(new RegExp(guard.source,guard.flags))].map(m=>({start:m.index,end:m.index+m[0].length})):[];
                const result=sentences(input,protectedRanges);input=result.text;deletions=result.deletions;
                for(const span of deletions)hit(span.text,'',`句段删除 · ${span.keywords.join(' / ')}`);
            }
            const segment = str => {
                if (settings.contextual) {
                    str = contextual.run(str,'before',(from,to,name)=>hit(from,to,`特殊句式 · ${name}`));
                }
                if (matcher) str = str.replace(matcher, word => {
                    const rule = rules.get(word);
                    hit(word,rule.to,rule.group);
                    return rule.to;
                });
                if (settings.contextual) {
                    str = contextual.run(str,'after',(from,to,name)=>hit(from,to,`特殊句式 · ${name}`));
                }
                return str;
            };
            let text = '', pos = 0;
            if (guard) {
                guard.lastIndex = 0;
                for (const match of input.matchAll(guard)) {
                    text += segment(input.slice(pos,match.index)) + match[0];
                    pos = match.index+match[0].length;
                }
            }
            text += segment(input.slice(pos));
            return {text,hits:[...hitMap.values()],...(deletions.length?{deletions}:{})};
        },
    };
}

// 相同原词和替换值是重复提示；相同原词但替换不同才是冲突。
export function inspectRules(settings) {
    const byFrom=new Map();
    for(const group of settings.groups)for(const rule of group.rules){
        if(!rule.from)continue;
        const rows=byFrom.get(rule.from)??[];
        rows.push({groupId:group.id,group:group.name,ruleId:rule.id,from:rule.from,to:rule.to,active:group.enabled&&rule.enabled});
        byFrom.set(rule.from,rows);
    }
    return [...byFrom].filter(([,rows])=>rows.length>1).map(([from,rows])=>{
        const active=rows.filter(x=>x.active);
        return {from,rows,kind:new Set(rows.map(x=>x.to)).size>1?'conflict':'duplicate',
            activeConflict:new Set(active.map(x=>x.to)).size>1,winner:active.at(-1)??null};
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
        const sep = /\t|=>|→/.exec(line);
        if (!sep) { errors.push(`第 ${index+1} 行缺少 →、=> 或制表符`); return; }
        const from = line.slice(0,sep.index).trim();
        const to = line.slice(sep.index+sep[0].length).trim();
        if (!from) errors.push(`第 ${index+1} 行原词为空`);
        else rules.push({id:uid(),from,to,enabled:true});
    });
    if (errors.length) throw new Error(errors.slice(0,8).join('\n'));
    return rules;
}

// 只修改当前选中的 swipe，保留其他候选文本。
export function replaceMessage(message, runner) {
    if (!message || message.is_system || typeof message.mes !== 'string') return null;
    const original = message.mes;
    const {text} = runner.run(original);
    if (text === original) return null;
    const swipeId = message.swipe_id;
    const hasSwipe = Array.isArray(message.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < message.swipes.length;
    const snapshot = {message,original,replacement:text,swipeId,originalSwipe:hasSwipe ? message.swipes[swipeId] : undefined};
    message.mes = text;
    if (hasSwipe) message.swipes[swipeId] = text;
    return snapshot;
}
