// 用途：跨分类检索词条与规则。
import {ruleSummary} from './model.js';
import {CONTEXT_MATCH_TEXT} from './legacy.js';
import {FILTER_FIELDS} from './filters.js';
import {CONTEXT_GUIDES} from './context-guide.js';

export function ruleSearchText(rule,group){
    return [rule.name,ruleSummary(rule,group),...(rule.keywords??[]),...(rule.cues??[]),rule.keyword,rule.prefix,rule.suffix,
        rule.start,rule.end,rule.startChars,rule.endChars,rule.to,
        rule.kind==='context'?CONTEXT_MATCH_TEXT[rule.template]:'',
        ...(rule.kind==='context'?Object.values(CONTEXT_GUIDES[rule.template]??{}).flat():[]),
        ...(rule.contextKeep?.before??[]),...(rule.contextKeep?.after??[]),
        ...Object.keys(FILTER_FIELDS).flatMap(key=>rule.filters?.[key]??[])];
}
export function searchEntries(settings,query){
    const needle=String(query).trim().toLocaleLowerCase();
    if(!needle)return [];
    const result=[];
    for(const [key,type,itemKey] of [['groups','词库','rules'],['ruleGroups','条件规则','rules'],['protectionGroups','保护词','terms']]){
        for(const group of settings[key]??[])for(const item of group[itemKey]){
            const values=[group.name,...(key==='groups'?[item.from,item.to]:key==='ruleGroups'?ruleSearchText(item,group):[item.text])];
            if(values.some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(needle)))
                result.push({key,type:key==='ruleGroups'&&item.kind==='context'?'保护词':type,group,item,enabled:!!(group.enabled&&item.enabled)});
        }
    }
    return result;
}
