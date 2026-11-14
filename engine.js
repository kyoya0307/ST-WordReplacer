import { DEFAULT_GROUPS } from './defaults.js';
import { legacyBefore, legacyAfter } from './legacy.js';

export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function createSettings() {
    return { version: 2, enabled: true, assistant: true, user: false, edited: true, display: true, prompt: true,
        contextual: true, protectCode: true, exceptions: [], groups: structuredClone(DEFAULT_GROUPS) };
}
export function validateSettings(data) {
    if (!data || ![1,2].includes(data.version) || !Array.isArray(data.groups)) throw new Error('不是支持的词库备份（version: 1 或 2）。');
    if (data.groups.length > 200) throw new Error('分类不能超过 200 个。');
    const base = createSettings();
    for (const key of ['enabled','assistant','user','edited','display','prompt','contextual','protectCode']) {
        if (typeof data[key] === 'boolean') base[key] = data[key];
    }
    // 旧版的 edited=false 是默认值；新版采用可随时关闭的推荐配置。
    if(data.version===1)base.edited=true;
    let count = 0;
    base.groups = data.groups.map(g => {
        if (!g || typeof g.name !== 'string' || !g.name.trim() || !Array.isArray(g.rules)) throw new Error('分类格式有误。');
        return {id: uid(), name: g.name.slice(0,100), enabled: g.enabled !== false, rules: g.rules.map(r => {
            if (++count > 20000) throw new Error('词条不能超过 20000 条。');
            if (!r || typeof r.from !== 'string' || !r.from || typeof r.to !== 'string' || r.from.length > 2000 || r.to.length > 10000) throw new Error('词条必须包含非空原词 from 和替换词 to。');
            return {id: uid(), from: r.from, to: r.to, enabled: r.enabled !== false};
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
            const segment = str => {
                if (settings.contextual) {
                    const before = legacyBefore(str);
                    if (before !== str) hit('特殊组合', '上下文处理', '特殊句式规则');
                    str = before;
                }
                if (matcher) str = str.replace(matcher, word => {
                    const rule = rules.get(word);
                    hit(word,rule.to,rule.group);
                    return rule.to;
                });
                if (settings.contextual) {
                    const after = legacyAfter(str);
                    if (after !== str) hit('特殊句式', '上下文处理', '特殊句式规则');
                    str = after;
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
            return {text,hits:[...hitMap.values()]};
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
        if(matches.length&&matches.every(r=>r.to===rule.to)){duplicates.push(rule);continue;}
        if(matches.length)conflicts.push({incoming:rule,existing:matches});
        else additions.push(rule);
        staged.push(rule);
    }
    return {additions,duplicates,conflicts};
}
export function pasteRules(target, incoming, policy='skip', capacity=20000) {
    if(!['skip','overwrite','disabled'].includes(policy))throw new Error('未知的冲突处理方式。');
    const plan=planPaste(target,incoming),draft=target.rules.map(r=>({...r}));
    for(const rule of incoming){
        const matches=draft.filter(r=>r.from===rule.from);
        if(matches.length&&matches.every(r=>r.to===rule.to))continue;
        if(matches.length){
            if(policy==='skip')continue;
            if(policy==='overwrite'){
                // 保留同名规则的开关，只统一替换值，避免旧规则悄悄覆盖新值。
                matches.forEach(r=>{r.to=rule.to;});continue;
            }
            if(matches.some(r=>r.to===rule.to))continue;
        }
        draft.push({...rule,id:uid(),enabled:matches.length?false:rule.enabled!==false});
    }
    if(draft.length-target.rules.length>capacity)throw new Error('粘贴后词条总数超过 20000 条。');
    target.rules=draft;
    return plan;
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
