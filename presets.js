import {CONTEXT_RULES} from './legacy.js';

export const TRIGGER_PRESETS={
    keywords:{title:'关键词删句',kind:'keywords',action:'clause',matchMode:'any',description:'任意一个词或完整短语出现时，删除所在分句。',example:'【待删】 → 删除包含它的逗号分句'},
    together:{title:'共同出现删句',kind:'keywords',action:'clause',matchMode:'all',description:'同一句包含全部关键词时，删除它们所在的连续分句。',example:'声音 ＋ 平 → 同句共同出现时处理'},
    pattern:{title:'固定结构清理',kind:'pattern',action:'word',description:'按固定开头、中间字数和固定结尾匹配，删除匹配文字。',example:'极 ＋ 1 个汉字 ＋ 的 → 极轻的、极重的'},
    markers:{title:'标记内容清理',kind:'markers',action:'word',description:'删除一对起止标记及其包裹的内容，支持跨行。',example:'[示例开始] … [示例结束] → 删除这一段'},
    context:{title:'保护语境规则',kind:'context',action:'context',description:'使用既有语境模板识别特定表达，并按保留条件保护正常叙述。',example:'查看每个模板的触发内容、保留条件和试用效果'},
    sentence:{title:'完整句子删除',kind:'keywords',action:'sentence',matchMode:'any',extra:true,description:'任意一个词或短语出现时，删除从句首到句末的完整句子。',example:'【待删】 → 删除包含它的完整句子'},
    text:{title:'匹配词段删除',kind:'keywords',action:'word',matchMode:'any',extra:true,description:'任意一个词或短语出现时，直接删除该匹配文字。',example:'正文【待删】继续 → 正文继续'},
    custom:{title:'其他已有规则',extra:true,description:'集中查看已有的自定义边界、指定替换和其他特殊处理。',example:'沿用已有触发条件与处理方式'},
};
export const effectiveAction=(rule,group)=>rule.inheritAction?group.defaultAction:rule.action;
export function triggerPreset(rule,group){
    const action=effectiveAction(rule,group);
    if(rule.kind==='context')return 'context';
    if(rule.kind==='keywords'){
        if(rule.matchMode==='all')return action==='clause'?'together':'custom';
        return {clause:'keywords',sentence:'sentence',word:'text'}[action]??'custom';
    }
    if(rule.kind==='pattern'&&action==='word')return 'pattern';
    if(rule.kind==='markers'&&action==='word')return 'markers';
    return 'custom';
}
export function triggerTitle(rule){
    if(rule.name&&!/^(?:规则|触发规则|清理规则|边界规则)\s*\d+$/.test(rule.name))return rule.name;
    if(rule.kind==='keywords')return rule.keywords.join(rule.matchMode==='all'?' ＋ ':' / ');
    if(rule.kind==='pattern')return `${rule.prefix} ＋ ${rule.min===rule.max?rule.min:`${rule.min}～${rule.max}`} 个汉字 ＋ ${rule.suffix}`;
    if(rule.kind==='markers')return `${rule.start} … ${rule.end}`;
    if(rule.kind==='context')return CONTEXT_RULES.find(item=>item.id===rule.template)?.name??'语境模板';
    return rule.keyword||'已有触发内容';
}
export function presetEntries(settings,presetId){
    return settings.ruleGroups.flatMap(group=>group.rules.filter(rule=>triggerPreset(rule,group)===presetId).map(rule=>({group,rule})));
}
export function presetDraft(presetId){
    const preset=TRIGGER_PRESETS[presetId];
    if(!preset?.kind)throw new Error('请选择一个触发模板。');
    return {name:'',enabled:true,respectProtection:true,inheritAction:false,kind:preset.kind,action:preset.action,
        ...(preset.kind==='keywords'?{keywords:presetId==='together'?['声音','平']:['【待删】'],matchMode:preset.matchMode}:{}),
        ...(preset.kind==='pattern'?{prefix:'极',suffix:'的',min:1,max:1}:{}),
        ...(preset.kind==='markers'?{start:'[示例开始]',end:'[示例结束]'}:{}),
        ...(preset.kind==='context'?{template:'kinship',safeContext:true}:{}),
    };
}
