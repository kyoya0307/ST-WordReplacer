// 用途：配置校验与迁移。
// Shared structure for categories, migration and scoped protection.
import { validateSentenceRules } from './sentences.js';
import {CONTEXT_RULES,contextKeep,validateContextKeep} from './legacy.js';
import {validateFilters,compatibleFilters} from './filters.js';
const id=()=>globalThis.crypto?.randomUUID?.()??`wr-${Date.now()}-${Math.random()}`;
export const ACTIONS={word:'删除匹配文字',clause:'删除所在分句',sentence:'删除完整句子',replace:'替换为指定文字',context:'沿用语境处理',trimPrefix:'去掉固定开头，保留后文',correction:'保留修正后的正文'};
export const KINDS={keywords:'关键词',pattern:'固定结构',markers:'起止标记',boundary:'自定义边界',context:'语境模板',correction:'自我纠错'};
export function groupState(g,key='rules'){
    const rows=g[key]??[],active=rows.filter(r=>r.enabled!==false).length;
    return {active,total:rows.length,checked:active>0&&active===rows.length,mixed:active>0&&active<rows.length,label:active===0?'已停用':active===rows.length?`已启用 · ${active}/${rows.length}`:`部分启用 · ${active}/${rows.length}`};
}
export function setGroupEnabled(g,enabled,key='rules'){g[key].forEach(r=>r.enabled=enabled);g.enabled=enabled;}
export function syncGroups(s){
    for(const g of [...s.groups,...s.ruleGroups??[]])g.enabled=g.rules.some(r=>r.enabled!==false);
    for(const g of s.protectionGroups??[])g.enabled=g.terms.some(r=>r.enabled!==false);
    s.exceptions=protectionTerms(s,'all');
}
export function protectionTerms(s,target='all'){
    if(!s.protectionGroups)return s.exceptions??[];
    return [...new Set(s.protectionGroups.filter(g=>g.enabled&&g.targets.some(t=>t==='all'||t===target)).flatMap(g=>g.terms.filter(r=>r.enabled).map(r=>r.text)))];
}
function text(value,label,limit=2000,empty=false){
    if(typeof value!=='string'||(!empty&&!value.trim())||value.length>limit)throw new Error(`${label}长度应为${empty?'0':'1'}～${limit} 字。`);
    return value;
}
export function validateRule(r,index=0){
    if(!r||!Object.hasOwn(KINDS,r.kind))throw new Error('请选择匹配条件。');
    if(!Object.hasOwn(ACTIONS,r.action))throw new Error('请选择处理范围。');
    const out={id:id(),name:text(r.name??'','规则名称',100,true),kind:r.kind,action:r.action,enabled:r.enabled!==false,respectProtection:r.respectProtection!==false,inheritAction:r.inheritAction===true};
    if(r.filters!==undefined)out.filters=validateFilters(r.filters);
    if(r.action==='trimPrefix'&&r.kind!=='pattern')throw new Error('去掉固定开头用于固定结构模板。');
    if(r.kind!=='context'&&r.action==='context')throw new Error('语境处理用于语境模板。');
    if(r.action==='correction'&&r.kind!=='correction')throw new Error('纠错清理用于自我纠错模板。');
    if(r.kind==='correction'){
        if(r.action!=='correction'||r.inheritAction)throw new Error('自我纠错模板采用固定的正文保留方式。');
        out.keywords=validateSentenceRules([{keywords:r.keywords,matchMode:'any',scope:'clause'}])[0].keywords;
        const cues=r.cues??['不对'];
        if(!Array.isArray(cues)||!cues.length||cues.length>50||cues.some(s=>typeof s!=='string'||!s.trim()||s.length>30||/[\r\n]/.test(s)))throw new Error('纠错提示词每行一项，最多 50 项，每项 1～30 字。');
        out.cues=[...new Set(cues)];
    }else if(r.kind==='context'){
        if(!CONTEXT_RULES.some(t=>t.id===r.template))throw new Error('请选择语境模板。');
        if(!['context','replace','word'].includes(r.action)||r.inheritAction)throw new Error('语境模板可沿用原处理、替换或删除匹配片段。');
        out.template=r.template;out.safeContext=r.safeContext!==false;out.respectProtection=true;
        if(r.contextKeep!==undefined)out.contextKeep=validateContextKeep(r.contextKeep);
    }else if(r.kind==='keywords'){
        const v=validateSentenceRules([{keywords:r.keywords,matchMode:r.matchMode??'any',scope:'clause'}])[0];
        Object.assign(out,{keywords:v.keywords,matchMode:v.matchMode});
        if(out.matchMode==='all'&&out.action==='replace')throw new Error('共同出现条件可选择删除文字、分句或整句。');
    }else if(r.kind==='pattern'){
        out.prefix=text(r.prefix,'开头',100);out.suffix=text(r.suffix,'结尾',100);
        if(!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<1||r.max>30||r.min>r.max)throw new Error('中间字数范围为 1～30，最少字数应小于或等于最多字数。');
        out.min=r.min;out.max=r.max;
    }else if(r.kind==='markers'){
        out.start=text(r.start,'开始标记',200);out.end=text(r.end,'结束标记',200);
    }else{
        const v=validateSentenceRules([{keyword:r.keyword,startChars:r.startChars,endChars:r.endChars}])[0];
        Object.assign(out,{keyword:v.keyword,startChars:v.startChars,endChars:v.endChars});
        if(!['clause','sentence'].includes(r.action))throw new Error('自定义边界沿用句段删除。');
    }
    if(out.action==='replace')out.to=text(r.to??'','替换文字',10000,true);
    return out;
}
const groupBase=(g,key)=>{
    if(!g||!Array.isArray(g[key]))throw new Error('分类内容格式有误。');
    return {id:id(),name:text(g.name,'分类名称',100),enabled:g.enabled!==false};
};
export function upgradeStructure(base,data){
    const targets=new Map((data.groups??[]).map((g,i)=>[g.id,base.groups[i].id]));
    const modern=data.version===4;
    let count=0;
    base.ruleGroups=[];base.protectionGroups=[];
    if(modern){
        if(!Array.isArray(data.ruleGroups)||data.ruleGroups.length>200||!Array.isArray(data.protectionGroups)||data.protectionGroups.length>200)throw new Error('规则和保护词分类各支持 200 个。');
        base.ruleGroups=data.ruleGroups.map(g=>{
            const v=groupBase(g,'rules');targets.set(g.id,v.id);
            if(!['word','clause','sentence'].includes(g.defaultAction??'clause'))throw new Error('分类默认删除范围有误。');
            return {...v,defaultAction:g.defaultAction??'clause',concealed:false,rules:g.rules.map((r,i)=>{if(++count>20000)throw new Error('条件规则最多 20000 条。');return validateRule(r,i);})};
        });
        let terms=0;
        base.protectionGroups=data.protectionGroups.map(g=>{
            const v=groupBase(g,'terms');
            if(!Array.isArray(g.targets)||!g.targets.length||g.targets.some(t=>typeof t!=='string'))throw new Error('请选择保护范围。');
            return {...v,targets:[...new Set(g.targets.map(t=>t==='all'||t==='context'?t:targets.get(t)).filter(Boolean))],terms:g.terms.map(r=>{if(++terms>5000)throw new Error('保护词最多 5000 条。');return {id:id(),text:text(r.text,'保护词'),enabled:r.enabled!==false};})};
        });
        for(const g of base.protectionGroups)if(!g.targets.length)throw new Error('保护词指向的分类已缺失，请补充目标分类。');
    }else{
        const winners=new Map();
        for(const g of base.groups)if(g.enabled)for(const r of g.rules)if(r.enabled)winners.set(r.from,r);
        const retiredEmpty=new Set();
        for(const g of base.groups){
            if(!g.enabled)g.rules.forEach(r=>r.enabled=false);
            if(['clause','sentence'].includes(g.deleteScope)){
                const moved=g.rules.filter(r=>r.to==='');
                if(moved.length)base.ruleGroups.push({id:id(),name:g.name,enabled:g.enabled,defaultAction:g.deleteScope,concealed:false,rules:moved.map((r,i)=>({id:id(),name:`触发规则 ${i+1}`,kind:'keywords',keywords:[r.from],matchMode:'any',action:g.deleteScope,inheritAction:true,enabled:r.enabled&&winners.get(r.from)===r,respectProtection:true}))});
                g.rules=g.rules.filter(r=>r.to!=='');
                if(!g.rules.length)retiredEmpty.add(g.id);
            }
            delete g.deleteScope;
        }
        base.groups=base.groups.filter(g=>!retiredEmpty.has(g.id));
        if(base.sentenceRules.length){
            base.ruleGroups.push({id:id(),name:'句子清理',enabled:base.contextual,defaultAction:'clause',concealed:false,rules:base.sentenceRules.map((r,i)=>r.keywords?
                {id:id(),name:r.name||`清理规则 ${i+1}`,kind:'keywords',keywords:r.keywords,matchMode:r.matchMode,action:r.scope,enabled:base.contextual&&r.enabled,respectProtection:r.respectProtection,inheritAction:false}:
                {id:id(),name:`边界规则 ${i+1}`,kind:'boundary',keyword:r.keyword,startChars:r.startChars,endChars:r.endChars,action:'clause',enabled:base.contextual&&r.enabled,respectProtection:true,inheritAction:false})});
        }
        if(base.exceptions.length)base.protectionGroups.push({id:id(),name:'全局保护',enabled:true,targets:['all'],terms:base.exceptions.map(t=>({id:id(),text:t,enabled:true}))});
    }
    if(base.contextual&&!base.ruleGroups.some(g=>g.rules.some(r=>r.kind==='context'))){
        base.ruleGroups.push(contextGroup(base.contextOptions));
    }
    for(const g of base.ruleGroups)for(const r of g.rules)if(r.kind==='context')r.contextKeep??=contextKeep(base.contextOptions);
    base.contextual=false;
    // A v4 backup stores aggregate category state; inactive categories remain inactive on import.
    if(modern){
        for(const g of base.groups)if(!g.enabled)g.rules.forEach(r=>r.enabled=false);
        for(const g of base.ruleGroups)if(!g.enabled)g.rules.forEach(r=>r.enabled=false);
        for(const g of base.protectionGroups)if(!g.enabled)g.terms.forEach(r=>r.enabled=false);
    }
    base.sentenceRules=[];base.version=4;syncGroups(base);return base;
}
export function ruleSummary(r,g){
    const action=r.inheritAction?g.defaultAction:r.action;
    const condition=r.kind==='context'?CONTEXT_RULES.find(t=>t.id===r.template)?.name:r.kind==='correction'?'关键词后出现破折号与纠错提示词':r.kind==='keywords'?(r.matchMode==='all'?`${r.filters?.scope==='clause'?'同分句':'同一句'}包含全部关键词`:'出现任意关键词'):r.kind==='pattern'?`${r.prefix}＋${r.min===r.max?r.min:`${r.min}～${r.max}`} 个汉字＋${r.suffix}`:r.kind==='markers'?`${r.start} … ${r.end}`:'按指定起止标点匹配';
    const count=r.filters?Object.values(r.filters).filter(v=>Array.isArray(v)&&v.length).length+(r.filters.boundary!=='any'?1:0)+(r.filters.maxClauses?1:0)+(r.filters.ordered?1:0):0;
    return `${condition} → ${ACTIONS[action]}${count?` · ${count} 项补充条件`:''}`;
}
export function contextGroup(options){
    return {id:id(),name:'语境规则',enabled:true,defaultAction:'word',concealed:false,rules:CONTEXT_RULES.map(t=>{
        const config=options.rules[t.id];return {id:id(),name:t.name,kind:'context',template:t.id,action:config.replacement===null?'context':'replace',...(config.replacement===null?{}:{to:config.replacement}),enabled:config.enabled,respectProtection:true,safeContext:true,contextKeep:contextKeep(options),inheritAction:false};
    })};
}
export function literalConflicts(s){
    const byWord=new Map(),add=(from,row)=>{const rows=byWord.get(from)??[];rows.push(row);byWord.set(from,rows);};
    for(const g of s.groups.filter(g=>g.enabled))for(const r of g.rules.filter(r=>r.enabled))add(r.from,{type:'words',groupId:g.id,ruleId:r.id,group:g.name,action:r.to===''?'word':'replace',to:r.to});
    for(const g of (s.ruleGroups??[]).filter(g=>g.enabled))for(const r of g.rules.filter(r=>r.enabled&&r.kind==='keywords'&&r.matchMode==='any'))for(const from of r.keywords){
        const action=r.inheritAction?g.defaultAction:r.action;add(from,{type:'conditions',groupId:g.id,ruleId:r.id,group:g.name,action,to:action==='replace'?r.to:'',filters:r.filters});
    }
    return [...byWord].flatMap(([from,rows])=>{
        const involved=new Set();for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
            const a=rows[i],b=rows[j];if(JSON.stringify([a.action,a.to])!==JSON.stringify([b.action,b.to])&&compatibleFilters(a.filters,b.filters)){involved.add(a);involved.add(b);}
        }return involved.size?[{from,rows:rows.filter(r=>involved.has(r))}]:[];
    });
}
