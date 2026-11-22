// 用途：词条排序与分页。
export const WORD_PAGE_SIZES=Object.freeze([10,15]);
export const WORD_ORDERS=Object.freeze({default:'默认顺序',pinyin:'原词拼音顺序'});
const pinyin=new Intl.Collator('zh-CN-u-co-pinyin',{numeric:true,sensitivity:'base'});
export function orderedWordRules(rules,order='default'){
    if(order!=='pinyin')return [...rules];
    return rules.map((rule,index)=>({rule,index})).sort((a,b)=>pinyin.compare(a.rule.from,b.rule.from)||a.index-b.index).map(row=>row.rule);
}
export const wordPageSize=settings=>WORD_PAGE_SIZES.includes(settings.wordPageSize)?settings.wordPageSize:15;
export function wordRulePage(group,rule,settings){return Math.max(0,Math.floor(orderedWordRules(group.rules,settings.wordOrder).indexOf(rule)/wordPageSize(settings)));}
