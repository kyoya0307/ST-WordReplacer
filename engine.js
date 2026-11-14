import { DEFAULT_GROUPS } from './defaults.js';
import { legacyBefore, legacyAfter } from './legacy.js';

export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function createSettings() {
    return { version: 1, enabled: true, assistant: true, user: false, edited: false,
        contextual: true, protectCode: true, exceptions: [], groups: structuredClone(DEFAULT_GROUPS) };
}
export function validateSettings(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.groups)) throw new Error('不是支持的词库备份（version: 1）。');
    if (data.groups.length > 200) throw new Error('分类不能超过 200 个。');
    const base = createSettings();
    for (const key of ['enabled','assistant','user','edited','contextual','protectCode']) {
        if (typeof data[key] === 'boolean') base[key] = data[key];
    }
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
    const conflicts = [];
    for (const group of settings.groups) if (group.enabled) for (const rule of group.rules) {
        if (!rule.enabled || !rule.from) continue;
        if (rules.has(rule.from)) conflicts.push(rule.from);
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
        conflicts:[...new Set(conflicts)],
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
