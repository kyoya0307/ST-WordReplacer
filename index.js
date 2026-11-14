import { createSettings, validateSettings, compile, parseBatch, inspectRules, planPaste, createTransfer, pasteTransfer, uid, setReplacement, THEMES } from './engine.js';
import { CONTEXT_RULES, CONTEXT_MATCH_TEXT, createContextOptions, validateContextOptions } from './legacy.js';
import { installRuntime } from './runtime.js';
import { SENTENCE_PRESETS, sentenceTemplate, validateSentenceRules } from './sentences.js';
import { TEMPLATE_SCOPES, templateRule } from './templates.js';

const KEY = 'st_word_replacer';
let settings, runner, selected, dialog, pane, status, search = '', page = 0, tab = '词库';
let historyPlan = null, undo = null, selectedText = '';
let runtime, clipboard=null, selectedRules=new Set(), selectionGroup=null, allSearch='', selectionMode=false;
let settingsPage='作用范围';
let refreshPreview=null;
let refreshConflictBadges=null;
// 旧备份中的备用候选仅作兼容保留，界面和搜索都只使用当前替换值。
const matchesRule=(rule,query)=>[rule.from,rule.to].some(value=>value.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
let contextSearch='', contextInput='', contextTestRule='all';
let sentenceInput='';
let sentenceDraft=null;
const context = () => SillyTavern.getContext();
const node = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [key,value] of Object.entries(attrs)) {
        if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key === 'class') el.className = value;
        else if (key in el) el[key] = value;
        else el.setAttribute(key,value);
    }
    el.append(...children);
    return el;
};
const button = (text, action, attrs = {}) => node('button', {type:'button', class:'menu_button wr-button', onclick:protect(action), ...attrs}, text);
const field = (value, placeholder, action) => node('input', {type:'text',value,placeholder,class:'text_pole',oninput:protect(e=>action(e.target.value))});
function protect(action) {
    return async (...args) => { try { await action(...args); } catch (error) { report(error); } };
}
function report(error) {
    console.error('[ST-WordReplacer]', error);
    if (status) {status.textContent = error.message; status.classList.add('wr-error');}
    globalThis.toastr?.error(error.message, '词汇快捷替换');
}
function remember() {
    runner = compile(settings);
    refreshPreview?.();
    context().extensionSettings[KEY] = settings;
    context().saveSettingsDebounced();
    runtime?.refresh();
    const issues=inspectRules(settings);
    refreshConflictBadges?.(issues);
    if (status) {
        const conflicts=issues.filter(x=>x.kind==='conflict'),duplicates=issues.filter(x=>x.kind==='duplicate');
        status.textContent = `修改已记录 · 自动保存到 ST 设置${conflicts.length?` · ⚠ ${conflicts.length} 个冲突，请到“冲突页”核对`:''}${duplicates.length?` · ${duplicates.length} 个相同重复（仅提示）`:''}`;
        status.classList.remove('wr-error');status.classList.toggle('wr-warn',conflicts.length>0);
    }
}
function checkbox(label, value, action) {
    return node('label', {class:'wr-check'}, node('input',{type:'checkbox',checked:value,onchange:protect(e=>action(e.target.checked))}), label);
}
function group() { return settings.groups.find(g=>g.id===selected) ?? settings.groups[0]; }
function download(name, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
    const link = node('a',{href:url,download:name}); document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g,'-');
function ensureCustom() {
    let g = settings.groups.find(g=>g.id==='custom') ?? settings.groups.at(-1);
    if (!g) {g={id:uid(),name:'我的自定义词库',enabled:true,rules:[]};settings.groups.push(g);}
    return g;
}
function upsert(g, from, to) {
    if (typeof from !== 'string' || !from.trim() || typeof to !== 'string') throw new Error('原词不能为空，替换词必须为文字。');
    if (from.length > 2000 || to.length > 10000) throw new Error('词条过长。');
    const old = g.rules.find(r=>r.from===from);
    if (old) {setReplacement(old,to);old.enabled=true;} else {
        if(settings.groups.reduce((n,x)=>n+x.rules.length,0)>=20000)throw new Error('词条不能超过 20000 条。');
        g.rules.push({id:uid(),from,to,enabled:true});
    }
}
export function openManager(prefill = '') {
    if (!dialog) return;
    tab='词库';selectionMode=false;selectedRules.clear();
    if (prefill) { selectedText = prefill;tab='词库';selected=ensureCustom().id; }
    render();
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop=0;
}
function render() {
    refreshPreview=null;
    refreshConflictBadges=null;
    dialog.dataset.theme=settings.theme;
    pane.replaceChildren();
    const themeKeys=Object.keys(THEMES),nextTheme=()=>themeKeys[(themeKeys.indexOf(settings.theme)+1)%themeKeys.length];
    const describeTheme=()=>{
        const label=`切换配色：当前${THEMES[settings.theme]}，下一项${THEMES[nextTheme()]}`;
        themePicker.title=label;themePicker.setAttribute('aria-label',label);
    };
    const themePicker=button('☼',()=>{
        settings.theme=nextTheme();dialog.dataset.theme=settings.theme;describeTheme();
        context().extensionSettings[KEY]=settings;context().saveSettingsDebounced();
        if(status){status.textContent=`配色已保存：${THEMES[settings.theme]}`;status.classList.remove('wr-error','wr-warn');}
    },{class:'menu_button wr-button wr-theme-picker'});
    describeTheme();
    const top = node('div',{class:'wr-top'},node('div',{class:'wr-title'},node('strong',{},'词汇快捷替换'),
        checkbox('启用替换',settings.enabled,v=>{settings.enabled=v;remember();})),
        node('div',{class:'wr-top-actions'},themePicker,button('×',()=>dialog.close(),{class:'menu_button wr-button wr-close','aria-label':'关闭词库管理',title:'关闭词库管理'})));
    const tabs = node('nav',{class:'wr-tabs','aria-label':'管理页面'},...['词库','句式','冲突','设置'].map(name=>button(name,()=>{
        tab=name;selectionMode=false;selectedRules.clear();render();dialog.scrollTop=0;
    },{class:`menu_button wr-button ${name===tab?'wr-active':''}`,'aria-current':name===tab?'page':'false'})));
    const body = node('div',{class:'wr-body'});
    status = node('div',{class:'wr-status',role:'status','aria-live':'polite'},'自动保存到 ST · 自动替换保留聊天原文');
    pane.append(top,tabs,body,status);
    if (tab==='词库') renderDictionary(body);
    if (tab==='设置') renderSettings(body);
    if (tab==='冲突') renderAudit(body);
    if (tab==='句式') renderContextual(body);
}
function renderSettings(body) {
    const pages=['作用范围','预览与保护','备份与导入','历史消息'];
    const content=node('section',{class:'wr-settings-content'});
    body.append(node('nav',{class:'wr-settings-nav','aria-label':'设置分类'},...pages.map(name=>button(name,()=>{
        settingsPage=name;render();dialog.scrollTop=0;
    },{class:`menu_button wr-button ${settingsPage===name?'wr-active':''}`}))),content);
    if(settingsPage==='预览与保护'){renderPreview(content);return;}
    if(settingsPage==='备份与导入'){renderBackup(content);return;}
    if(settingsPage==='历史消息'){renderHistory(content);return;}
    const controls = node('div',{class:'wr-controls'},
        checkbox('AI 输出',settings.assistant,v=>{settings.assistant=v;remember();}),
        checkbox('自己发出的消息',settings.user,v=>{settings.user=v;remember();}));
    const advanced=node('div',{class:'wr-controls'},
        checkbox('编辑后生效',settings.edited,v=>{settings.edited=v;remember();}),
        checkbox('影响显示',settings.display,v=>{settings.display=v;remember();}),
        checkbox('影响模型输入',settings.prompt,v=>{settings.prompt=v;remember();}),
        checkbox('保护代码块',settings.protectCode,v=>{settings.protectCode=v;remember();}));
    controls.append(button('应用推荐配置',()=>{Object.assign(settings,{enabled:true,assistant:true,user:false,edited:true,display:true,prompt:true,protectCode:true});remember();render();}));
    const explanation=node('p',{class:'wr-explainer'},'自动替换保留聊天文件原文。默认只处理 AI 正文，显示与发送给模型时都生效；编辑后也会刷新。作用范围可按需勾选。');
    const frontendHint=runtime?.nativeFormatting
        ?'含 HTML 或交互界面的消息在重新进入聊天时应用词库改动，避免中断正在运行的界面。'
        :'当前 ST 缺少新版显示接口：含 HTML 或交互界面的消息暂不替换显示，普通消息照常处理。更新 ST 后可同时处理正文与界面消息。';
    content.append(node('h4',{},'处理哪些消息'),controls,node('h4',{},'如何生效'),advanced,explanation,node('p',{class:'wr-explainer'},frontendHint));
}
function renderDictionary(body) {
    body.append(node('div',{class:'wr-section-head wr-library-actions'},
        node('div',{},node('h3',{},'我的词库'),node('small',{},`${settings.groups.length} 个分类 · ${settings.groups.reduce((n,g)=>n+g.rules.length,0)} 条词条`)),
        node('div',{class:'wr-row'},
            button('导入词库',()=>{tab='设置';settingsPage='备份与导入';selectionMode=false;selectedRules.clear();render();dialog.scrollTop=0;},{class:'menu_button wr-button wr-primary'}),
            button('导出备份',()=>download(`ST-WordReplacer-${stamp()}.json`,settings)))));
    const chooseGroup=id=>{selected=id;page=0;search='';selectedRules.clear();render();dialog.scrollTop=0;};
    const newGroup=()=>{
        if(settings.groups.length>=200)throw new Error('分类不能超过 200 个。');
        const name=prompt('新分类名称');if(!name?.trim())return;
        const g={id:uid(),name:name.trim().slice(0,100),enabled:true,rules:[]};settings.groups.push(g);remember();chooseGroup(g.id);
    };
    const sidebar = node('aside',{class:'wr-sidebar'});
    const list = node('div',{class:'wr-group-list'});
    settings.groups.forEach(g=>{
        list.append(node('div',{class:`wr-group ${g.id===group()?.id?'wr-selected':''}`},
            checkbox('',g.enabled,v=>{g.enabled=v;remember();render();}),
            button(`${g.name} (${g.rules.length})`,()=>chooseGroup(g.id),{'aria-current':g.id===group()?.id?'true':'false'})));
        list.lastElementChild.querySelector('input').setAttribute('aria-label',`启用分类 ${g.name}`);
    });
    sidebar.append(node('b',{},'我的分类'),list,button('＋ 新建分类',newGroup),node('small',{},'长词优先。同名原词以靠后的已启用分类为准。'));
    const content=node('section',{class:'wr-content'});body.append(node('div',{class:'wr-layout'},sidebar,content));
    const categorySelect=node('select',{class:'text_pole','aria-label':'当前分类'},...settings.groups.map(g=>node('option',{value:g.id,selected:g.id===group()?.id},`${g.name} · ${g.rules.length} 条${g.enabled?'':' · 已停用'}`)));
    categorySelect.addEventListener('change',()=>chooseGroup(categorySelect.value));
    content.append(node('div',{class:'wr-mobile-categories'},categorySelect,button('＋',newGroup,{'aria-label':'新建分类'})));
    const g=group();
    if(!g){content.append(node('p',{},'请先新建分类。'));return;}
    selected=g.id;
    if(selectionGroup!==g.id){selectionGroup=g.id;selectedRules.clear();}
    const rename=field(g.name,'分类名称',()=>{});
    rename.addEventListener('change',()=>{g.name=rename.value.trim().slice(0,100)||'未命名分类';remember();render();});
    const categoryTools=node('details',{class:'wr-category-tools'},node('summary',{},'分类设置'),node('div',{class:'wr-row'},rename,
        checkbox('启用此分类',g.enabled,v=>{g.enabled=v;remember();render();}),
        button('导出此类',()=>download(`${g.name}.json`,{...structuredClone(settings),groups:[structuredClone(g)]})),
        button('删除分类',()=>{if(!confirm(`删除“${g.name}”及其中 ${g.rules.length} 个词条？`))return;settings.groups=settings.groups.filter(x=>x!==g);selected=null;search='';page=0;selectedRules.clear();remember();render();})),
        node('small',{},'仅同名原词受分类顺序影响：靠后的已启用分类生效。'));
    const moveGroup=direction=>{
        const index=settings.groups.indexOf(g),target=index+direction;
        if(target<0||target>=settings.groups.length)return;
        [settings.groups[index],settings.groups[target]]=[settings.groups[target],g];
        remember();render();
        status.textContent=`“${g.name}”已${direction<0?'上移':'下移'} · 排序已保存；同名词以靠下的已启用分类为准。`;
    };
    const ordering=node('div',{class:'wr-category-order','aria-label':'分类排序'},
        node('small',{},`第 ${settings.groups.indexOf(g)+1} / ${settings.groups.length} 类`),
        button('↑ 上移',()=>moveGroup(-1),{disabled:settings.groups[0]===g,'aria-label':'上移当前分类',title:'上移当前分类；同名词以靠下的已启用分类为准'}),
        button('↓ 下移',()=>moveGroup(1),{disabled:settings.groups.at(-1)===g,'aria-label':'下移当前分类',title:'下移当前分类；同名词以靠下的已启用分类为准'}));
    content.append(node('div',{class:'wr-category-heading'},node('b',{},`${g.name}${g.enabled?'':' · 已停用'}`),ordering,categoryTools));
    const deletionScope=node('select',{class:'text_pole','aria-label':'本分类空替换值的删除范围'},...Object.entries({word:'只删除匹配文字',...TEMPLATE_SCOPES}).map(([value,label])=>node('option',{value,selected:value===(g.deleteScope??'word')},label)));
    deletionScope.addEventListener('change',protect(()=>{g.deleteScope=deletionScope.value;remember();render();}));
    categoryTools.append(node('label',{},'替换词留空时',deletionScope),node('small',{},'仅影响本分类的空替换词条；非空替换和其他分类不变。复制到其他分类后，空替换采用目标分类的删除范围。'));
    if(g.deleteScope&&g.deleteScope!=='word')content.append(node('p',{class:'wr-explainer'},`本分类空替换值：${TEMPLATE_SCOPES[g.deleteScope]}。词条和分类开关仍可分别控制；先删句段，再运行普通替换。`));
    const from=field(selectedText,'原词（必填）',()=>{}); selectedText='';
    const to=field('','替换为（留空即删除）',()=>{});
    content.append(node('div',{class:'wr-row wr-add'},from,node('span',{},'→'),to,button('添加 / 更新',()=>{
        upsert(g,from.value,to.value);remember();render();
    })));
    const table=node('div',{class:'wr-rule-list'});
    refreshConflictBadges=issues=>{
        const byFrom=new Map(issues.map(x=>[x.from,x])),byId=new Map(g.rules.map(r=>[r.id,r]));
        for(const row of table.querySelectorAll('[data-rule-id]')){
            const r=byId.get(row.dataset.ruleId),badge=row.querySelector('.wr-rule-issue');
            const issue=g.enabled&&r?.enabled?byFrom.get(r.from):null;
            badge.hidden=!issue;badge.replaceChildren();
            if(issue?.kind==='conflict')badge.append(button('⚠ 冲突',()=>{allSearch=r.from;tab='冲突';selectionMode=false;selectedRules.clear();render();dialog.scrollTop=0;},{class:'menu_button wr-button wr-conflict',title:'查看当前已启用的冲突规则'}));
            else if(issue)badge.append(node('small',{},'重复'));
        }
    };
    const pager=node('div',{class:'wr-row'});
    const selectionInfo=node('span',{});
    const pastePanel=node('div',{class:'wr-paste-panel'});
    const selectionStatus=()=>{
        selectionInfo.textContent=`已选 ${selectedRules.size} 条${clipboard?.rules.length?` · ${clipboard.mode==='cut'?'待剪切':'已复制'} ${clipboard.rules.length} 条（${clipboard.sourceName}）`:''}`;
        for(const b of batchTools.querySelectorAll('[data-needs-selection]'))b.disabled=!selectedRules.size;
        for(const b of batchTools.querySelectorAll('[data-needs-clipboard]'))b.disabled=!clipboard?.rules.length;
    };
    const capture=mode=>{clipboard=createTransfer(g,selectedRules,mode);pastePanel.replaceChildren();refresh();status.textContent=mode==='cut'?'已标记待剪切。切换分类后粘贴成功才会移除原项；取消或刷新不会删除原词条。':`已复制 ${clipboard.rules.length} 条，现在可切换分类后粘贴。`;};
    const batchTools=node('div',{class:'wr-batch-bar',hidden:!selectionMode,'aria-label':'批量操作'},selectionInfo,node('div',{class:'wr-row'},
        button('全选搜索结果',()=>{g.rules.filter(r=>matchesRule(r,search)).forEach(r=>selectedRules.add(r.id));refresh();}),
        button('清空选择',()=>{selectedRules.clear();refresh();}),
        button('复制所选',()=>capture('copy'),{'data-needs-selection':''}),
        button('剪切所选',()=>capture('cut'),{'data-needs-selection':''}),
        button('清空剪贴内容',()=>{clipboard=null;pastePanel.replaceChildren();refresh();},{'data-needs-clipboard':''}),
        button('粘贴到此类',()=>{
            if(!clipboard?.rules.length)throw new Error('请先在任意分类中复制或剪切词条。');
            if(clipboard.mode==='cut'&&clipboard.sourceId===g.id)throw new Error('请切换到其他分类后粘贴；原词条尚未移除。');
            const pending=clipboard,targetSnapshot=JSON.stringify(g.rules),plan=planPaste(g,pending.rules);
            const policy=node('select',{class:'text_pole'},node('option',{value:'skip'},'冲突：保留现有，跳过复制项'),node('option',{value:'overwrite'},'冲突：用复制项覆盖现有替换词'),node('option',{value:'disabled'},'冲突：新增为停用词条，稍后核对'));
            pastePanel.replaceChildren(node('p',{},`待新增 ${plan.additions.length} 条 · 相同重复 ${plan.duplicates.length} 条（跳过） · 冲突 ${plan.conflicts.length} 条`),
                ...(pending.mode==='cut'?[node('p',{},'剪切：仅移除已完整转入目标的词条。冲突被跳过、停用状态不一致或词条被修改时，原项保留。目标分类的总开关决定移动后是否生效。')]:[]),
                ...plan.conflicts.slice(0,20).map(x=>node('div',{class:'wr-conflict'},`${x.incoming.from}：现有 ${x.existing.map(r=>r.to||'〔删除〕').join(' / ')}；复制项 ${x.incoming.to||'〔删除〕'}（替换配置不同；覆盖会采用复制项的完整配置）`)),policy,
                button('确认粘贴',()=>{
                    if(clipboard!==pending||JSON.stringify(g.rules)!==targetSnapshot)throw new Error('剪贴内容或目标词库已变化，请重新点击粘贴查看预览。');
                    const result=pasteTransfer(settings,g.id,pending,policy.value);
                    if(pending.mode==='cut')clipboard=result.remaining.length?{...pending,rules:result.remaining}:null;
                    remember();render();
                    if(pending.mode==='cut')status.textContent=`已移动 ${result.moved} 条；${result.remaining.length} 条仍保留在来源分类。`;
                }),button('取消粘贴',()=>pastePanel.replaceChildren()));
        },{'data-needs-clipboard':''})));
    const selectionToggle=button(selectionMode?'完成选择':'批量选择',()=>{
        selectionMode=!selectionMode;selectedRules.clear();batchTools.hidden=!selectionMode;pastePanel.replaceChildren();
        selectionToggle.textContent=selectionMode?'完成选择':'批量选择';selectionToggle.setAttribute('aria-pressed',String(selectionMode));refresh();
    },{'aria-pressed':String(selectionMode)});
    const refresh=()=>{
        table.replaceChildren();pager.replaceChildren();
        const filtered=g.rules.filter(r=>matchesRule(r,search));
        const max=Math.max(0,Math.ceil(filtered.length/80)-1);page=Math.min(page,max);
        if(!filtered.length)table.append(node('p',{class:'wr-empty'},search?'没有找到匹配词条。试试其他关键词。':'这个分类还没有词条，在上方添加第一条吧。'));
        table.append(node('div',{class:'wr-rule wr-table-head'},node('span',{},selectionMode?'选择 / 启用':'启用'),node('span',{},'原词'),node('span',{},'替换为 · 留空即删除'),node('span',{},'操作')));
        filtered.slice(page*80,page*80+80).forEach(r=>{
            const pendingCut=clipboard?.mode==='cut'&&clipboard.sourceId===g.id&&clipboard.rules.some(x=>x.id===r.id);
            const replacement=field(r.to,'留空即删除',v=>{setReplacement(r,v);remember();});
            const row=node('div',{class:`wr-rule${pendingCut?' wr-cut-pending':''}`,'data-rule-id':r.id,title:pendingCut?'待剪切：粘贴成功后才移除':''},node('div',{class:'wr-row-checks'},
                ...(selectionMode?[checkbox('选择',selectedRules.has(r.id),v=>{v?selectedRules.add(r.id):selectedRules.delete(r.id);selectionStatus();})]:[]),checkbox('启用',r.enabled,v=>{r.enabled=v;remember();})),
                node('label',{class:'wr-word-field'},node('small',{},'原词'),field(r.from,'原词',v=>{if(!v){status.textContent='原词不能为空，暂时保留之前的原词；请补充或删除此行。';return;}r.from=v;remember();})),
                node('label',{class:'wr-word-field'},node('small',{},'替换为'),replacement),
                node('div',{class:'wr-rule-actions'},node('span',{class:'wr-rule-issue',hidden:true}),
                    button('删除',()=>{g.rules=g.rules.filter(x=>x!==r);selectedRules.delete(r.id);remember();refresh();})));
            row.querySelectorAll('input[type=text]').forEach((input,i)=>input.setAttribute('aria-label',i?'替换为':'原词'));
            row.querySelectorAll('input[type=text]').forEach((input,i)=>input.maxLength=i?10000:2000);
            const original=row.querySelector('input[type=text]');original.addEventListener('blur',()=>{if(!original.value)original.value=r.from;});
            table.append(row);
        });
        pager.append(...(max?[button('上一页',()=>{page=Math.max(0,page-1);refresh();},{disabled:page===0})]:[]),node('small',{},`${filtered.length} 条${max?` · 第 ${page+1}/${max+1} 页`:''}`),...(max?[button('下一页',()=>{page=Math.min(max,page+1);refresh();},{disabled:page===max})]:[]));
        selectionStatus();
        refreshConflictBadges(inspectRules(settings));
    };
    content.append(node('div',{class:'wr-dictionary-toolbar'},field(search,'搜索当前分类的原词 / 替换词',v=>{search=v;page=0;refresh();}),selectionToggle),pastePanel,table,pager);
    const batch=node('textarea',{class:'text_pole',rows:4,placeholder:'每行一条，例如：\n旧称 → 新称\n【草稿标记】 →\n也支持 => 或制表符；# 开头为注释。'});
    content.append(node('details',{},node('summary',{},'批量添加到当前分类'),batch,button('检查并添加',()=>{
        const rules=parseBatch(batch.value);if(!rules.length)throw new Error('没有可添加的词条。');
        rules.forEach(r=>upsert(g,r.from,r.to));remember();render();
    }),node('small',{},'批量格式会去掉两端空格；需要匹配空格时使用单条编辑。')));
    const preview=node('details',{class:'wr-inline-preview'},node('summary',{},'试用与保护词'));
    preview.addEventListener('toggle',()=>{if(preview.open&&preview.childElementCount===1){const view=node('div',{});preview.append(view);renderPreview(view);}});
    content.append(preview,batchTools);
    refresh();
}
function renderContextual(body) {
    const cards=node('div',{class:'wr-context-cards'}),testBox=node('section',{class:'wr-context-test'});
    const input=node('textarea',{class:'text_pole',rows:4,value:contextInput,placeholder:'输入完整句子，检查特殊句式与普通词库的实际效果。'});
    const output=node('pre',{class:'wr-output'}),hits=node('div',{}),testState=node('p',{});
    const mode=node('select',{class:'text_pole','aria-label':'句式测试范围'},node('option',{value:'all'},'按全部配置测试（包括普通词库）'),
        ...CONTEXT_RULES.map(r=>node('option',{value:r.id},`只测：${r.name}`)));
    mode.value=contextTestRule;
    const preview=()=>{
        let testRunner=runner;
        if(contextTestRule!=='all'){
            const isolated=structuredClone(settings);isolated.groups=[];isolated.sentenceRules=[];
            for(const [id,config] of Object.entries(isolated.contextOptions.rules))if(id!==contextTestRule)config.enabled=false;
            testRunner=compile(isolated);
        }
        const result=testRunner.run(contextInput);
        testState.textContent=!settings.enabled?'替换总开关已关闭。':!settings.contextual?'特殊句式总开关已关闭；全配置测试仍可能命中普通词库。':contextTestRule==='all'?'使用当前全部配置；命中列表可区分普通词库与特殊句式。':'仅测试所选规则，仍遵守规则开关、保护词和代码块保护。';
        output.textContent=result.text;
        hits.replaceChildren(...(result.hits.length?result.hits.map(h=>node('div',{class:'wr-hit'},`${h.group}：${h.from} → ${h.to||'〔删除〕'} × ${h.count}`)):[node('small',{},'没有发生替换。可能未匹配、命中保护条件，或相关开关已关闭。')]));
    };
    input.addEventListener('input',()=>{contextInput=input.value;preview();});
    mode.addEventListener('change',()=>{contextTestRule=mode.value;preview();});
    testBox.append(node('h4',{},'句式试用'),mode,input,testState,output,hits);
    const draw=()=>{
        cards.replaceChildren();
        for(const rule of CONTEXT_RULES.filter(r=>[r.name,r.description,r.protection].some(s=>s.includes(contextSearch)))){
            const config=settings.contextOptions.rules[rule.id];
            const replacement=field(config.replacement??'','固定替换文字；留空表示删除整个匹配片段',v=>{config.replacement=v;remember();preview();});
            replacement.disabled=config.replacement===null;
            replacement.setAttribute('aria-label',`${rule.name}的固定替换文字`);
            const action=node('select',{class:'text_pole','aria-label':`${rule.name}的处理方式`},node('option',{value:'original'},'沿用原规则处理方式（推荐）'),node('option',{value:'fixed'},'改为固定文字（整个匹配片段）'));
            action.value=config.replacement===null?'original':'fixed';
            action.addEventListener('change',protect(()=>{config.replacement=action.value==='original'?null:replacement.value;replacement.disabled=config.replacement===null;remember();preview();}));
            cards.append(node('article',{class:'wr-context-card','data-context-id':rule.id},
                node('div',{class:'wr-row'},checkbox(rule.name,config.enabled,v=>{config.enabled=v;remember();preview();}),node('small',{},rule.stage==='before'?'词库之前':'词库之后')),
                node('p',{},rule.description),node('small',{},`保护条件：${rule.protection}`),node('p',{class:'wr-rule-description'},`可试用文本：${rule.sample}`),
                node('details',{},node('summary',{},'调整处理方式'),node('p',{},`识别范围：${CONTEXT_MATCH_TEXT[rule.id]}`),node('p',{},`默认：${rule.action}`),action,replacement,
                    node('small',{},'固定文字会替换整个命中片段，包括匹配到的主语或前缀；不解析 $1 等正则写法。匹配和保护条件继续有效。'),
                    button('恢复本项默认',()=>{settings.contextOptions.rules[rule.id]={enabled:true,replacement:null};remember();draw();preview();})),
                button('载入保护示例并测试',()=>{contextInput=rule.sample;input.value=contextInput;contextTestRule=rule.id;mode.value=rule.id;preview();testBox.scrollIntoView?.({block:'nearest'});})))
        }
        if(!cards.childElementCount)cards.append(node('p',{},'没有符合搜索条件的句式。'));
    };
    const nouns=node('textarea',{class:'text_pole',rows:5,value:settings.contextOptions.nouns.join('\n'),'aria-label':'名词保护表',placeholder:'每行一个名词，按普通文字匹配'});
    const verbs=field(settings.contextOptions.verbs,'动作保护字：每个字独立生效',v=>{
        settings.contextOptions=validateContextOptions({...settings.contextOptions,verbs:v.replace(/\s/g,'')});remember();draw();preview();
    });
    verbs.setAttribute('aria-label','动作保护字');
    nouns.addEventListener('input',protect(()=>{
        settings.contextOptions=validateContextOptions({...settings.contextOptions,nouns:nouns.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)});remember();draw();preview();
    }));
    const advanced=node('details',{class:'wr-advanced'},node('summary',{},'内置句式与保护设置（进阶）'),
        node('p',{},'这里是原有的 7 组固定规则。一般保留当前设置即可；需要改它们的处理方式时再展开。下方的示例会展示哪些普通表达应当保留。'),
        field(contextSearch,'搜索句式名称、用途或保护条件',v=>{contextSearch=v;draw();}),cards,
        node('details',{},node('summary',{},'调整亲属语境保护表'),
            node('p',{},'名词保护表用于“带去的句式”和“亲属语境判断”：匹配片段后紧接这些名词时，跳过相应规则。'),nouns,
            node('p',{},'动作保护字仅用于“亲属语境判断”：匹配片段前紧接任一字时跳过。每个字单独生效，不是短语表。'),verbs,
            button('恢复保护表默认值',()=>{const defaults=createContextOptions();settings.contextOptions.nouns=defaults.nouns;settings.contextOptions.verbs=defaults.verbs;remember();render();})),
        node('p',{},'保护条件只约束对应规则，其他句式和普通词库仍会继续处理。需要某段文字始终保持原样时，请到“预览与保护”添加完整保护词。'),testBox,
        node('small',{},'默认执行顺序与原规则一致；这些是文字模式判断，不能理解所有叙事语境。请同时测试希望替换和希望保留的句子。'));
    body.append(node('div',{class:'wr-section-head'},node('div',{},node('h3',{},'按句子删内容'),node('p',{},'选择一个例子，填入关键词，先看效果再保存。')),
        checkbox('启用特殊句式',settings.contextual,v=>{settings.contextual=v;remember();render();})),
        ...(!settings.enabled||!settings.contextual?[node('p',{class:'wr-explainer'},'句式处理已暂停。下面仍可试用；要用于聊天，请同时开启“启用替换”和“启用特殊句式”。')]:[]),
        renderSentenceRules(),advanced);
    draw();preview();
}
function renderSentenceRules() {
    const panel=node('section',{class:'wr-sentences'});
    const examples=[
        {title:'含某个词就删',caption:'词表里任意一个词出现，就删它所在的分句。',keywords:['草稿标记'],matchMode:'any',scope:'clause',respectProtection:true,input:'她点头，草稿标记出现在这里。',output:'她点头。'},
        {title:'两个词同句出现',caption:'不分先后，逗号隔开也算；只出现一个不触发。',keywords:['声音','平'],matchMode:'all',scope:'clause',respectProtection:false,input:'她点头，声音传来，语调平静。',output:'她点头。'},
        {title:'命中就删整句',caption:'连同一句里的其他分句一起删，到句末为止。',keywords:['重复说明'],matchMode:'any',scope:'sentence',respectProtection:true,input:'她进门，重复说明了一遍。她坐下。',output:'她坐下。'},
    ];
    const parseTerms=value=>value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const humanSummary=rule=>`${rule.matchMode==='all'?'同一句内全部出现':'出现任意一个词'} → ${rule.scope==='sentence'?'删除整句话':rule.matchMode==='all'?'删掉这些词所在的分句及中间内容':'删除这个词所在的分句'}`;
    const titleFor=rule=>rule.name||rule.keywords?.join(' + ')||rule.keyword;
    const editor=node('div',{class:'wr-editor-host'}),list=node('div',{class:'wr-template-list'}),count=node('small',{});
    const allPreview=node('details',{class:'wr-advanced'},node('summary',{},'用一段话检查全部规则'));
    const input=node('textarea',{class:'text_pole',rows:4,value:sentenceInput,'aria-label':'全部规则测试文本',placeholder:'粘贴完整段落，查看所有已保存规则的效果。'});
    const marked=node('div',{class:'wr-output wr-sentence-highlight'}),output=node('pre',{class:'wr-output'}),note=node('p',{});
    const markResult=(container,text,result)=>{
        container.replaceChildren();let pos=0;
        for(const span of result.deletions??[]){container.append(document.createTextNode(text.slice(pos,span.start)),node('mark',{title:`将删除：${span.keywords.join('、')}`},text.slice(span.start,span.end)));pos=span.end;}
        container.append(document.createTextNode(text.slice(pos)));
    };
    const preview=()=>{
        const result=runner.run(sentenceInput);markResult(marked,sentenceInput,result);output.textContent=result.text||(sentenceInput?'（全部删除）':'');
        note.textContent=!settings.enabled?'替换总开关已关闭。':`划线的 ${result.deletions?.length??0} 处会删除；结果同时应用普通词库和已启用的内置句式。`;
    };
    input.addEventListener('input',()=>{sentenceInput=input.value;preview();});
    allPreview.append(node('p',{},'这里测试已保存的配置，不会改写聊天。'),button('载入最新 AI 回复',()=>{
        const message=context().chat.findLast(m=>!m.is_user&&!m.is_system&&typeof m.mes==='string');
        if(!message)throw new Error('当前聊天没有 AI 正文。');sentenceInput=message.mes;input.value=sentenceInput;preview();
    }),input,note,marked,node('b',{},'处理后'),output);
    const beginEdit=(rule=null)=>{
        sentenceDraft=rule?{id:rule.id??null,name:rule.name??rule.title??'',keywords:rule.keywords.join('\n'),matchMode:rule.matchMode,scope:rule.scope,respectProtection:rule.respectProtection!==false,enabled:rule.enabled!==false,test:rule.input??''}
            :{id:null,name:'',keywords:'',matchMode:'any',scope:'clause',respectProtection:true,enabled:true,test:''};
        drawEditor();editor.scrollIntoView?.({block:'start',behavior:'smooth'});
    };
    const drawEditor=()=>{
        editor.replaceChildren();if(!sentenceDraft)return;
        const draft=sentenceDraft;
        const form=node('section',{class:'wr-rule-editor'});
        const words=node('textarea',{class:'text_pole',rows:3,value:draft.keywords,'aria-label':'规则关键词',placeholder:'每行写一个词，例如：\n声音\n平'});
        const match=node('select',{class:'text_pole','aria-label':'怎样才触发'},node('option',{value:'any'},'任意一个词出现就触发'),node('option',{value:'all'},'所有词在同一句出现才触发'));match.value=draft.matchMode;
        const scope=node('select',{class:'text_pole','aria-label':'删除多少'},node('option',{value:'clause'},'只删命中的分句（逗号隔开的部分）'),node('option',{value:'sentence'},'删除整句话（直到句末）'));scope.value=draft.scope;
        const name=field(draft.name,'可选，例如：声音描写',value=>{draft.name=value;});name.setAttribute('aria-label','规则名称');
        const protection=checkbox('遇到保护词或代码块时跳过',draft.respectProtection,v=>{draft.respectProtection=v;tryDraft();});
        const test=node('textarea',{class:'text_pole',rows:4,value:draft.test,'aria-label':'当前规则测试文本',placeholder:'在这里写一句话，边改边看结果。'});
        const explanation=node('p',{class:'wr-rule-description'}),testStatus=node('small',{role:'status'});
        const deletion=node('div',{class:'wr-output wr-sentence-highlight'}),after=node('pre',{class:'wr-output wr-result'});
        const save=button(draft.id?'保存修改':'保存并启用',()=>{
            const rule=validateSentenceRules([{id:draft.id??uid(),...templateRule(parseTerms(draft.keywords),draft.matchMode,draft.scope),name:draft.name,respectProtection:draft.respectProtection,enabled:draft.id?draft.enabled:true}])[0];
            const index=settings.sentenceRules.findIndex(r=>r.id===draft.id);
            if(draft.id&&index<0)throw new Error('这条规则已不存在，请重新选择。');
            const next=[...settings.sentenceRules];if(index>=0)next[index]=rule;else next.push(rule);
            settings.sentenceRules=validateSentenceRules(next);sentenceDraft=null;remember();drawEditor();drawList();preview();list.scrollIntoView?.({block:'nearest'});
        },{class:'menu_button wr-button wr-primary'});
        const tryDraft=()=>{
            const keywords=parseTerms(draft.keywords);save.disabled=!keywords.length;
            explanation.textContent=keywords.length?humanSummary(draft):'先写下想删掉的关键词，再选择触发方式和删除范围。';
            try {
                if(!keywords.length){deletion.textContent=draft.test;after.textContent=draft.test;testStatus.textContent='填写关键词后，这里会自动显示效果。';return;}
                const isolated=structuredClone(settings);isolated.enabled=true;isolated.contextual=true;isolated.groups=[];
                for(const config of Object.values(isolated.contextOptions.rules))config.enabled=false;
                isolated.sentenceRules=[{...templateRule(keywords,draft.matchMode,draft.scope),respectProtection:draft.respectProtection}];
                const result=compile(isolated).run(draft.test);markResult(deletion,draft.test,result);after.textContent=result.text||(draft.test?'（全部删除）':'');
                testStatus.textContent=!draft.test?'输入一句话，或点“生成测试句”。':result.deletions?.length?`会删除 ${result.deletions.length} 处，划线部分包含要移除的标点。`:'没有触发：检查关键词是否齐全、是否在同一句，或是否命中保护词。';
            } catch(error){save.disabled=true;testStatus.textContent=error.message;deletion.textContent=draft.test;after.textContent='';}
        };
        words.addEventListener('input',()=>{draft.keywords=words.value;tryDraft();});
        match.addEventListener('change',()=>{draft.matchMode=match.value;tryDraft();});
        scope.addEventListener('change',()=>{draft.scope=scope.value;tryDraft();});
        test.addEventListener('input',()=>{draft.test=test.value;tryDraft();});
        const formFields=node('div',{class:'wr-template-form'},
            node('label',{},node('b',{},'1 · 遇到哪些词？'),node('small',{},'每行一个。填普通文字，不需要正则。'),words),
            node('label',{},'怎样才触发',match),node('label',{},node('b',{},'2 · 删除多少？'),scope),explanation,
            node('details',{class:'wr-more-options'},node('summary',{},'更多设置：名称与保护'),node('label',{},'规则名称',name),protection,node('small',{},'取消勾选后，即使命中保护词或代码块也会删除。')));
        const sandbox=node('div',{class:'wr-rule-sandbox'},node('div',{class:'wr-section-head'},node('b',{},'3 · 先试一句'),button('生成测试句',()=>{
            const terms=parseTerms(draft.keywords);draft.test=terms.length?`保留开头，${draft.matchMode==='all'?terms.join('，'):terms[0]}，保留结尾。`:examples[0].input;test.value=draft.test;tryDraft();
        })),test,node('small',{},'只试当前规则；保存后按总开关生效。'),node('b',{},'将删除（划线部分）'),deletion,node('b',{},'处理后'),after,testStatus);
        form.append(node('div',{class:'wr-section-head'},node('h4',{},draft.id?'编辑删除规则':'新增删除规则'),node('span',{class:'wr-badge'},'尚未保存')),
            node('div',{class:'wr-editor-grid'},formFields,sandbox),
            node('div',{class:'wr-editor-actions'},button('取消',()=>{sentenceDraft=null;drawEditor();}),save));editor.append(form);tryDraft();
    };
    const drawList=()=>{
        const rules=settings.sentenceRules.filter(r=>r.keywords);count.textContent=`${rules.length} 条规则 · ${rules.filter(r=>r.enabled).length} 条开启`;
        list.replaceChildren();
        if(!rules.length)list.append(node('div',{class:'wr-empty'},node('b',{},'还没有自定义删除规则'),node('small',{},'从下面的例子开始，修改关键词后保存即可。')));
        for(const rule of rules){
            const card=node('article',{class:`wr-sentence-rule wr-template-rule${rule.enabled?'':' wr-rule-off'}`},
                node('div',{class:'wr-section-head'},checkbox(titleFor(rule),rule.enabled,v=>{rule.enabled=v;if(sentenceDraft?.id===rule.id)sentenceDraft.enabled=v;remember();drawList();preview();}),node('span',{class:'wr-badge'},rule.scope==='sentence'?'删整句':'删分句')),
                node('div',{class:'wr-keyword-chips'},...rule.keywords.slice(0,8).map(word=>node('span',{},word)),...(rule.keywords.length>8?[node('small',{},`另 ${rule.keywords.length-8} 个词`)]:[])),
                node('p',{class:'wr-rule-description'},humanSummary(rule)),
                node('div',{class:'wr-section-head'},node('small',{},rule.respectProtection?'遵守保护词和代码块保护':'命中就删，不受保护词和代码块保护限制'),node('div',{class:'wr-row'},
                    button('编辑 / 试用',()=>beginEdit(rule)),button('删除',()=>{
                        settings.sentenceRules=settings.sentenceRules.filter(r=>r!==rule);if(sentenceDraft?.id===rule.id){sentenceDraft=null;drawEditor();}remember();drawList();preview();
                    },{'aria-label':`删除规则：${titleFor(rule)}`}))));list.append(card);
        }
    };
    const gallery=node('div',{class:'wr-example-grid'},...examples.map((example,i)=>{
        const card=button('',()=>beginEdit(example),{class:'menu_button wr-button wr-example-card','aria-label':`使用示例：${example.title}`});
        card.append(node('span',{class:'wr-example-number'},`示例 ${i+1}`),node('strong',{},example.title),node('small',{},example.caption),
            node('span',{class:'wr-example-words'},example.keywords.join(' ＋ ')),
            node('span',{class:'wr-example-before'},example.input),node('span',{class:'wr-example-after'},`→ ${example.output}`),node('span',{class:'wr-example-use'},'用这个例子 ›'));return card;
    }));
    panel.append(node('div',{class:'wr-section-head wr-list-heading'},node('div',{},node('h4',{},'我的删除规则'),count),button('＋ 新增规则',()=>beginEdit(),{class:'menu_button wr-button wr-primary'})),list,editor,
        node('h4',{},'从示例新建'),gallery,node('small',{class:'wr-gallery-note'},'点示例只会填入编辑区，保存后才生效。'),
        node('details',{class:'wr-advanced'},node('summary',{},'逗号、句号和引号会怎么处理？'),node('div',{class:'wr-punctuation-examples'},
            node('p',{},'删句首：草稿标记，后文。 → 后文。'),node('p',{},'删中间：前文，草稿标记，后文。 → 前文，后文。'),node('p',{},'删句尾：前文，草稿标记。 → 前文。')),
            node('small',{},'逗号分开分句；句号、问号、感叹号、分号、省略号和换行分开句子。中英文标点均支持。保留换行；删掉整句时连句末标点一起删；只删一部分时保留成对引号和括号。英文点号也会分句。')),allPreview);
    const legacy=node('details',{class:'wr-advanced'},node('summary',{},`旧版边界规则（${settings.sentenceRules.filter(r=>!r.keywords).length}）`),node('p',{},'保留旧版的自定义标点行为。新建规则建议使用上面的示例。'));
    for(const rule of settings.sentenceRules.filter(r=>!r.keywords)){
        const term=field(rule.keyword,'包含的关键词',()=>{});term.setAttribute('aria-label','句段关键词');
        const starts=field(rule.startChars,'起点标点',()=>{});starts.maxLength=100;
        const ends=field(rule.endChars,'结束标点',()=>{});ends.maxLength=100;
        legacy.append(node('article',{class:'wr-sentence-rule'},checkbox('启用这条旧规则',rule.enabled,v=>{rule.enabled=v;remember();preview();}),
            node('div',{class:'wr-template-form'},node('label',{},'关键词',term),node('label',{},'从这些标点之后开始',starts),node('label',{},'遇到这些标点结束',ends)),
            button('保存旧规则',()=>{Object.assign(rule,validateSentenceRules([{...rule,keyword:term.value.trim(),startChars:starts.value,endChars:ends.value}])[0]);remember();preview();}),
            button('删除旧规则',()=>{settings.sentenceRules=settings.sentenceRules.filter(r=>r!==rule);remember();render();})));
    }
    const term=field('','关键词',()=>{}),preset=node('select',{class:'text_pole','aria-label':'旧版新规则范围'},...Object.entries(SENTENCE_PRESETS).map(([value,label])=>node('option',{value},label)));
    legacy.append(node('div',{class:'wr-row'},term,preset,button('添加旧版边界规则',()=>{settings.sentenceRules=validateSentenceRules([...settings.sentenceRules,{id:uid(),...sentenceTemplate(term.value.trim(),preset.value)}]);remember();render();})));
    panel.append(legacy);drawEditor();drawList();preview();refreshPreview=preview;return panel;
}

function renderAudit(body) {
    const results=node('div',{}),summary=node('p',{});
    const targetText=(rule,scope)=>rule.to||`〔${scope==='clause'?'删除分句':scope==='sentence'?'删除整句':'删除文字'}〕`;
    let auditPage=0;
    const draw=()=>{
        const issues=inspectRules(settings),byFrom=new Map(issues.map(x=>[x.from,x]));
        const conflicts=issues.filter(x=>x.kind==='conflict');
        summary.textContent=`当前已启用的词库：${conflicts.length} 个冲突原词。`;
        const rows=settings.groups.flatMap(g=>g.rules.map(r=>({g,r,issue:byFrom.get(r.from)}))).filter(({g,r,issue})=>
            g.enabled&&r.enabled&&issue?.kind==='conflict'&&(g.name.toLocaleLowerCase().includes(allSearch.toLocaleLowerCase())||matchesRule(r,allSearch)));
        const pages=Math.max(1,Math.ceil(rows.length/60));auditPage=Math.min(auditPage,pages-1);
        results.replaceChildren(node('p',{},rows.length?`检索到 ${rows.length} 条冲突词条 · 第 ${auditPage+1}/${pages} 页`:conflicts.length?'当前搜索没有匹配的冲突；清空搜索可查看全部冲突。':'没有发现冲突。'));
        rows.slice(auditPage*60,auditPage*60+60).forEach(({g,r,issue})=>{
            results.append(node('div',{class:'wr-audit-row wr-conflict-row'},
                node('b',{},`${r.from} → ${targetText(r,g.deleteScope)}`),node('small',{},`${g.name} · 启用 · ⚠ 冲突`),
                ...(issue?[node('small',{},issue.winner?`当前生效：${issue.winner.group} → ${targetText(issue.winner,issue.winner.deleteScope)}`:'当前没有启用项')]:[]),
                button('定位到分类',()=>{selected=g.id;search=r.from;page=0;tab='词库';render();})));
        });
        if(pages>1)results.append(node('div',{class:'wr-row'},button('上一页',()=>{auditPage=Math.max(0,auditPage-1);draw();}),button('下一页',()=>{auditPage=Math.min(pages-1,auditPage+1);draw();})));
    };
    body.append(node('p',{},'只检查同时启用的分类和词条。相同原词对应不同的替换词或删除范围时才显示冲突；停用项和完全相同的重复项不列出。'),
        field(allSearch,'搜索全部分类、原词、替换词',v=>{allSearch=v;auditPage=0;draw();}),summary,results);draw();
}
function renderPreview(body) {
    const input=node('textarea',{class:'text_pole',rows:7,placeholder:'粘贴一段文字，查看替换结果；不会修改聊天。'});
    const output=node('pre',{class:'wr-output'});
    const hits=node('div',{});
    const conflictSummary=node('p',{});
    const preview=()=>{
        const result=runner.run(input.value);output.textContent=result.text;
        conflictSummary.textContent=runner.conflicts.length?`⚠ 已启用词库存在不同替换：${runner.conflicts.join('、')}，可在冲突页中核对。`:'当前已启用的词库没有冲突。';
        hits.replaceChildren(node('b',{},`命中 ${result.hits.reduce((n,h)=>n+h.count,0)} 次`),
            ...result.hits.map(h=>node('div',{class:'wr-hit'},`${h.from} → ${h.to||'〔删除〕'} · ${h.group} × ${h.count}`)));
    };
    input.addEventListener('input',preview);
    refreshPreview=preview;
    const exceptions=node('textarea',{class:'text_pole',rows:4,value:settings.exceptions.join('\n'),placeholder:'每行一个保护词，完整词语保持不变。例：小三花'});
    exceptions.addEventListener('input',protect(()=>{settings.exceptions=[...new Set(exceptions.value.split(/\r?\n/).filter(Boolean))];remember();preview();}));
    body.append(node('p',{},'替换结果不会被同一次词库匹配再次处理；重复原词以后面的分类为准。特殊句式规则仍在词库前后处理。'),
        input,node('b',{},'替换结果'),output,hits,node('h4',{},'保护词'),exceptions,
        node('small',{},'普通替换遵守保护词和代码块保护；句式模板可单独取消保护。普通文本中的名字、链接等仍可能被单字规则影响。'),
        conflictSummary);
    preview();
}
function renderBackup(body) {
    const file=node('input',{type:'file',accept:'.json,application/json',hidden:true,'aria-label':'词库 JSON 文件'});
    const chooseFile=button('选择 JSON 文件',()=>file.click());
    const filename=node('span',{class:'wr-import-filename'},'尚未选择文件'),feedback=node('p',{class:'wr-import-feedback',role:'status','aria-live':'polite'});
    const mode=node('select',{class:'text_pole','aria-label':'导入方式'},node('option',{value:'merge'},'追加为新分类（保留当前设置）'),node('option',{value:'replace'},'用备份覆盖全部设置（包含句式）'));
    const help=node('small',{});
    const showMode=()=>{help.textContent=mode.value==='merge'?'只追加分类和保护词。不会导入备份中的句式规则、配色和开关。':'恢复整套词库、句式规则、配色和开关，并替换当前配置。建议先导出当前备份。';};
    mode.addEventListener('change',showMode);showMode();
    const apply=button('导入 JSON',async()=>{
            const f=file.files[0];if(!f)throw new Error('请先选择 JSON 文件。');
            const importMode=mode.value;
            apply.disabled=true;chooseFile.disabled=true;file.disabled=true;mode.disabled=true;feedback.classList.remove('wr-error');feedback.textContent='正在读取词库…';
            try {
                if(f.size>10*1024*1024)throw new Error('文件不能超过 10 MB。');
                const imported=validateSettings(JSON.parse((await f.text()).replace(/^\uFEFF/,'')));
                if(importMode==='replace'&&!confirm('覆盖当前全部设置？建议先导出备份。')){feedback.textContent='已取消，当前词库未改变。';return;}
                const next=importMode==='replace'?imported:validateSettings({...settings,groups:[...settings.groups,...imported.groups],exceptions:[...new Set([...settings.exceptions,...imported.exceptions])]});
                compile(next); // Check rule execution before replacing the current settings.
                settings=next;selected=null;search='';page=0;sentenceDraft=null;clipboard=null;selectedRules.clear();remember();render();status.textContent='导入完成。';
                const result=node('div',{class:'wr-import-success',role:'status'},node('b',{},'词库已导入'),node('small',{},`已读取 ${imported.groups.length} 个分类、${imported.groups.reduce((n,g)=>n+g.rules.length,0)} 条词条。${importMode==='merge'?'已追加到现有分类，句式配置未改变。':'词库与句式配置已一并恢复。'}`),
                    button('查看词库',()=>{tab='词库';render();dialog.scrollTop=0;},{class:'menu_button wr-button wr-primary'}));
                pane.querySelector('.wr-settings-content').prepend(result);dialog.scrollTop=0;
            } catch(error){feedback.textContent=`导入失败：${error.message}`;feedback.classList.add('wr-error');throw error;}
            finally {apply.disabled=!file.files.length;chooseFile.disabled=false;file.disabled=false;mode.disabled=false;}
        },{class:'menu_button wr-button wr-primary',disabled:true});
    file.addEventListener('change',()=>{filename.textContent=file.files[0]?.name??'尚未选择文件';feedback.textContent='';apply.disabled=!file.files.length;});
    body.append(node('div',{class:'wr-section-head'},node('div',{},node('h3',{},'导入词库'),node('p',{},'从 JSON 文件加载词库。导入前会校验格式。'))),
        node('section',{class:'wr-import-card'},
            node('h4',{},'1 · 选择文件'),node('div',{class:'wr-import-file'},chooseFile,filename,file),
            node('h4',{},'2 · 选择导入方式'),mode,help,
            node('h4',{},'3 · 确认导入'),apply,feedback),
        node('section',{class:'wr-import-card'},node('h4',{},'导出备份'),node('p',{},'保存全部分类、词条、保护词、句式规则、配色和开关，之后可重新导入。'),button('导出全部词库与设置',()=>download(`ST-WordReplacer-${stamp()}.json`,settings))),
        node('details',{class:'wr-advanced'},node('summary',{},'恢复原始词库'),button('恢复原始词库（先导出当前备份）',()=>{
            if(!confirm('恢复原始 124 条词库和默认开关？当前设置会先下载备份。'))return;
            download(`ST-WordReplacer-before-reset-${stamp()}.json`,settings);settings=createSettings();selected=null;search='';page=0;sentenceDraft=null;selectedRules.clear();remember();render();
        })),node('small',{},'支持本扩展导出的 JSON 词库备份；脚本型 JSON 不在此处导入，也不会执行其中的代码。'));
}
function renderHistory(body) {
    const user=node('input',{type:'checkbox'});
    const result=node('div',{});
    const apply=button('应用本次预览',async()=>{
        const c=context();
        if(!historyPlan || historyPlan.chat!==c.chat || historyPlan.chatId!==c.getCurrentChatId())throw new Error('聊天已切换，请重新预览。');
        if(historyPlan.settings!==JSON.stringify(settings))throw new Error('词库已改变，请重新预览。');
        if(c.streamingProcessor && !c.streamingProcessor.isFinished)throw new Error('请等待回复生成结束。');
        for(const row of historyPlan.rows)if(c.chat[row.id]!==row.message||row.message.mes!==row.original||row.message.swipe_id!==row.swipeId)throw new Error('消息已改变，请重新预览。');
        if(!historyPlan.rows.length)return;
        if(!confirm(`将改写当前聊天的 ${historyPlan.rows.length} 条消息，并下载改写前正文备份。继续？`))return;
        download(`ST-WordReplacer-chat-before-${stamp()}.json`,{type:'st-word-replacer-message-backup',chatId:historyPlan.chatId,created:new Date().toISOString(),messages:historyPlan.rows.map(r=>({id:r.id,original:r.original,replacement:r.replacement,swipeId:r.swipeId,originalSwipe:r.originalSwipe}))});
        const records=[];
        for(const row of historyPlan.rows){
            row.message.mes=row.replacement;
            if(row.originalSwipe!==undefined)row.message.swipes[row.swipeId]=row.replacement;
            c.updateMessageBlock(row.id,row.message);records.push(row);
        }
        undo={chat:c.chat,chatId:c.getCurrentChatId(),records};historyPlan=null;apply.disabled=true;
        await c.saveChat();status.textContent=`已处理 ${records.length} 条消息；可在本页撤销。`;
    },{disabled:true});
    body.append(node('p',{class:'wr-conflict'},'此页是手动永久改写工具，会修改聊天文件原文。日常自动替换无需使用此页；它只改变显示与模型输入。确认应用前会下载原文备份。'),
        node('label',{class:'wr-check'},user,'同时处理自己的消息（默认只处理 AI）'),
        button('预览当前聊天',()=>{
            const c=context();if(c.streamingProcessor && !c.streamingProcessor.isFinished)throw new Error('请等待回复生成结束。');
            const rows=[];
            c.chat.forEach((message,id)=>{
                if(message.is_system || (message.is_user&&!user.checked))return;
                const original=message.mes;if(typeof original!=='string')return;
                const replacement=runner.run(original).text;if(original===replacement)return;
                const swipeId=message.swipe_id;
                rows.push({id,message,original,replacement,swipeId,originalSwipe:message.swipes?.[swipeId]});
            });
            historyPlan={chat:c.chat,chatId:c.getCurrentChatId(),rows,settings:JSON.stringify(settings)};apply.disabled=!rows.length;
            result.replaceChildren(node('p',{},`将改变 ${rows.length} 条消息。显示前 50 条，应用时处理全部预览结果。`),...rows.slice(0,50).map(r=>node('details',{},node('summary',{},`第 ${r.id+1} 条消息`),node('pre',{class:'wr-output'},r.original),node('pre',{class:'wr-output'},r.replacement))));
        }),apply,button('撤销上次历史处理',async()=>{
            const c=context();if(!undo||undo.chat!==c.chat||undo.chatId!==c.getCurrentChatId())throw new Error('没有可撤销的本次会话记录。');
            for(const r of undo.records)if(c.chat[r.id]!==r.message||r.message.mes!==r.replacement||r.message.swipe_id!==r.swipeId)throw new Error('消息已发生变化，不能直接撤销；原正文见下载的备份。');
            for(const r of undo.records){r.message.mes=r.original;if(r.originalSwipe!==undefined)r.message.swipes[r.swipeId]=r.originalSwipe;c.updateMessageBlock(r.id,r.message);}
            await c.saveChat();undo=null;historyPlan=null;apply.disabled=true;status.textContent='已撤销上次历史处理。';
        }),result);
}
function installAPI() {
    globalThis.STWordReplacer=Object.freeze({
        open:openManager,
        preview:text=>runner.run(String(text)),
        export:()=>structuredClone(settings),
        upsert:({category='我的自定义词库',from,to=''})=>{
            let g=settings.groups.find(x=>x.name===category);
            if(!g){if(settings.groups.length>=200)throw new Error('分类不能超过 200 个。');g={id:uid(),name:String(category).trim().slice(0,100)||'未命名分类',enabled:true,rules:[]};settings.groups.push(g);}
            upsert(g,from,to);remember();if(dialog.open)render();return true;
        },
        import:data=>{settings=validateSettings(data);selected=null;search='';page=0;sentenceDraft=null;selectedRules.clear();remember();if(dialog.open)render();},
    });
}
// 与 ST 内置 caption 扩展相同的设置标题和魔法棒条目结构。
export function mountEntrypoints() {
    const host=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');
    if(host&&!document.getElementById('wr-settings')){
        const header=node('div',{class:'inline-drawer-toggle inline-drawer-header'},
            node('b',{},'词汇快捷替换'),
            node('div',{class:'inline-drawer-icon fa-solid fa-circle-chevron-down down'}));
        const content=node('div',{class:'inline-drawer-content'},
            button('打开词库管理',()=>openManager()),
            node('small',{},'v1.1.7 · 分类词库 · 句段模板 · 冲突检查'),
            node('small',{},'也可从聊天输入区旁的魔法棒打开词库管理。'));
        host.append(node('div',{id:'wr-settings',class:'wr-settings'},node('div',{class:'inline-drawer'},header,content)));
    }
    const menu=document.getElementById('extensionsMenu');
    if(menu&&!document.getElementById('wr-wand-container')){
        const item=node('div',{id:'wr-wand-open',class:'list-group-item flex-container flexGap5',role:'button',tabIndex:0,title:'打开词汇快捷替换',
            onclick:protect(()=>openManager()),onkeydown:protect(e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openManager();}})},
            node('div',{class:'fa-solid fa-book extensionsMenuExtensionButton','aria-hidden':'true'}),
            node('span',{},'词汇快捷替换'));
        menu.append(node('div',{id:'wr-wand-container',class:'extension_container'},item));
        // ST 在没有菜单项时会隐藏魔法棒；新增条目后恢复其可见性。
        const wand=document.getElementById('extensionsMenuButton');if(wand)wand.style.display='flex';
    }
    return !!document.getElementById('wr-settings')&&!!document.getElementById('wr-wand-container');
}
export function initialize() {
    if(document.getElementById('wr-manager'))return;
    const c=context();
    const saved=c.extensionSettings[KEY];
    try {settings=saved?validateSettings(saved):createSettings();} catch(error){settings={...createSettings(),enabled:false};report(new Error(`现有词库格式异常，替换已暂停；原设置未覆盖。${error.message}`));}
    runner=compile(settings);
    dialog=node('dialog',{id:'wr-manager',class:'wr-dialog','aria-label':'词汇快捷替换'});
    pane=node('div',{});dialog.append(pane);document.body.append(dialog);
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    if(!mountEntrypoints()){
        const observer=new window.MutationObserver(()=>{if(mountEntrypoints())observer.disconnect();});
        observer.observe(document.body,{childList:true,subtree:true});
    }
    const selectionButton=button('＋ 加入词库',()=>{const text=selectedText;selectionButton.hidden=true;openManager(text);},{id:'wr-selection',hidden:true,title:'把选中文字作为原词加入自定义分类'});
    document.body.append(selectionButton);
    document.addEventListener('mouseup',e=>{
        if(dialog.contains(e.target)||selectionButton.contains(e.target))return;
        const selection=window.getSelection();const text=selection?.toString().trim();
        const inChat=selection?.anchorNode?.parentElement?.closest('#chat');
        if(inChat&&text&&text.length<=200){selectedText=text;selectionButton.hidden=false;}else selectionButton.hidden=true;
    });
    selectionButton.addEventListener('mousedown',e=>e.preventDefault());
    const types=c.eventTypes??c.event_types;
    runtime=installRuntime(context,()=>settings,()=>runner,{onError:report});
    if(types.CHAT_CHANGED)c.eventSource.on(types.CHAT_CHANGED,()=>{historyPlan=null;undo=null;selectionButton.hidden=true;});
    installAPI();
}
if(typeof SillyTavern!=='undefined'){
    const c=context(),type=(c.eventTypes??c.event_types)?.APP_READY;
    if(type)c.eventSource.on(type,initialize);else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
}
