import { uid, THEMES, compile, inspectRules, parseBatch, setReplacement, createTransfer, pasteTransfer, planPaste, validateSettings } from './engine.js';
import { groupState, syncGroups, ACTIONS, KINDS, validateRule, ruleSummary, literalConflicts,contextGroup } from './model.js';
import { CONTEXT_RULES, CONTEXT_REVIEWS, CONTEXT_SAFETY,contextKeep,validateContextKeep } from './legacy.js';
import {FILTER_FIELDS,FILTER_EXAMPLES,BOUNDARIES,validateFilters} from './filters.js';
import {searchEntries} from './search.js';
import {TRIGGER_PRESETS,triggerPreset,triggerTitle,presetEntries,presetDraft,effectiveAction} from './presets.js';
import {WORD_ORDERS,orderedWordRules,wordPageSize,wordRulePage} from './words-view.js';
import {CONTEXT_GUIDES} from './context-guide.js';
import {createHitInspector} from './hit-inspector.js';

const node=(tag,attrs={},...children)=>{
    const e=document.createElement(tag);
    for(const [k,v]of Object.entries(attrs))if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(k==='class')e.className=v;else if(k in e)e[k]=v;else e.setAttribute(k,v);
    e.append(...children.filter(c=>c!==null&&c!==undefined));return e;
};
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
export function download(name,data){
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
    const link=node('a',{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export class Manager{
    constructor(app){
        this.app=app;this.tab='词库';this.view='';this.selected={};this.search='';this.selection=new Set();this.clipboard=null;this.selecting=false;this.page=0;this.draft=null;this.wordDrafts=new Map();this.protectionMode='terms';this.conditionMode='presets';this.conditionPreset='keywords';this.morePresets=false;
        this.dialog=node('dialog',{id:'wr-manager',class:'wr-dialog','aria-label':'词汇快捷替换'});this.pane=node('div',{class:'wr-shell'});this.dialog.append(this.pane);document.body.append(this.dialog);
        this.dialog.addEventListener('click',e=>{if(e.target===this.dialog)this.dialog.close();});
        this.dialog.addEventListener('cancel',e=>{if(this.draft){e.preventDefault();this.draft=null;this.render();}});
    }
    get s(){return this.app.settings;}
    safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){this.notice(e.message,true);this.app.report(e);}};}
    btn(text,fn,attrs={}){return node('button',{type:'button',class:'wr-button menu_button',onclick:this.safe(fn),...attrs},text);}
    field(value,label,fn,attrs={}){return node('input',{type:'text',class:'text_pole',value,placeholder:label,'aria-label':label,oninput:this.safe(e=>fn?.(e.target.value)),...attrs});}
    area(value,label,fn,rows=5){return node('textarea',{class:'text_pole',value,rows,placeholder:label,'aria-label':label,oninput:this.safe(e=>fn?.(e.target.value))});}
    check(label,value,fn){return node('label',{class:'wr-check'},node('input',{type:'checkbox',checked:value,onchange:this.safe(e=>fn(e.target.checked))}),label);}
    select(value,label,options,fn){return node('select',{class:'text_pole','aria-label':label,onchange:this.safe(e=>fn(e.target.value))},...Object.entries(options).map(([v,t])=>node('option',{value:v,selected:value===v},t)));}
    label(title,control,help=''){return node('label',{class:'wr-field'},node('span',{},title),control,help?node('small',{},help):null);}
    row(...children){return node('div',{class:'wr-row'},...children);}
    notice(text,error=false){if(this.status){this.status.textContent=error?text:'';this.status.hidden=!error;}}
    save(text='已保存'){
        syncGroups(this.s);this.app.save();this.notice(text);this.updateStates?.();this.updateTest?.();
    }
    open(prefill=''){
        this.tab='词库';this.view='';this.selecting=false;this.selection.clear();this.draft=null;this.search='';
        this.render();if(!this.dialog.open)this.dialog.showModal();this.dialog.scrollTop=0;
        if(prefill){const g=this.current();if(g)this.editWord(g,null,prefill);}
    }
    render(){
        this.updateStates=null;this.updateTest=null;this.dialog.dataset.theme=this.s.theme;this.pane.replaceChildren();
        const colors=Object.keys(THEMES),theme=this.btn('☼',()=>{
            this.s.theme=colors[(colors.indexOf(this.s.theme)+1)%colors.length];this.dialog.dataset.theme=this.s.theme;this.app.save();describe();
        },{class:'wr-button menu_button wr-theme-picker'});
        const describe=()=>{theme.title=`配色：${THEMES[this.s.theme]} · 点击切换`;theme.setAttribute('aria-label',theme.title);};describe();
        this.pane.append(node('header',{class:'wr-top'},node('div',{class:'wr-title'},node('strong',{},'词汇快捷替换'),this.check('启用处理',this.s.enabled,v=>{this.s.enabled=v;this.save();if(this.search.trim())this.renderSearch();})),
            node('div',{class:'wr-top-actions'},theme,this.btn('×',()=>this.dialog.close(),{class:'wr-button menu_button wr-close','aria-label':'关闭管理窗口',title:'关闭'}))));
        this.pane.append(node('nav',{class:'wr-tabs','aria-label':'管理页面'},...['词库','条件规则','保护词','冲突检查','设置'].map(name=>this.btn(name,()=>{
            this.tab=name;if(name==='条件规则'){this.conditionMode='presets';if(this.conditionPreset==='context')this.conditionPreset='keywords';}this.view='';this.search='';this.selecting=false;this.selection.clear();this.draft=null;this.page=0;this.render();this.dialog.scrollTop=0;
        },{'aria-current':this.tab===name?'page':'false',class:`menu_button wr-button ${this.tab===name?'wr-active':''}`}))))
        this.renderSearchBar();
        this.status=node('div',{class:'wr-status wr-error',role:'alert','aria-live':'assertive',hidden:true});
        this.body=node('main',{class:'wr-body'});this.pane.append(this.body,this.status);
        if(this.search.trim()){this.renderSearch();return;}
        if(this.tab==='保护词')this.renderProtectionTabs();
        if(this.view){this.body.append(this.row(this.btn('‹ 返回'+this.tab,()=>{this.view='';this.render();}),node('h3',{},this.view)));if(this.view==='测试效果')this.renderTest(this.body);if(this.view==='导入与导出')this.renderBackup(this.body);return;}
        if(this.tab==='设置'){this.renderSettings();return;}
        if(this.tab==='冲突检查'){this.body.append(node('h3',{},'冲突检查'));this.renderAudit(this.body);return;}
        if((this.tab==='条件规则'&&this.conditionMode==='presets')||(this.tab==='保护词'&&this.protectionMode==='rules')){this.renderTriggerPresets();return;}
        const groups=this.visibleGroups();
        this.body.append(node('div',{class:'wr-section-head'},node('div',{},node('h3',{},this.tab),node('small',{},`${groups.length} 个分类 · ${groups.reduce((n,g)=>n+this.items(g).length,0)} 条`)),
            this.row(...(this.tab==='条件规则'?[this.btn('返回触发模板',()=>{this.conditionMode='presets';this.draft=null;this.render();})]:[]),this.btn('测试效果',()=>this.showView('测试效果')))));
        this.categoryLayout();
    }
    renderProtectionTabs(){
        const tabs=node('nav',{class:'wr-protection-tabs','aria-label':'保护内容类型'});
        for(const [mode,title]of [['terms','保护词'],['rules','内置保护规则']])tabs.append(this.btn(title,()=>{
            this.protectionMode=mode;this.view='';this.search='';this.page=0;this.draft=null;this.selection.clear();this.selecting=false;this.render();this.dialog.scrollTop=0;
        },{'aria-pressed':String(this.protectionMode===mode),class:`wr-button menu_button ${this.protectionMode===mode?'wr-active':''}`}));
        const defaults=node('details',{class:'wr-advanced wr-protection-defaults'},node('summary',{},'通用保护'),
            this.row(this.check('保护《书名》',this.s.protectTitles,v=>{this.s.protectTitles=v;this.save();}),this.check('保护代码块',this.s.protectCode,v=>{this.s.protectCode=v;this.save();})),
            node('small',{},'按成对书名号与代码标记识别范围。特定词语的正常用法在内置保护规则中处理。'));
        this.body.append(tabs,defaults);
    }
    showView(view){this.view=view;this.render();this.dialog.scrollTop=0;}
    renderSearchBar(){
        const input=this.field(this.search,'全局搜索：原词、替换词、规则、保护词',value=>{
            this.search=value;this.page=0;this.selection.clear();this.selecting=false;
            clear.hidden=!value;
            if(value.trim()){this.updateStates=null;this.updateTest=null;this.renderSearch();}
            else this.clearSearch();
        },{type:'search','aria-controls':'wr-global-results',autocomplete:'off'});
        const clear=this.btn('清空',()=>this.clearSearch(),{hidden:!this.search,'aria-label':'清空全局搜索'});
        this.pane.append(node('section',{class:'wr-global-search','aria-label':'全局搜索'},input,clear));
    }
    clearSearch(){
        this.search='';this.page=0;this.render();this.pane.querySelector('.wr-global-search input')?.focus();
    }
    locateResult({type,group,item}){
        this.tab=type;this.view='';this.search='';this.page=0;this.selected[type]=group.id;this.draft=null;this.selection.clear();this.selecting=false;
        if(item.kind){this.conditionMode='presets';this.startRule(group,item.kind,item);return;}
        if(type==='保护词')this.protectionMode='terms';
        if(type==='词库'){this.page=wordRulePage(group,item,this.s);this.render();this.editWord(group,item);return;}
        this.render();
        this.inlinePrompt('编辑保护词','保护词',item.text,value=>{item.text=value;this.save();this.render();},2000);
        this.dialog.scrollTop=0;
    }
    renderSearch(){
        const rows=searchEntries(this.s,this.search),max=Math.max(0,Math.ceil(rows.length/60)-1);this.page=Math.min(this.page,max);
        this.body.replaceChildren(node('div',{class:'wr-section-head'},node('div',{},node('h3',{},'全局搜索'),node('small',{},`${rows.length} 条匹配 · 覆盖词库、条件规则和保护词`)),this.btn('返回'+this.tab,()=>this.clearSearch())));
        const list=node('div',{id:'wr-global-results',class:'wr-search-results','aria-label':'全局搜索结果'});
        for(const row of rows.slice(this.page*60,this.page*60+60)){
            const {key,type,group,item,enabled}=row;
            const title=key==='groups'?item.from:key==='protectionGroups'?item.text:triggerTitle(item);
            const card=node('article',{class:`wr-search-card ${enabled?'':'wr-rule-off'}`,'data-rule-id':item.id,'data-group-id':group.id},node('small',{class:'wr-search-source'},`${type} / ${group.name}`));
            const copy=node('div',{class:'wr-search-copy'},node('b',{},title));
            if(type==='词库')copy.append(node('span',{'aria-hidden':'true'},'→'),node('span',{class:'wr-search-replacement'},item.to===''?'〔删除〕':item.to));
            const toggle=this.check(enabled?(this.s.enabled?'已启用':'已暂停'):'已停用',enabled,value=>{item.enabled=value;this.save();this.renderSearch();});
            toggle.querySelector('input').setAttribute('aria-label','启用');if(enabled&&!this.s.enabled)toggle.title='总开关已暂停';
            card.append(node('div',{class:'wr-search-line'},copy,node('div',{class:'wr-search-actions'},toggle,this.btn('编辑',()=>this.locateResult(row),{'aria-label':'定位编辑',title:'定位编辑'}))));
            if(key==='ruleGroups')card.append(node('small',{},ruleSummary(item,group)),node('details',{class:'wr-search-details'},node('summary',{},'触发详情'),this.ruleContent(item)));
            if(key==='protectionGroups')card.append(node('small',{},'保护范围：'+group.targets.map(id=>id==='all'?'全部内容':id==='context'?'语境规则':[...this.s.groups,...this.s.ruleGroups].find(g=>g.id===id)?.name??'分类').join('、')));
            list.append(card);
        }
        if(!rows.length)list.append(node('div',{class:'wr-empty'},'全部分类中没有匹配项。'));
        this.body.append(list,this.row(this.btn('上一页',()=>{this.page--;this.renderSearch();this.dialog.scrollTop=0;},{hidden:max===0,disabled:this.page===0}),node('small',{},rows.length?`${this.page+1}/${max+1} 页`:''),this.btn('下一页',()=>{this.page++;this.renderSearch();this.dialog.scrollTop=0;},{hidden:max===0,disabled:this.page===max})));
    }
    key(){return this.tab==='条件规则'||(this.tab==='保护词'&&this.protectionMode==='rules')?'ruleGroups':this.tab==='保护词'?'protectionGroups':'groups';}
    visibleGroups(){return this.s[this.key()].filter(g=>this.tab!=='条件规则'||!g.rules.length||g.rules.some(r=>r.kind!=='context'));}
    items(g){return this.key()==='protectionGroups'?g.terms:this.tab==='条件规则'?g.rules.filter(r=>r.kind!=='context'):g.rules;}
    categoryState(g){return groupState({rules:this.items(g)});}
    current(){const groups=this.visibleGroups();return groups.find(g=>g.id===this.selected[this.tab])??groups[0];}
    visiblePresets(){return Object.entries(TRIGGER_PRESETS).filter(([id,p])=>id!=='context'&&(!p.extra||presetEntries(this.s,id).length||this.morePresets&&id!=='custom'||id===this.conditionPreset));}
    choosePreset(id){if(id==='context'){this.tab='保护词';this.protectionMode='rules';}this.conditionMode='presets';this.conditionPreset=id;this.page=0;this.draft=null;this.selection.clear();this.render();this.dialog.scrollTop=0;}
    presetCheck(id){
        const entries=presetEntries(this.s,id),state=groupState({rules:entries.map(e=>e.rule)});
        const label=id==='context'?`启用下方全部规则（${entries.length} 条）`:`启用全部「${TRIGGER_PRESETS[id].title}」规则`;
        const control=this.check(label,state.checked,value=>{for(const {rule}of entries)rule.enabled=value;this.save();this.render();});
        control.querySelector('input').indeterminate=state.mixed;control.querySelector('input').disabled=!entries.length;return control;
    }
    presetSheet(){
        const sheet=node('section',{class:'wr-category-sheet','aria-label':'触发模板面板'}),list=node('div',{class:'wr-sheet-list'});
        for(const [id,p]of this.visiblePresets())list.append(this.btn(p.title,()=>{sheet.remove();this.choosePreset(id);},{class:'wr-button menu_button wr-preset-option'}));
        sheet.append(this.row(node('h3',{},'选择触发模板'),this.btn('关闭',()=>sheet.remove())),list);this.pane.append(sheet);
    }
    addPreset(id,group=null){
        const p=TRIGGER_PRESETS[id];if(!p.kind)throw new Error('请从左侧选择触发模板。');
        const g=group??this.s.ruleGroups.find(g=>g.name===p.title&&g.rules.every(r=>triggerPreset(r,g)===id))??{id:uid(),name:p.title,enabled:false,defaultAction:['clause','sentence'].includes(p.action)?p.action:'word',concealed:false,rules:[]};
        this.startRule(g,p.kind,null,id);
    }
    showPresetChooser(group){
        const chooser=node('section',{class:'wr-import-card wr-trigger-chooser'},node('h4',{},'选择触发模板'));
        for(const [id,p]of Object.entries(TRIGGER_PRESETS).filter(([id,p])=>p.kind&&id!=='context'))chooser.append(this.btn(p.title,()=>{chooser.remove();this.addPreset(id,group);}));
        chooser.append(this.btn('取消',()=>chooser.remove()));this.body.prepend(chooser);
    }
    renderTriggerPresets(){
        const protecting=this.tab==='保护词',id=protecting?'context':this.conditionPreset;this.conditionPreset=id;
        const p=TRIGGER_PRESETS[id]??TRIGGER_PRESETS.keywords,entries=presetEntries(this.s,id),state=groupState({rules:entries.map(e=>e.rule)});
        const max=Math.max(0,Math.ceil(entries.length/60)-1);this.page=Math.min(max,this.page);
        this.body.append(node('div',{class:'wr-section-head'},node('div',{},node('h3',{},protecting?'特定表达的处理与保留':'条件规则'),protecting?null:node('small',{},'选择触发模板，填写需要处理的内容。')),
            this.row(...(protecting?[]:[this.btn('分类与批量整理',()=>{this.conditionMode='categories';this.draft=null;this.render();})]),this.btn('测试效果',()=>this.showView('测试效果')))));
        const sidebar=node('aside',{class:'wr-sidebar'},node('b',{},'触发模板'));
        for(const [key,preset]of protecting?[]:this.visiblePresets()){
            const rows=presetEntries(this.s,key),summary=groupState({rules:rows.map(e=>e.rule)}),button=this.btn('',()=>this.choosePreset(key),{'aria-current':key===id?'true':'false',class:'wr-button menu_button wr-category-name'});
            button.append(node('span',{},preset.title),node('small',{},rows.length?summary.label:'填写触发内容后使用'));
            sidebar.append(node('div',{class:`wr-group ${key===id?'wr-selected':''}`},this.presetCheck(key),button));
        }
        sidebar.append(this.btn(this.morePresets?'收起更多模板':'更多模板',()=>{this.morePresets=!this.morePresets;this.render();}));
        const content=node('section',{class:'wr-content wr-trigger-content'});
        this.body.append(protecting?content:node('div',{class:'wr-layout'},sidebar,content));
        content.append(...(protecting?[]:[node('div',{class:'wr-mobile-categories'},this.btn(p.title+'　⌄',()=>this.presetSheet(),{class:'wr-button menu_button wr-category-picker','aria-label':'选择触发模板'}),this.btn('更多',()=>{this.morePresets=true;this.presetSheet();}) )]),
            node('div',{class:'wr-category-heading'},node('div',{},node('b',{},p.title),node('small',{},entries.length?state.label:'尚未添加触发内容')),this.presetCheck(id)),
            node('section',{class:'wr-template-intro'},node('p',{},p.description),node('small',{},p.example)),
            ...(p.kind?[this.btn('＋ 添加触发内容',()=>this.addPreset(id),{class:'wr-button menu_button wr-primary wr-add-trigger'})]:[]));
        const list=node('div',{class:'wr-template-list'});content.append(list);
        for(const {group,rule:r}of entries.slice(this.page*60,this.page*60+60)){
            const title=triggerTitle(r),menu=node('details',{class:'wr-item-menu'},node('summary',{'aria-label':`更多操作 ${title}`},'•••'),
                this.btn('复制到分类',()=>this.transferItem(group,r,false)),this.btn('移动到分类',()=>this.transferItem(group,r,true)),this.btn('删除触发内容',()=>{group.rules=group.rules.filter(rule=>rule!==r);this.save();this.render();}));
            list.append(node('article',{class:`wr-template-rule ${r.enabled?'':'wr-rule-off'}`,'data-rule-id':r.id},
                this.row(this.check(title,r.enabled,value=>{r.enabled=value;this.save();this.render();}),r.kind==='context'?null:node('span',{class:'wr-badge'},ACTIONS[effectiveAction(r,group)]),menu),
                this.ruleContent(r,group),r.kind==='context'?null:node('small',{},`来源分类：${group.name}`),this.btn(r.kind==='context'?'编辑规则 / 试用':'编辑触发 / 测试',()=>this.startRule(group,r.kind,r))));
            if(r.kind==='context')menu.append(node('small',{},`存放分类：${group.name}`),node('small',{},'复制、移动与分类导出使用此分类。'));
        }
        if(!entries.length)list.append(node('div',{class:'wr-empty'},'填写触发内容后，会在这里显示具体内容与启停状态。'));
        if(max)content.append(this.row(this.btn('上一页',()=>{this.page--;this.render();this.dialog.scrollTop=0;},{disabled:this.page===0}),node('small',{},`${this.page+1}/${max+1} 页 · ${entries.length} 条触发内容`),this.btn('下一页',()=>{this.page++;this.render();this.dialog.scrollTop=0;},{disabled:this.page===max})));
        if(this.draft){const g=this.draft.group??this.s.ruleGroups.find(g=>g.id===this.draft.groupId);if(g)this.renderRuleEditor(content,g);}
        
    }
    choose(id){this.selected[this.tab]=id;this.search='';this.page=0;this.selection.clear();this.draft=null;this.render();this.dialog.scrollTop=0;}
    newGroup(){
        if(this.s[this.key()].length>=200)throw new Error('分类数量已达到 200 个。');
        this.inlinePrompt('新建分类','分类名称','',name=>{
            const g={id:uid(),name,enabled:false,...(this.tab==='保护词'?{targets:['all'],terms:[]}:{rules:[]}),...(this.tab==='条件规则'?{defaultAction:'clause',concealed:false}:{})};
            this.s[this.key()].push(g);this.save();this.choose(g.id);
        });
    }
    inlinePrompt(title,label,value,apply,limit=100){
        const input=this.field(value,label,null,{maxLength:limit}),box=node('section',{class:'wr-rule-editor'},node('h4',{},title),input);
        box.append(this.row(this.btn('保存',()=>{const v=input.value.trim();if(!v)throw new Error('请填写'+label+'。');apply(v);box.remove();},{class:'wr-button menu_button wr-primary'}),this.btn('取消',()=>box.remove())));
        this.body.prepend(box);input.focus();
    }
    categoryCheck(g,label){
        const state=this.categoryState(g);
        const control=this.check(label,state.checked,v=>{this.items(g).forEach(r=>r.enabled=v);this.save();this.render();});
        const input=control.querySelector('input');input.indeterminate=state.mixed;input.setAttribute('aria-label',label);input.dataset.categoryId=g.id;return control;
    }
    categoryLayout(){
        const groups=this.visibleGroups(),g=this.current();if(g)this.selected[this.tab]=g.id;
        const sidebar=node('aside',{class:'wr-sidebar'},node('b',{},'分类'));
        for(const item of groups){const state=this.categoryState(item);
            sidebar.append(node('div',{class:`wr-group ${item===g?'wr-selected':''}`},this.categoryCheck(item,`切换分类启停 ${item.name}`),this.btn('',()=>this.choose(item.id),{'aria-current':item===g?'true':'false',class:'wr-button menu_button wr-category-name'})));
            sidebar.lastChild.lastChild.append(node('span',{},item.name),node('small',{'data-state-for':item.id},state.label));
        }
        sidebar.append(this.btn('＋ 新建分类',()=>this.newGroup()));
        const content=node('section',{class:'wr-content'});this.body.append(node('div',{class:'wr-layout'},sidebar,content));
        content.append(node('div',{class:'wr-mobile-categories'},this.btn(g?`${g.name}　⌄`:'选择分类　⌄',()=>this.categorySheet(),{class:'wr-button menu_button wr-category-picker','aria-label':'选择分类'}),this.btn('＋',()=>this.newGroup(),{'aria-label':'新建分类'})));
        if(!g){content.append(node('div',{class:'wr-empty'},node('h4',{},'从第一个分类开始'),node('p',{},this.tab==='条件规则'?'按用途整理句子清理、固定结构或标记规则。':'将需要保留的文字集中整理。'),this.btn('＋ 新建分类',()=>this.newGroup(),{class:'wr-button menu_button wr-primary'})));return;}
        content.append(node('div',{class:'wr-category-heading'},node('div',{},node('b',{},g.name),node('small',{'data-state-for':g.id},this.categoryState(g).label)),this.row(this.categoryCheck(g,'启用整个分类'),this.btn('分类设置',()=>this.categorySettings(g,content)))));
        this.updateStates=()=>{
            for(const category of groups){const state=this.categoryState(category);
                this.pane.querySelectorAll('[data-state-for]').forEach(e=>{if(e.dataset.stateFor===category.id)e.textContent=state.label;});
                this.pane.querySelectorAll('input[data-category-id]').forEach(e=>{if(e.dataset.categoryId===category.id){e.checked=state.checked;e.indeterminate=state.mixed;}});
            }
        };
        if(this.tab==='词库')this.renderWords(content,g);
        if(this.tab==='条件规则')this.renderRules(content,g);
        if(this.tab==='保护词')this.renderProtection(content,g);
        if(this.draft&&this.draft.groupId===g.id)this.renderRuleEditor(content,g);
        
    }
    categorySheet(){
        const sheet=node('section',{class:'wr-category-sheet','aria-label':'分类面板'}),list=node('div',{class:'wr-sheet-list'});
        const draw=query=>{list.replaceChildren();for(const g of this.visibleGroups().filter(g=>g.name.includes(query))){list.append(node('div',{class:'wr-group'},this.categoryCheck(g,`切换分类启停 ${g.name}`),this.btn('',()=>{sheet.remove();this.choose(g.id);},{class:'wr-button menu_button wr-category-name'})));list.lastChild.lastChild.append(node('span',{},g.name),node('small',{},this.categoryState(g).label));}};
        sheet.append(this.row(node('h3',{},'切换分类'),this.btn('关闭',()=>sheet.remove())),this.field('','搜索分类',draw),list,this.btn('＋ 新建分类',()=>{sheet.remove();this.newGroup();}));this.pane.append(sheet);draw('');
    }
    categorySettings(g,content){
        const existing=content.querySelector('.wr-category-config');if(existing){existing.remove();return;}
        const groups=this.s[this.key()],index=groups.indexOf(g),panel=node('section',{class:'wr-category-config wr-import-card'},node('h4',{},'分类设置'));
        const name=this.field(g.name,'分类名称',null,{maxLength:100});
        panel.append(this.label('名称',name),this.row(this.btn('保存名称',()=>{if(!name.value.trim())throw new Error('请填写分类名称。');g.name=name.value.trim();this.save();this.render();}),
            this.btn('↑ 上移',()=>this.moveGroup(g,-1),{disabled:index===0,'aria-label':'上移当前分类'}),this.btn('↓ 下移',()=>this.moveGroup(g,1),{disabled:index===groups.length-1,'aria-label':'下移当前分类'}),
            this.btn('导出此分类',()=>{const s=structuredClone(this.s);s.groups=this.key()==='groups'?[structuredClone(g)]:[];s.ruleGroups=this.key()==='ruleGroups'?[structuredClone(g)]:[];s.protectionGroups=this.key()==='protectionGroups'?[structuredClone(g)]:[];
                // Include selected protection targets so the backup remains self-contained.
                if(this.key()==='protectionGroups'&&!g.targets.includes('all')){s.groups=this.s.groups.filter(x=>g.targets.includes(x.id));s.ruleGroups=this.s.ruleGroups.filter(x=>g.targets.includes(x.id));}
                s.exceptions=[];s.sentenceRules=[];s.contextual=false;download(`${g.name}.json`,s);}),
            this.btn('删除分类',()=>{if(!confirm(`删除“${g.name}”及其中 ${this.items(g).length} 条内容？`))return;
                for(const p of this.s.protectionGroups)if(p.targets.includes(g.id)&&p.targets.length===1&&p.terms.length)throw new Error('此分类是保护词的唯一目标，请先调整保护范围。');
                for(const p of this.s.protectionGroups){p.targets=p.targets.filter(t=>t!==g.id);if(!p.targets.length)p.targets=['all'];}
                this.s[this.key()]=groups.filter(x=>x!==g);this.save();this.render();},{class:'wr-button menu_button wr-danger'})));
        if(this.tab==='条件规则'&&g.rules.some(r=>r.inheritAction))panel.append(this.label('分类默认删除范围',this.select(g.defaultAction,'分类默认删除范围',{word:ACTIONS.word,clause:ACTIONS.clause,sentence:ACTIONS.sentence},v=>{g.defaultAction=v;this.save();this.render();}),`${g.rules.filter(r=>r.inheritAction).length} 条规则沿用此设置`));
        panel.append(this.btn('收起设置',()=>panel.remove()));content.insertBefore(panel,content.children[2]??null);
    }
    moveGroup(g,direction){const groups=this.s[this.key()],i=groups.indexOf(g),j=i+direction;if(j<0||j>=groups.length)return;[groups[i],groups[j]]=[groups[j],groups[i]];this.save();this.render();}
    editWord(g,r=null,prefill=''){
        if(!r){const input=this.body.querySelector('.wr-add-inline input');if(input){input.value=prefill;this.wordDrafts.set(g.id,{...(this.wordDrafts.get(g.id)??{}),from:prefill});input.focus();return;}}
        const old=this.body.querySelector('.wr-word-editor');old?.remove();
        const from=this.field(r?.from??prefill,'原词',null,{maxLength:2000}),to=this.field(r?.to??'','替换文字',null,{maxLength:10000});
        const mode=this.select(r?.to===''?'delete':'replace','处理方式',{replace:'替换为',delete:'删除文字'},v=>to.hidden=v==='delete');to.hidden=mode.value==='delete';
        const editor=node('section',{class:'wr-word-editor wr-import-card'},node('h4',{},r?'编辑词条':'添加词条'),this.label('原词',from),this.label('处理',mode),to);
        editor.append(this.row(this.btn(r?'保存修改':'添加词条',()=>{
            if(!from.value.trim())throw new Error('请填写原词。');if(mode.value==='replace'&&!to.value.length)throw new Error('请填写替换文字，或选择“删除文字”。');const next=mode.value==='delete'?'':to.value;
            const target=r??g.rules.find(x=>x.from===from.value);
            if(target){target.from=from.value;setReplacement(target,next);}else{
                if(this.s.groups.reduce((n,x)=>n+x.rules.length,0)>=20000)throw new Error('词条数量已达到 20000。');
                g.rules.push({id:uid(),from:from.value,to:next,enabled:true});
            }
            this.page=wordRulePage(g,target??g.rules.at(-1),this.s);this.save();this.render();
        },{class:'wr-button menu_button wr-primary'}),this.btn('取消',()=>editor.remove())));
        this.body.querySelector('.wr-content').prepend(editor);from.focus();editor.scrollIntoView?.({block:'nearest'});
    }
    renderWords(content,g){
        const list=node('div',{class:'wr-rule-list'}),pager=node('div',{class:'wr-row'});
        const draw=()=>{
            list.replaceChildren();pager.replaceChildren();const rows=orderedWordRules(g.rules,this.s.wordOrder),size=wordPageSize(this.s),max=Math.max(0,Math.ceil(rows.length/size)-1);this.page=Math.min(max,this.page);
            const issues=new Map(inspectRules(this.s).map(i=>[i.from,i]));
            for(const r of rows.slice(this.page*size,this.page*size+size)){
                const issue=issues.get(r.from),check=this.check('启用',r.enabled,v=>{r.enabled=v;this.save();draw();});
                const actions=node('details',{class:'wr-item-menu'},node('summary',{'aria-label':`更多操作 ${r.from}`},'•••'),this.btn('编辑',()=>this.editWord(g,r)),this.btn('删除',()=>{g.rules=g.rules.filter(x=>x!==r);this.selection.delete(r.id);this.save();draw();}));
                list.append(node('article',{class:`wr-word-card ${r.enabled?'':'wr-rule-off'}`,'data-rule-id':r.id},
                    ...(this.selecting?[this.check('选择',this.selection.has(r.id),v=>{v?this.selection.add(r.id):this.selection.delete(r.id);batchState();})]:[]),
                    this.btn('',()=>this.editWord(g,r),{class:'wr-button wr-word-copy','aria-label':`编辑词条 ${r.from}`}),check,actions));
                list.lastChild.querySelector('.wr-word-copy').append(node('span',{class:'wr-original'},r.from),node('span',{class:'wr-word-arrow','aria-hidden':'true'},'→'),node('span',{class:r.to===''?'wr-delete-label':'wr-replacement'},r.to===''?'〔删除〕':r.to));
                if(issue?.kind==='conflict'&&r.enabled)list.lastChild.querySelector('.wr-word-copy').append(node('small',{class:'wr-conflict'},'替换冲突'));
            }
            if(!rows.length)list.append(node('div',{class:'wr-empty'},'添加第一条替换，或导入已有词库。'));
            pager.append(this.btn('上一页',()=>{this.page--;draw();},{hidden:max===0,disabled:this.page===0}),node('small',{},`${rows.length} 条${max?` · ${this.page+1}/${max+1} 页`:''}`),this.btn('下一页',()=>{this.page++;draw();},{hidden:max===0,disabled:this.page===max}));
            batchState();
        };
        const batch=node('div',{class:'wr-batch-bar',hidden:!this.selecting,'aria-label':'批量操作'}),info=node('span',{}),paste=node('div',{class:'wr-paste-panel'});
        const batchState=()=>{info.textContent=`已选 ${this.selection.size} 条${this.clipboard?` · ${this.clipboard.mode==='cut'?'待移动':'已复制'} ${this.clipboard.rules.length} 条`:''}`;};
        const capture=mode=>{this.clipboard=createTransfer(g,this.selection,mode);batchState();this.notice('已放入插件剪贴板，切换分类后点击粘贴。');};
        batch.append(info,this.row(this.btn('全选结果',()=>{g.rules.forEach(r=>this.selection.add(r.id));draw();}),this.btn('清空选择',()=>{this.selection.clear();draw();}),
            this.btn('复制',()=>capture('copy')),this.btn('剪切',()=>capture('cut')),
            this.btn('启用所选',()=>{g.rules.filter(r=>this.selection.has(r.id)).forEach(r=>r.enabled=true);this.save();draw();}),this.btn('停用所选',()=>{g.rules.filter(r=>this.selection.has(r.id)).forEach(r=>r.enabled=false);this.save();draw();}),
            this.btn('移到条件规则',()=>this.wordsToRules(g))));
        const pasteButton=this.btn('粘贴到此类',()=>{
            if(!this.clipboard)throw new Error('请先复制或剪切词条。');const pending=this.clipboard,plan=planPaste(g,pending.rules),snapshot=JSON.stringify(g.rules);
            const policy=this.select('skip','冲突处理',{skip:'保留现有条目',overwrite:'采用粘贴条目',disabled:'添加为停用条目'},()=>{});
            paste.replaceChildren(node('p',{},`新增 ${plan.additions.length} · 相同 ${plan.duplicates.length} · 冲突 ${plan.conflicts.length}`),policy,this.row(this.btn('确认粘贴',()=>{
                if(pending!==this.clipboard||snapshot!==JSON.stringify(g.rules))throw new Error('词库已变化，请重新打开粘贴预览。');
                const result=pasteTransfer(this.s,g.id,pending,policy.value);if(pending.mode==='cut')this.clipboard=result.remaining.length?{...pending,rules:result.remaining}:null;
                this.save();this.render();
            }),this.btn('取消',()=>paste.replaceChildren())));
        },{hidden:!this.clipboard||!!this.clipboard.type});
        const draft=this.wordDrafts.get(g.id)??{from:'',to:''};this.wordDrafts.set(g.id,draft);
        const from=this.field(draft.from??'','替换前的词',v=>draft.from=v,{maxLength:2000}),to=this.field(draft.to??'','替换后的词（留空删除）',v=>draft.to=v,{maxLength:10000});
        const add=node('form',{class:'wr-add-inline','aria-label':'添加词条',onsubmit:this.safe(e=>{
            e.preventDefault();if(!from.value.trim())throw new Error('请填写替换前的词。');
            const old=g.rules.find(r=>r.from===from.value);
            if(old)setReplacement(old,to.value);else{
                if(this.s.groups.reduce((n,x)=>n+x.rules.length,0)>=20000)throw new Error('词条数量已达到 20000。');
                g.rules.push({id:uid(),from:from.value,to:to.value,enabled:true});
            }
            this.wordDrafts.delete(g.id);this.search='';this.page=wordRulePage(g,old??g.rules.at(-1),this.s);this.save();this.render();this.body.querySelector('.wr-add-inline input')?.focus();
            this.notice(old?`已更新词条${old.enabled?'':' · 该词条已停用'}`:'已添加，可以继续填写下一条。');
        })},this.label('原词',from),node('span',{class:'wr-add-arrow','aria-hidden':'true'},'→'),this.label('替换为',to),this.btn('添加',()=>{}, {type:'submit',class:'wr-button menu_button wr-primary'}));
        const displayOptions=node('div',{class:'wr-word-view-options'},this.label('每页显示',this.select(String(wordPageSize(this.s)),'每页词条数',{'10':'10 条','15':'15 条'},value=>{this.s.wordPageSize=Number(value);this.page=0;this.save();this.render();})),
            this.label('排列方式',this.select(this.s.wordOrder??'default','词条排序',WORD_ORDERS,value=>{this.s.wordOrder=value;this.page=0;this.save();this.render();})));
        content.append(add,displayOptions,
            this.row(this.btn(this.selecting?'完成选择':'批量选择',()=>{this.selecting=!this.selecting;this.selection.clear();this.render();}),pasteButton),paste,list,pager,batch);
        const text=this.area('','每行一条：\n单车=自行车\n【待删】=',null);
        content.append(node('details',{class:'wr-advanced'},node('summary',{},'批量添加'),text,this.btn('检查并添加',()=>{
            const items=parseBatch(text.value);if(!items.length)throw new Error('请填写词条。');const draft=structuredClone(this.s),target=draft.groups.find(x=>x.id===g.id);
            for(const r of items){const old=target.rules.find(x=>x.from===r.from);if(old)setReplacement(old,r.to);else target.rules.push(r);}
            const index=this.s.groups.indexOf(g);syncGroups(draft);this.app.settings=validateSettings(draft);this.selected[this.tab]=this.app.settings.groups[index]?.id;this.save();this.render();
        }),node('small',{},'每行使用 = 分隔原词和替换词，如：单车=自行车。')));draw();
    }
    wordsToRules(g){
        const rows=g.rules.filter(r=>this.selection.has(r.id));if(!rows.length)throw new Error('请先选择词条。');if(rows.some(r=>r.to!==''))throw new Error('请选择“删除文字”词条，替换词条可在词库继续编辑。');
        const scope=this.select('clause','迁移后的删除范围',{word:ACTIONS.word,clause:ACTIONS.clause,sentence:ACTIONS.sentence},()=>{}),name=this.field(g.name,'规则分类名称',null);
        const preview=node('section',{class:'wr-import-card'},node('h4',{},`移动 ${rows.length} 条删除词`),name,scope,node('p',{},'移动后会显示规则名称、触发词和删除范围。'));
        const snapshot=JSON.stringify(rows);
        preview.append(this.row(this.btn('确认移动',()=>{
            if(JSON.stringify(g.rules.filter(r=>this.selection.has(r.id)))!==snapshot)throw new Error('选择内容已变化，请重新预览。');
            if(!name.value.trim())throw new Error('请填写分类名称。');if(this.s.ruleGroups.length>=200||this.s.ruleGroups.reduce((n,g)=>n+g.rules.length,0)+rows.length>20000)throw new Error('条件规则数量已达到上限。');
            const next={id:uid(),name:name.value.trim().slice(0,100),enabled:true,defaultAction:scope.value,concealed:false,rules:rows.map((r,i)=>({id:uid(),name:`触发规则 ${i+1}`,kind:'keywords',keywords:[r.from],matchMode:'any',action:scope.value,inheritAction:true,enabled:r.enabled,respectProtection:true}))};
            this.s.ruleGroups.push(next);g.rules=g.rules.filter(r=>!this.selection.has(r.id));this.selection.clear();this.save();this.tab='条件规则';this.selected[this.tab]=next.id;this.search='';this.render();
        },{class:'wr-button menu_button wr-primary'}),this.btn('取消',()=>preview.remove())));this.body.prepend(preview);
    }
    startRule(g,kind='keywords',r=null,presetId=null){
        if(kind==='context'){this.tab='保护词';this.protectionMode='rules';}
        const chosen=presetId??(r?triggerPreset(r,g):{keywords:'keywords',pattern:'pattern',markers:'markers',context:'context',correction:'correction'}[kind]??'custom');
        const initial=chosen==='custom'?{id:uid(),name:'',enabled:true,kind,action:'clause',respectProtection:true}:presetDraft(chosen);
        const data=structuredClone(r??initial);if(r&&chosen!=='custom'){data.action=effectiveAction(r,g);data.inheritAction=false;}
        this.conditionPreset=chosen;
        this.draft={groupId:g.id,group:g,presetId:chosen,originalId:r?.id,data,sample:kind==='correction'?`她的${data.keywords[0]??'翅膀'}——不对，她没有${data.keywords[0]??'翅膀'}，她的手臂伸向窗外。`:chosen==='together'?'她点头，声音传来，语调平静。她坐下。':kind==='context'?CONTEXT_REVIEWS[r?.template??'kinship'].sample:kind==='pattern'?'响起极轻的脚步声，随后传来极重的撞击声。':kind==='markers'?'正文。[示例开始]这段是示例内容。[示例结束]继续正文。':'她点头，【待删】这句是示例。她坐下。'};
        this.render();this.pane.querySelector('.wr-rule-editor')?.scrollIntoView?.({block:'nearest'});
    }
    contextGuide(r,g,onExample){
        const guide=CONTEXT_GUIDES[r.template],content=node('section',{class:'wr-context-guide','data-context-guide':r.template});
        const group=g??this.s.ruleGroups.find(group=>group.rules.some(item=>item.id===r.id))??{id:'context-preview',name:'当前规则',enabled:true,rules:[]};
        const engine=compile({...this.s,enabled:true,groups:[],sentenceRules:[],contextual:false,ruleGroups:[{...group,enabled:true,rules:[{...r,enabled:true}]}]});
        const example=input=>{
            const result=engine.run(input,{explain:true}),same=input===result.text;
            const line=this.btn('',()=>onExample?onExample(input):(()=>{this.startRule(group,'context',r);this.draft.sample=input;this.render();this.pane.querySelector('.wr-rule-editor')?.scrollIntoView?.({block:'nearest'});})(),{class:'wr-button wr-context-example','aria-label':`试用示例：${input}`});
            line.append(node('span',{},input),node('span',{class:'wr-context-arrow','aria-hidden':'true'},'→'),node('span',{class:'wr-context-result'},same?'原样保留':result.text||'〔删除匹配文字〕'));
            if(result.preserved?.length)line.title=result.preserved.map(p=>p.reason).join('；');
            return line;
        };
        content.append(node('div',{},node('b',{},'处理对象'),node('p',{},guide.target)),node('small',{},guide.meaning),
            node('b',{},'修改前 → 当前结果'),example(guide.change),node('b',{},'正常用法检查'),example(guide.normal[0]),
            node('details',{class:'wr-context-more'},node('summary',{},`更多正常用法（${guide.normal.length-1} 例）`),...guide.normal.slice(1).map(example)),
            node('details',{class:'wr-context-more'},node('summary',{},'完整匹配范围与保留条件'),node('p',{},guide.details),
                node('p',{},guide.protection),node('small',{},`正常用法保护：${r.safeContext!==false?'已开启':'已关闭'}`)));
        content.refresh=()=>{
            const open=[...content.querySelectorAll('details')].map(e=>e.open),next=this.contextGuide(r,g,onExample);
            next.querySelectorAll('details').forEach((e,i)=>e.open=open[i]??false);content.replaceWith(next);
        };
        return content;
    }
    refreshContextGuides(){this.pane.querySelectorAll('.wr-context-guide').forEach(e=>e.refresh?.());}
    ruleContent(r,g=null){
        const content=node('div',{class:'wr-rule-content'}),chips=values=>node('div',{class:'wr-keyword-chips'},...values.map(v=>node('span',{},v)));
        if(r.kind==='correction')content.append(node('small',{},'需要避开的词'),chips(r.keywords),node('small',{},'破折号后的纠错提示词'),chips(r.cues));
        if(r.kind==='keywords')content.append(node('small',{},r.matchMode==='all'?'共同触发词':'触发词'),chips(r.keywords));
        if(r.kind==='pattern')content.append(node('small',{},'触发结构'),chips([r.prefix,`${r.min===r.max?r.min:`${r.min}～${r.max}`} 个汉字`,r.suffix]));
        if(r.kind==='markers')content.append(node('small',{},'开始标记 → 结束标记'),chips([r.start,r.end]));
        if(r.kind==='boundary')content.append(node('small',{},'触发词'),chips([r.keyword]),node('small',{},`起始标点：${r.startChars}　结束标点：${r.endChars}`));
        if(r.kind==='context')content.append(this.contextGuide(r,g));
        if(r.action==='replace')content.append(node('small',{},'替换为'),chips([r.to===''?'〔空文本〕':r.to]));
        if(r.filters){
            for(const [key,label]of Object.entries(FILTER_FIELDS))if(r.filters[key]?.length)content.append(node('small',{},`${label}${['contains','excludes'].includes(key)?`（${r.filters.scope==='clause'?'同分句':'同一句'}）`:''}`),chips(r.filters[key]));
            if(r.filters.boundary!=='any')content.append(node('small',{},`文字边界：${BOUNDARIES[r.filters.boundary]}`));
            if(r.filters.maxClauses)content.append(node('small',{},`最多涉及 ${r.filters.maxClauses} 个相邻分句`));
            if(r.filters.ordered)content.append(node('small',{},'按关键词填写顺序匹配'));
            if(r.filters.distance)content.append(node('small',{},`关键词最多相隔 ${r.filters.distance} 字`));
        }
        return content;
    }
    renderRules(content,g){
        const list=node('div',{class:'wr-template-list'});
        const draw=()=>{
            list.replaceChildren();const rows=this.items(g);
            for(const r of rows){
                const name=triggerTitle(r),menu=node('details',{class:'wr-item-menu'},node('summary',{'aria-label':`更多操作 ${name}`},'•••'),
                    this.btn('复制到分类',()=>this.transferItem(g,r,false)),this.btn('移动到分类',()=>this.transferItem(g,r,true)),this.btn('删除',()=>{g.rules=g.rules.filter(x=>x!==r);this.save();draw();}));
                list.append(node('article',{class:`wr-template-rule ${r.enabled?'':'wr-rule-off'}`,'data-rule-id':r.id},
                    this.row(...(this.selecting?[this.check('选择',this.selection.has(r.id),v=>{v?this.selection.add(r.id):this.selection.delete(r.id);bulk.update();})]:[]),this.check(name,r.enabled,v=>{r.enabled=v;this.save();draw();}),node('span',{class:'wr-badge'},ACTIONS[r.inheritAction?g.defaultAction:r.action]),menu),
                    node('p',{class:'wr-rule-description'},ruleSummary(r,g)),
                    this.ruleContent(r),this.btn('编辑 / 测试',()=>this.startRule(g,r.kind,r))));
            }
            if(!rows.length)list.append(node('div',{class:'wr-empty'},'选一个模板，填入内容并查看效果。'));bulk.update();
        };
        const bulk=this.genericBatch(g,()=>this.items(g),draw);
        content.append(node('div',{class:'wr-dictionary-toolbar'},this.btn('＋ 添加触发内容',()=>this.showPresetChooser(g),{class:'wr-button menu_button wr-primary'})),list,
            node('details',{class:'wr-advanced'},node('summary',{},'从示例开始'),node('div',{class:'wr-example-grid'},
                ...[
                    ['关键词清理','【待删】 → 删除所在分句','keywords'],
                    ['固定结构','极＋1 个汉字＋的 → 删除文字','pattern'],
                    ['标记内容','[示例开始] … [示例结束] → 删除文字','markers'],
                ].map(([title,desc,kind])=>this.btn('',()=>this.startRule(g,kind),{class:'wr-button wr-example-card','aria-label':`示例：${title}`})))));
        // Build example content separately to keep each template a single accessible button.
        const gallery=content.querySelector('.wr-example-grid');
        if(gallery){const captions=[['关键词清理','【待删】 → 删除所在分句'],['固定结构','极＋1 个汉字＋的 → 删除文字'],['标记内容','[示例开始] … [示例结束] → 删除文字']];[...gallery.children].forEach((b,i)=>b.append(node('small',{},'示例'),node('strong',{},captions[i][0]),node('span',{},captions[i][1])));}
        content.insertBefore(bulk.toggle,list);content.append(bulk.bar);draw();
    }
    renderRuleEditor(content,g){
        const draft=this.draft,r=draft.data,box=node('section',{class:'wr-rule-editor','aria-label':'规则编辑器'}),form=node('div',{class:'wr-template-form'}),sandbox=node('div',{class:'wr-rule-sandbox'});
        const fixed=draft.presetId&&draft.presetId!=='custom',preset=TRIGGER_PRESETS[draft.presetId];
        const active=()=>draft===this.draft;
        const sample=this.area(draft.sample,'测试原文',v=>{draft.sample=v;preview();},5),marked=node('div',{class:'wr-output wr-sentence-highlight'}),output=node('pre',{class:'wr-output wr-result'}),state=node('small',{role:'status'});
        const inspector=createHitInspector(marked,e=>this.locateHit(e));
        const preview=()=>{
            if(!active())return;
            try{
                const valid=validateRule({...r,action:r.inheritAction?g.defaultAction:r.action,enabled:true}),test={...this.s,enabled:true,groups:[],sentenceRules:[],contextual:false,ruleGroups:[{...g,enabled:true,rules:[valid]}]};
                valid.id=draft.originalId??r.id;
                const result=compile(test).run(sample.value,{trace:true,explain:true});output.textContent=result.text;
                state.textContent=`当前规则试用 · ${result.hits.reduce((n,h)=>n+h.count,0)} 次处理 · ${result.preserved?.length??0} 条保留记录`;state.classList.remove('wr-error');
                inspector.update(sample.value,result);
                if(r.kind==='context')this.refreshContextGuides();
            }catch(e){state.textContent=e.message;state.classList.add('wr-error');output.textContent='填写匹配条件后显示结果。';marked.textContent=sample.value;}
        };
        const update=(key,v)=>{r[key]=v;preview();};
        const kinds=r.kind==='boundary'?{boundary:KINDS.boundary,keywords:KINDS.keywords,pattern:KINDS.pattern,markers:KINDS.markers}:{keywords:KINDS.keywords,pattern:KINDS.pattern,markers:KINDS.markers};
        if(fixed)form.append(node('section',{class:'wr-template-intro'},node('b',{},preset.title),node('small',{},preset.description)));
        else form.append(this.label('匹配条件',this.select(r.kind,'匹配条件',kinds,v=>{
                Object.assign(r,{kind:v,keywords:r.keywords??['【待删】'],matchMode:r.matchMode??'any',prefix:r.prefix??'极',suffix:r.suffix??'的',min:r.min??1,max:r.max??1,start:r.start??'[示例开始]',end:r.end??'[示例结束]'});
                if(v!=='keywords'){r.inheritAction=false;r.action=v==='context'?'context':'word';}if(v==='context'){r.template??='kinship';r.safeContext??=true;}this.render();
            })));
        if(r.kind==='keywords'){
            form.append(this.label(r.matchMode==='all'?'共同触发词':'触发词或短语',this.area(r.keywords.join('\n'),'每行一个关键词',v=>update('keywords',v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))),r.matchMode==='all'?'例如分别填写“声音”和“平”，同一句共同出现时触发。':'每行一项，例如【待删】；完整短语也可以作为一项填写。'));
            if(!fixed)form.append(this.label('触发方式',this.select(r.matchMode,'触发方式',{any:'出现任意一个词',all:'同一句出现全部词，顺序任意'},v=>{r.matchMode=v;if(v==='all'&&r.action==='replace')r.action='clause';this.render();})));
        }
        if(r.kind==='correction')form.append(
            this.label('需要避开的词',this.area(r.keywords.join('\n'),'需要避开的词（每行一个）',v=>update('keywords',v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))), '每行一词，任意一项出现在误写分句中即可触发。'),
            node('details',{class:'wr-advanced'},node('summary',{},'纠错提示词'),this.area(r.cues.join('\n'),'纠错提示词（每行一个）',v=>update('cues',v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)),3)),
            node('small',{},'从误写分句开始，清理破折号、纠错提示词及重复解释该词的分句，保留后续正文。'));
        if(r.kind==='pattern')form.append(this.label('固定开头',this.field(r.prefix,'开头',v=>update('prefix',v),{maxLength:100})),
            this.row(this.label('中间最少汉字',node('input',{type:'number',class:'text_pole',min:1,max:30,value:r.min,'aria-label':'中间最少汉字',oninput:e=>update('min',Number(e.target.value))})),this.label('最多汉字',node('input',{type:'number',class:'text_pole',min:1,max:30,value:r.max,'aria-label':'最多汉字',oninput:e=>update('max',Number(e.target.value))}))),
            this.label('固定结尾',this.field(r.suffix,'结尾',v=>update('suffix',v),{maxLength:100})));
        if(r.kind==='markers')form.append(this.label('开始标记',this.field(r.start,'开始标记',v=>update('start',v),{maxLength:200})),this.label('结束标记',this.field(r.end,'结束标记',v=>update('end',v),{maxLength:200})),node('small',{},'包含起止标记及两者之间的内容，支持跨行。'));
        if(r.kind==='boundary')form.append(this.label('关键词',this.field(r.keyword,'关键词',v=>update('keyword',v))),this.label('起始标点',this.field(r.startChars,'起始标点',v=>update('startChars',v))),this.label('结束标点',this.field(r.endChars,'结束标点',v=>update('endChars',v))),node('small',{},'此规则沿用导入配置的起止标点。可通过关键词模板创建新的分句或整句规则。'));
        if(r.kind==='context'){
            const review=CONTEXT_REVIEWS[r.template];
            form.append(this.label('选择语境模板',this.select(r.template,'选择语境模板',Object.fromEntries(CONTEXT_RULES.map(t=>[t.id,t.name])),v=>{r.template=v;draft.sample=CONTEXT_REVIEWS[v].sample;this.render();})),
                this.contextGuide(r,g,input=>{draft.sample=input;sample.value=input;preview();}),
                this.contextKeepEditor(r,preview),
                CONTEXT_SAFETY[r.template]?this.check(CONTEXT_SAFETY[r.template],r.safeContext!==false,v=>update('safeContext',v)):node('small',{},'组合匹配可通过补充条件设置前后文与保留词。'),
                node('details',{class:'wr-rule-review'},node('summary',{},'匹配方式与执行顺序'),node('p',{},review.finding),node('small',{},review.improvement),node('small',{},`执行位置：词库${CONTEXT_RULES.find(t=>t.id===r.template).stage==='before'?'之前':'之后'}`)),
                this.btn('载入保留示例',()=>{draft.sample=review.sample;sample.value=draft.sample;preview();}));
        }
        const options={word:ACTIONS.word,clause:ACTIONS.clause,sentence:ACTIONS.sentence,replace:ACTIONS.replace};if(r.kind==='pattern')options.trimPrefix=ACTIONS.trimPrefix;if(r.matchMode==='all')delete options.replace;if(r.kind==='boundary'){delete options.word;delete options.replace;}
        if(fixed&&r.kind!=='context')form.append(node('div',{class:'wr-fixed-action'},node('small',{},'模板处理方式'),node('b',{},ACTIONS[r.action])));
        else form.append(this.label('处理方式',this.select(r.inheritAction?'inherit':r.action,'处理范围',r.kind==='context'?{context:'使用模板默认改法',word:ACTIONS.word,replace:ACTIONS.replace}:r.kind==='boundary'?{clause:'按指定边界删除'}:{inherit:`沿用分类：${ACTIONS[g.defaultAction]}`,...options},v=>{r.inheritAction=v==='inherit';if(!r.inheritAction)r.action=v;this.render();})));
        if(!r.inheritAction&&r.action==='replace')form.append(this.label('替换为',this.area(r.to??'','替换文字',v=>update('to',v),3)));
        form.append(this.renderFilters(r,preview),node('details',{class:'wr-more-options'},node('summary',{},'备注（可选）'),this.label('备注名称',this.field(r.name,'备注名称（可选）',v=>update('name',v),{maxLength:100}))),node('details',{class:'wr-more-options'},node('summary',{},'进阶：保护优先级'),r.kind==='context'?node('small',{},'保护词优先于本条语境处理。'):this.label('与保护内容重叠时',this.select(r.respectProtection?'protect':'clean','保护优先级',{protect:'保护优先：保留命中的词',clean:'清理优先：执行本条规则'},v=>update('respectProtection',v==='protect'))),node('small',{},'保护优先时，只保留保护词和已开启的书名、代码范围，其余命中内容继续清理。')));
        sandbox.append(node('b',{},'3 · 查看效果'),sample,node('small',{},'高亮部分为匹配范围'),marked,node('b',{},'处理后'),output,state,inspector.element);
        box.append(node('h4',{},draft.originalId?'编辑触发内容':'添加触发内容'),node('div',{class:'wr-editor-grid'},form,sandbox),node('div',{class:'wr-editor-actions'},this.btn('查看效果 ↓',()=>sandbox.scrollIntoView?.({block:'start'})),this.btn('取消',()=>{this.draft=null;this.render();}),this.btn(draft.originalId?'保存修改':'添加并启用',()=>{
            const valid=validateRule(r),old=g.rules.find(x=>x.id===draft.originalId);if(!this.s.ruleGroups.includes(g)&&this.s.ruleGroups.length>=200)throw new Error('规则分类数量已达到 200。');if(old)g.rules[g.rules.indexOf(old)]={...valid,id:old.id};else{
                if(this.s.ruleGroups.reduce((n,g)=>n+g.rules.length,0)>=20000)throw new Error('条件规则数量已达到 20000。');g.rules.push(valid);
            }
            if(!this.s.ruleGroups.includes(g))this.s.ruleGroups.push(g);
            if(this.conditionMode==='presets')this.page=Math.max(0,Math.floor(presetEntries(this.s,this.conditionPreset).findIndex(entry=>entry.rule.id===(old?.id??valid.id))/60));
            this.draft=null;this.save();this.render();
        },{class:'wr-button menu_button wr-primary'})));
        content.insertBefore(box,content.children[2]??null);preview();
    }
    renderFilters(r,preview){
        const filters=r.filters??validateFilters({});r.filters=filters;
        const chosen=this.draft.filterFields??new Set(Object.keys(FILTER_FIELDS).filter(k=>filters[k].length));this.draft.filterFields=chosen;
        const box=node('details',{class:'wr-advanced wr-filters'},node('summary',{},'补充匹配条件（可选）'));
        const boundary=this.select(filters.boundary,'文字边界',BOUNDARIES,v=>{filters.boundary=v;preview();});
        box.append(this.label('文字边界',boundary,'例：“草稿。”满足独立边界；“草稿纸”与其他汉字相连。'),
            this.label('伴随词与保留词的判断范围',this.select(filters.scope,'条件判断范围',{sentence:'同一句',clause:'同一个逗号分句'},v=>{filters.scope=v;preview();}),'句号、问号等划分整句，逗号划分分句。'));
        if(r.kind==='keywords'&&r.matchMode==='all')box.append(this.label('关键词之间最多相隔多少字',node('input',{type:'number',min:0,max:2000,value:filters.distance,class:'text_pole','aria-label':'关键词最大间隔',oninput:this.safe(e=>{filters.distance=Number(e.target.value);preview();})}),'0 表示不限；例如设为 10 时，靠近的关键词可共同触发。'));
        if(r.kind==='keywords'&&r.matchMode==='all')box.append(
            this.label('最多涉及几个分句',node('input',{type:'number',min:0,max:50,value:filters.maxClauses??0,class:'text_pole','aria-label':'最多涉及几个分句',oninput:this.safe(e=>{filters.maxClauses=Number(e.target.value);preview();})}),'0 表示不限；设为 2 时，关键词最多位于相邻两个逗号分句。'),
            this.check('按关键词填写顺序匹配',filters.ordered??false,v=>{filters.ordered=v;preview();}));
        const picker=this.select('before','添加哪种条件',FILTER_FIELDS,()=>{}),list=node('div',{class:'wr-filter-list'});
        const draw=()=>{
            list.replaceChildren();for(const key of chosen){
                const examples=FILTER_EXAMPLES[key],values=this.area(filters[key].join('\n'),FILTER_FIELDS[key],v=>{filters[key]=v.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);preview();},2);
                list.append(node('section',{class:'wr-filter-item'},this.row(node('b',{},FILTER_FIELDS[key]),this.btn('移除此条件',()=>{chosen.delete(key);filters[key]=[];draw();preview();})),values,
                    node('div',{class:'wr-filter-example'},node('small',{},examples[0]),node('small',{},examples[1]))));
            }
        };
        box.append(this.row(picker,this.btn('＋ 添加条件',()=>{chosen.add(picker.value);draw();})),list);draw();return box;
    }
    transferItem(g,item,cut){
        const key=g.terms?'terms':'rules',targets=this.s[g.terms?'protectionGroups':'ruleGroups'].filter(x=>x!==g);if(!targets.length)throw new Error('请先创建另一个分类。');
        const target=this.select(targets[0].id,'目标分类',Object.fromEntries(targets.map(x=>[x.id,x.name])),()=>{}),panel=node('section',{class:'wr-import-card'},node('h4',{},cut?'移动到分类':'复制到分类'),target);
        panel.append(this.row(this.btn('确认',()=>{const next=targets.find(x=>x.id===target.value);if(!g[key].includes(item))throw new Error('来源条目已变化，请重新选择。');
            const count=this.s[this.key()].reduce((n,x)=>n+x[key].length,0)+(cut?0:1);if(count>(key==='terms'?5000:20000))throw new Error('条目数量已达到上限。');
            const copied=structuredClone(item);if(copied.inheritAction){copied.action=g.defaultAction;copied.inheritAction=false;}next[key].push({...copied,id:uid()});if(cut)g[key]=g[key].filter(x=>x!==item);this.save();this.render();
        }),this.btn('取消',()=>panel.remove())));this.body.prepend(panel);
    }
    renderProtection(content,g){
        const all=g.targets.includes('all'),range=node('details',{class:'wr-advanced'},node('summary',{},all?'应用于：全部处理':`应用于：${g.targets.length} 个指定分类`));
        range.append(this.check('全部处理',all,v=>{g.targets=v?['all']:this.s.groups.length?[this.s.groups[0].id]:['context'];this.save();this.render();}));
        if(!all)for(const target of [...this.s.groups,...this.s.ruleGroups,{id:'context',name:'内置语境处理'}])range.append(this.check(target.name,g.targets.includes(target.id),v=>{
            if(!v&&g.targets.length===1)throw new Error('请选择至少一个保护范围。');g.targets=v?[...g.targets,target.id]:g.targets.filter(x=>x!==target.id);this.save();
        }));
        const input=this.field('','补充需要保持原样的词或短语',null,{maxLength:2000}),list=node('div',{class:'wr-rule-list'});
        const draw=()=>{list.replaceChildren();for(const term of g.terms){
            list.append(node('article',{class:'wr-word-card'},...(this.selecting?[this.check('选择',this.selection.has(term.id),v=>{v?this.selection.add(term.id):this.selection.delete(term.id);bulk.update();})]:[]),node('span',{class:'wr-original'},term.text),this.check('启用',term.enabled,v=>{term.enabled=v;this.save();}),this.btn('编辑',()=>this.inlinePrompt('编辑保护词','保护词',term.text,v=>{term.text=v;this.save();this.render();},2000)),
                node('details',{class:'wr-item-menu'},node('summary',{'aria-label':`更多操作 ${term.text}`},'•••'),this.btn('复制到分类',()=>this.transferItem(g,term,false)),this.btn('移动到分类',()=>this.transferItem(g,term,true)),this.btn('删除',()=>{g.terms=g.terms.filter(t=>t!==term);this.save();draw();}))));
        }if(!list.childElementCount)list.append(node('div',{class:'wr-empty'},'填写需要保持原样的文字，或批量添加。'));bulk.update();};
        const bulk=this.genericBatch(g,()=>g.terms,draw);
        const addTerms=values=>{const clean=[...new Set(values.map(s=>s.trim()).filter(Boolean))];if(clean.some(s=>s.length>2000))throw new Error('每条保护词最多 2000 字。');
            const fresh=clean.filter(t=>!g.terms.some(x=>x.text===t));if(this.s.protectionGroups.reduce((n,g)=>n+g.terms.length,0)+fresh.length>5000)throw new Error('保护词数量已达到 5000。');
            g.terms.push(...fresh.map(text=>({id:uid(),text,enabled:true})));this.save();draw();};
        const bulkText=this.area('','每行一条保护词\n晨光计划\n操作说明',null);
        content.append(range,this.row(input,this.btn('＋ 添加',()=>{if(!input.value.trim())throw new Error('请填写保护词。');addTerms([input.value]);input.value='';},{class:'wr-button menu_button wr-primary'})),bulk.toggle,list,
            node('details',{class:'wr-advanced'},node('summary',{},'批量添加保护词'),bulkText,this.btn('添加到此分类',()=>{addTerms(bulkText.value.split(/\r?\n/));bulkText.value='';})),node('small',{},'示例：将“晨光计划”加入保护词，该短语会保持原样。'),bulk.bar);draw();
    }
    genericBatch(g,filtered,draw){
        const key=this.key()==='protectionGroups'?'terms':'rules',type=key==='terms'?'terms':'conditions',groupKey=this.key();
        const info=node('span',{}),bar=node('div',{class:'wr-batch-bar',hidden:!this.selecting,'aria-label':'批量操作'});
        const update=()=>info.textContent=`已选 ${this.selection.size} 条${this.clipboard?.type===type?` · ${this.clipboard.mode==='cut'?'待移动':'已复制'} ${this.clipboard.rules.length} 条`:''}`;
        const capture=mode=>{const rows=g[key].filter(r=>this.selection.has(r.id));if(!rows.length)throw new Error('请先选择条目。');this.clipboard={type,mode,sourceId:g.id,sourceName:g.name,rules:structuredClone(rows),defaultAction:g.defaultAction};this.notice('已放入插件剪贴板，切换分类后粘贴。');this.render();};
        const paste=()=>{
            const transfer=this.clipboard;if(transfer?.type!==type)throw new Error('请先复制当前类型的条目。');
            const source=this.s[groupKey].find(x=>x.id===transfer.sourceId);if(transfer.mode==='cut'){
                if(!source||source===g)throw new Error('请选择其他目标分类。');
                if(source.defaultAction!==transfer.defaultAction||transfer.rules.some(r=>JSON.stringify(source[key].find(x=>x.id===r.id))!==JSON.stringify(r)))throw new Error('来源内容已变化，请重新剪切。');
            }
            const staged=transfer.rules.map(r=>{const next={...structuredClone(r),id:uid()};if(next.inheritAction){next.action=transfer.defaultAction;next.inheritAction=false;}return next;});
            const count=this.s[groupKey].reduce((n,g)=>n+g[key].length,0)+staged.length-(transfer.mode==='cut'?transfer.rules.length:0);
            if(count>(key==='terms'?5000:20000))throw new Error('条目数量已达到上限。');
            g[key].push(...staged);if(transfer.mode==='cut'){const ids=new Set(transfer.rules.map(r=>r.id));source[key]=source[key].filter(r=>!ids.has(r.id));this.clipboard=null;}
            this.save();this.render();
        };
        const toggle=this.row(this.btn(this.selecting?'完成选择':'批量选择',()=>{this.selecting=!this.selecting;this.selection.clear();this.render();}),this.btn('粘贴到此类',paste,{hidden:this.clipboard?.type!==type}));
        bar.append(info,this.row(this.btn('全选结果',()=>{filtered().forEach(r=>this.selection.add(r.id));draw();}),this.btn('清空选择',()=>{this.selection.clear();draw();}),this.btn('复制',()=>capture('copy')),this.btn('剪切',()=>capture('cut')),
            this.btn('启用所选',()=>{g[key].filter(r=>this.selection.has(r.id)).forEach(r=>r.enabled=true);this.save();draw();}),this.btn('停用所选',()=>{g[key].filter(r=>this.selection.has(r.id)).forEach(r=>r.enabled=false);this.save();draw();})));
        update();return {toggle,bar,update};
    }
    contextKeepEditor(r,preview){
        if(!['direction','kinship','prefix'].includes(r.template))return null;
        r.contextKeep??=contextKeep(this.s.contextOptions);
        const update=(key,value)=>{r.contextKeep=validateContextKeep({...r.contextKeep,[key]:value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)});preview();};
        return node('details',{class:'wr-advanced wr-context-keep'},node('summary',{},'本规则的正常用法保留条件'),
            this.label('后接这些词时保留',this.area(r.contextKeep.after.join('\n'),'本规则后接保留词',v=>update('after',v)), '例如“手稿”：她娘的手稿会保留。每行一项。'),
            this.label('前接这些词时保留',this.area(r.contextKeep.before.join('\n'),'本规则前接保留词',v=>update('before',v)), '每行一项，可以填写完整短语。'),
            node('small',{},'修改后随本条规则保存。固定名称或特殊短语可直接加入保护词。'));
    }
    locateHit(event){
        const type=event.sourceType==='manual'?'保护词':event.sourceType==='dictionary'?'词库':'条件规则';
        const groups=this.s[type==='保护词'?'protectionGroups':type==='词库'?'groups':'ruleGroups'];
        const group=groups.find(g=>g.id===event.groupId),item=group?.[type==='保护词'?'terms':'rules'].find(r=>r.id===event.ruleId);
        if(!item){this.notice('这条记录的来源已变化，请重新测试。',true);return;}
        this.locateResult({type,group,item});
    }
    renderTest(body){
        const presetView=(this.tab==='条件规则'&&this.conditionMode==='presets')||(this.tab==='保护词'&&this.protectionMode==='rules'),selected=this.tab==='设置'||presetView?null:this.current(),input=this.area(this.testInput??'','粘贴一段文字，查看处理效果',v=>{this.testInput=v;draw();},7),output=node('pre',{class:'wr-output wr-result'}),marked=node('div',{class:'wr-output wr-sentence-highlight'}),state=node('p',{});
        const inspector=createHitInspector(marked,e=>this.locateHit(e));
        const mode=this.select('all','测试范围',{all:'全部已启用内容',...(presetView?{category:'当前触发模板'}:selected?{category:'当前分类'}:{})},()=>draw());
        const protection=this.field('','选中测试结果中的文字，或输入保护词',null,{maxLength:2000});
        const draw=()=>{
            const source=structuredClone(this.s);
            if(mode.value==='category'){
                if(presetView){source.groups=[];source.ruleGroups=source.ruleGroups.map(g=>({...g,rules:g.rules.filter(r=>triggerPreset(r,g)===this.conditionPreset)}));source.contextual=false;source.sentenceRules=[];}
                else if(this.tab==='保护词')source.protectionGroups=[selected];
                else{source.groups=this.tab==='词库'?[selected]:[];source.ruleGroups=this.tab==='条件规则'?[{...selected,rules:this.items(selected)}]:[];source.contextual=false;source.sentenceRules=[];}
            }
            const result=compile(source).run(input.value,{trace:true,explain:true});output.textContent=result.text;
            state.textContent=`${this.s.enabled?'处理已启用':'总开关已暂停'} · ${result.hits.reduce((n,h)=>n+h.count,0)} 次命中 · ${this.s.protectionGroups.reduce((n,g)=>n+g.terms.filter(t=>t.enabled&&g.enabled).length,0)} 条保护词`;
            inspector.update(input.value,result);
        };
        marked.addEventListener('mouseup',()=>{const selection=window.getSelection();if(selection?.anchorNode&&marked.contains(selection.anchorNode)){protection.value=selection.toString().trim();}});
        body.append(this.row(mode,this.btn('载入最近 AI 回复',()=>{
            const m=this.app.context().chat.findLast(m=>!m.is_user&&!m.is_system&&typeof m.mes==='string');if(!m)throw new Error('当前聊天暂无 AI 回复。');
            input.value=typeof m.extra?.display_text==='string'?m.extra.display_text:m.mes;this.testInput=input.value;draw();
        })),state,this.label('处理前',input),this.label('匹配位置',marked),this.label('处理后',output),inspector.element,
            node('section',{class:'wr-import-card'},node('h4',{},'将文字加入保护词'),protection,this.btn('加入全局保护并重新测试',()=>{
                const text=protection.value.trim();if(!text)throw new Error('请填写需要保留的文字。');
                let g=this.s.protectionGroups.find(g=>g.targets.includes('all'));if(!g){g={id:uid(),name:'全局保护',enabled:true,targets:['all'],terms:[]};this.s.protectionGroups.push(g);}
                const old=g.terms.find(t=>t.text===text);if(old)old.enabled=true;else{if(this.s.protectionGroups.reduce((n,g)=>n+g.terms.length,0)>=5000)throw new Error('保护词数量已达到 5000。');g.terms.push({id:uid(),text,enabled:true});}
                this.save();draw();
            })),node('small',{},'测试使用当前启停状态。条件规则编辑器可单独试用草稿规则。'));
        this.updateTest=draw;draw();
    }
    renderAudit(body){
        const search=this.field('','搜索冲突的原词或分类',v=>draw(v)),results=node('div',{});
        const draw=(query='')=>{
            results.replaceChildren();const issues=literalConflicts(this.s).filter(i=>[i.from,...i.rows.map(r=>r.group)].some(v=>v.includes(query)));
            for(const issue of issues)results.append(node('article',{class:'wr-audit-row wr-conflict-row'},node('b',{},issue.from),...issue.rows.map(r=>this.row(node('span',{},`${r.group} → ${r.action==='replace'?r.to:ACTIONS[r.action]}`),this.btn('定位',()=>{
                const type=r.type==='conditions'?'条件规则':'词库',group=(r.type==='conditions'?this.s.ruleGroups:this.s.groups).find(g=>g.id===r.groupId);
                this.locateResult({type,group,item:group.rules.find(item=>item.id===r.ruleId)});
            }))),node('small',{},issue.rows.some(r=>r.type==='conditions')?'处理顺序：条件规则 → 词库。可通过测试查看共同作用的结果。':`当前采用：${issue.rows.at(-1).group}`)));
            // Identical conditions with different actions are actionable rule conflicts.
            const byCondition=new Map();
            for(const g of this.s.ruleGroups.filter(g=>g.enabled))for(const r of g.rules.filter(r=>r.enabled)){
                const key=JSON.stringify([r.kind,r.kind==='keywords'?[...r.keywords].sort():[r.template,r.prefix,r.suffix,r.min,r.max,r.start,r.end,r.keyword,r.startChars,r.endChars],r.matchMode,r.respectProtection,r.filters??null,r.safeContext]);
                const rows=byCondition.get(key)??[];rows.push({g,r,action:r.inheritAction?g.defaultAction:r.action});byCondition.set(key,rows);
            }
            for(const rows of byCondition.values())if(new Set(rows.map(x=>JSON.stringify([x.action,x.r.to??'']))).size>1&&rows.some(x=>[x.g.name,x.r.name].some(v=>v.includes(query))))results.append(node('article',{class:'wr-audit-row wr-conflict-row'},node('b',{},'相同匹配条件采用不同处理'),...rows.map(({g,r,action})=>this.row(node('span',{},`${g.name} · ${r.name||'规则'} · ${ACTIONS[action]}`),this.btn('定位规则',()=>{this.tab='条件规则';this.view='';this.selected[this.tab]=g.id;this.search='';this.startRule(g,r.kind,r);})))));
            if(!results.childElementCount)results.append(node('div',{class:'wr-empty'},query?'当前搜索范围内没有冲突。':'当前已启用内容中没有发现冲突。'));
        };
        body.append(node('p',{},'检查已启用的分类与条目。相同原词对应不同结果，或相同条件采用不同处理时，会列出来源。'),search,results);draw();
    }
    renderBackup(body){
        const input=node('input',{type:'file',accept:'.json,application/json,text/plain',hidden:true,tabIndex:-1,'aria-label':'JSON 文件'}),preview=node('div',{}),feedback=node('p',{role:'status',class:'wr-import-feedback'});
        const filename=node('span',{class:'wr-import-filename'},'尚未选择文件');
        const mode=this.select('merge','导入方式',{merge:'追加分类',replace:'恢复完整配置'},()=>{});let incoming=null,readVersion=0;
        const parts={groups:true,ruleGroups:true,protectionGroups:true};
        const confirm=this.btn('确认导入',()=>{
            if(!incoming)throw new Error('请先选择文件。');
            if(mode.value==='replace'){
                if(!window.confirm('恢复此文件中的完整配置？当前配置会先下载备份。'))return;
                download(`ST-WordReplacer-before-import-${stamp()}.json`,this.s);this.app.settings=incoming;
            }else{
                const data={...this.s,groups:[...this.s.groups,...(parts.groups?incoming.groups:[])],ruleGroups:[...this.s.ruleGroups,...(parts.ruleGroups?incoming.ruleGroups:[])],protectionGroups:[...this.s.protectionGroups,...(parts.protectionGroups?incoming.protectionGroups:[])]};
                this.app.settings=validateSettings(data);
            }
            this.selected={};this.clipboard=null;this.draft=null;this.selection.clear();this.save();this.render();
            this.body.querySelector('.wr-import-feedback').textContent='导入完成，分类已更新。';
        },{class:'wr-button menu_button wr-primary',disabled:true});
        const reset=()=>{readVersion++;incoming=null;confirm.disabled=true;preview.replaceChildren();};
        const read=async(source,size)=>{
            reset();const version=readVersion;feedback.textContent='正在读取…';
            try{
                if(size>10*1024*1024)throw new Error('文件或文本上限为 10 MB。');
                const text=await source();if(version!==readVersion)return;
                const parsed=validateSettings(JSON.parse(text.replace(/^\uFEFF/,'')));compile(parsed);incoming=parsed;
                Object.assign(parts,{groups:true,ruleGroups:true,protectionGroups:true});
                for(const [key,title,itemKey]of [['groups','词库','rules'],['ruleGroups','条件规则','rules'],['protectionGroups','保护词','terms']])preview.append(this.check(`${title}：${incoming[key].length} 个分类，${incoming[key].reduce((n,g)=>n+g[itemKey].length,0)} 条`,true,v=>parts[key]=v));
                feedback.textContent='读取完成，选择导入方式后确认。';confirm.disabled=false;
            }catch(e){if(version===readVersion){incoming=null;confirm.disabled=true;feedback.textContent=`读取失败：${e.message}`;}}
        };
        const pasted=this.area('','粘贴词库 JSON 内容',()=>{reset();filename.textContent='粘贴内容';feedback.textContent='点击“读取粘贴内容”进行检查。';},7);
        const pastePanel=node('div',{class:'wr-import-paste',hidden:true},pasted,this.btn('读取粘贴内容',()=>read(()=>pasted.value,new Blob([pasted.value]).size)));
        // ST hides native file inputs. Keep a visible button and open the picker
        // synchronously in its click handler, including on mobile browsers.
        const choose=this.btn('选择 JSON 文件',()=>{input.value='';input.click();},{class:'wr-button menu_button wr-primary wr-import-choose'});
        input.addEventListener('change',()=>{
            const file=input.files[0];if(!file)return;
            filename.textContent=file.name;pastePanel.hidden=true;pasted.value='';read(()=>file.text(),file.size);
        });
        const paste=this.btn('粘贴 JSON',()=>{pastePanel.hidden=!pastePanel.hidden;if(!pastePanel.hidden)pasted.focus();});
        const section=this.select('all','导出内容',{all:'完整配置',groups:'全部词库',ruleGroups:'全部条件规则',protectionGroups:'全部保护词'},()=>{});
        body.append(node('section',{class:'wr-import-card'},node('h4',{},'导入'),this.row(choose,paste),input,filename,pastePanel,preview,mode,feedback,confirm),
            node('section',{class:'wr-import-card'},node('h4',{},'导出'),section,this.btn('导出 JSON',()=>{
                const s=structuredClone(this.s);if(section.value!=='all'){
                    if(section.value==='protectionGroups'){
                        const targets=new Set(s.protectionGroups.flatMap(g=>g.targets));s.groups=s.groups.filter(g=>targets.has(g.id));s.ruleGroups=s.ruleGroups.filter(g=>targets.has(g.id));
                    }else{for(const k of ['groups','ruleGroups','protectionGroups'])if(k!==section.value)s[k]=[];}
                    s.exceptions=[];s.sentenceRules=[];s.contextual=false;
                }download(`ST-WordReplacer-${stamp()}.json`,s);
            }),node('small',{},'指定分类的保护词会一并导出对应分类，便于恢复保护范围。')));
    }
    renderSettings(){
        const body=this.body;
        const section=(title,...children)=>node('section',{class:'wr-import-card'},node('h4',{},title),...children);
        const edited=this.check('编辑后生效',this.s.edited,v=>{this.s.edited=v;this.save();});edited.title='保存聊天消息的编辑后，重新应用替换规则。';
        body.append(node('h3',{},'设置'),section('处理哪些消息',this.row(this.check('AI 输出',this.s.assistant,v=>{this.s.assistant=v;this.save();}),this.check('自己的消息',this.s.user,v=>{this.s.user=v;this.save();}))),
            section('生效方式',this.row(this.check('影响显示',this.s.display,v=>{this.s.display=v;this.save();}),this.check('影响模型输入',this.s.prompt,v=>{this.s.prompt=v;this.save();}),edited,this.check('保护《书名》',this.s.protectTitles,v=>{this.s.protectTitles=v;this.save();}),this.check('保护代码块',this.s.protectCode,v=>{this.s.protectCode=v;this.save();}))),
            section('数据与工具',this.row(this.btn('导入 / 导出',()=>this.showView('导入与导出')),this.btn('测试效果',()=>this.showView('测试效果')),
                ...(this.app.beforeMigration?[this.btn('导出升级前配置',()=>download(`ST-WordReplacer-before-v4-${stamp()}.json`,this.app.beforeMigration))]:[]))));
    }
}
