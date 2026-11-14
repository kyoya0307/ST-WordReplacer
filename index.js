import { createSettings, validateSettings, compile, parseBatch, inspectRules, planPaste, createTransfer, pasteTransfer, uid } from './engine.js';
import { CONTEXT_RULES, CONTEXT_MATCH_TEXT, createContextOptions, validateContextOptions } from './legacy.js';
import { installRuntime } from './runtime.js';

const KEY = 'st_word_replacer';
let settings, runner, selected, dialog, pane, status, search = '', page = 0, tab = '词库';
let historyPlan = null, undo = null, selectedText = '';
let runtime, clipboard=null, selectedRules=new Set(), selectionGroup=null, allSearch='', auditFilter='all';
let contextSearch='', contextInput='', contextTestRule='all';
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
    context().extensionSettings[KEY] = settings;
    context().saveSettingsDebounced();
    runtime?.refresh();
    if (status) {
        const issues=inspectRules(settings),conflicts=issues.filter(x=>x.kind==='conflict'),duplicates=issues.filter(x=>x.kind==='duplicate');
        status.textContent = `修改已记录 · 自动保存到 ST 设置${conflicts.length?` · ⚠ ${conflicts.length} 个冲突，请到“全库检索与检查”核对`:''}${duplicates.length?` · ${duplicates.length} 个相同重复（仅提示）`:''}`;
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
    if (old) {old.to=to;old.enabled=true;} else {
        if(settings.groups.reduce((n,x)=>n+x.rules.length,0)>=20000)throw new Error('词条不能超过 20000 条。');
        g.rules.push({id:uid(),from,to,enabled:true});
    }
}
export function openManager(prefill = '') {
    if (!dialog) return;
    if (prefill) { selectedText = prefill;tab='词库';selected=ensureCustom().id; }
    render();
    if (!dialog.open) dialog.showModal();
}
function render() {
    pane.replaceChildren();
    const top = node('div',{class:'wr-top'},node('div',{},node('strong',{},'词汇快捷替换'),node('small',{},'修改后自动保存 · 空替换词表示删除')),
        button('关闭',()=>dialog.close(),{'aria-label':'关闭词库管理'}));
    const controls = node('div',{class:'wr-controls'},
        checkbox('启用替换',settings.enabled,v=>{settings.enabled=v;remember();}),
        checkbox('AI 输出',settings.assistant,v=>{settings.assistant=v;remember();}),
        checkbox('自己发出的消息',settings.user,v=>{settings.user=v;remember();}));
    const advanced=node('details',{},node('summary',{},'更多处理选项（可按需调整）'),node('div',{class:'wr-controls'},
        checkbox('编辑后生效',settings.edited,v=>{settings.edited=v;remember();}),
        checkbox('影响显示',settings.display,v=>{settings.display=v;remember();}),
        checkbox('影响模型输入',settings.prompt,v=>{settings.prompt=v;remember();}),
        checkbox('保护代码块',settings.protectCode,v=>{settings.protectCode=v;remember();})));
    controls.append(button('应用推荐配置',()=>{Object.assign(settings,{enabled:true,assistant:true,user:false,edited:true,display:true,prompt:true,protectCode:true});remember();render();}));
    const explanation=node('p',{class:'wr-explainer'},'自动替换保留聊天文件原文。默认只处理 AI 正文，显示与发送给模型时都生效；编辑后也会刷新。作用范围可按需勾选。');
    const tabs = node('nav',{class:'wr-tabs'},...['词库','特殊句式','全库检索与检查','预览与保护','备份与导入','历史消息'].map(name=>button(name,()=>{tab=name;render();},{class:`menu_button wr-button ${name===tab?'wr-active':''}`})));
    const body = node('div',{class:'wr-body'});
    status = node('div',{class:'wr-status',role:'status','aria-live':'polite'},'词库只保存在你的 ST 设置中，不会自动上传 GitHub。');
    pane.append(top,controls,explanation,advanced,tabs,body,status);
    if (tab==='词库') renderDictionary(body);
    if (tab==='预览与保护') renderPreview(body);
    if (tab==='备份与导入') renderBackup(body);
    if (tab==='历史消息') renderHistory(body);
    if (tab==='全库检索与检查') renderAudit(body);
    if (tab==='特殊句式') renderContextual(body);
}
function renderDictionary(body) {
    const sidebar = node('aside',{class:'wr-sidebar'});
    const list = node('div',{class:'wr-group-list'});
    settings.groups.forEach((g,index)=>{
        list.append(node('div',{class:`wr-group ${g.id===group()?.id?'wr-selected':''}`},
            checkbox('',g.enabled,v=>{g.enabled=v;remember();}),
            button(`${g.name} (${g.rules.length})`,()=>{selected=g.id;page=0;search='';render();}),
            button('↑',()=>{if(index){[settings.groups[index-1],settings.groups[index]]=[g,settings.groups[index-1]];remember();render();}},{title:'向前移动分类'})));
    });
    sidebar.append(node('b',{},'分类'),list,button('＋ 新建分类',()=>{
        if(settings.groups.length>=200)throw new Error('分类不能超过 200 个。');
        const name=prompt('新分类名称');if(!name?.trim())return;
        const g={id:uid(),name:name.trim().slice(0,100),enabled:true,rules:[]};settings.groups.push(g);selected=g.id;page=0;search='';remember();render();
    }),node('small',{},'长词优先。同名原词以靠后的已启用分类为准。'),
    checkbox('启用特殊句式',settings.contextual,v=>{settings.contextual=v;remember();}),
    button('管理特殊句式',()=>{tab='特殊句式';render();}),
    node('small',{},'按条件处理上下文；可逐项开关、调整替换结果和保护条件。'));
    const content=node('section',{class:'wr-content'});body.append(node('div',{class:'wr-layout'},sidebar,content));
    const g=group();
    if(!g){content.append(node('p',{},'请先新建分类。'));return;}
    selected=g.id;
    if(selectionGroup!==g.id){selectionGroup=g.id;selectedRules.clear();}
    content.append(node('div',{class:'wr-row'},field(g.name,'分类名称',v=>{g.name=v.trim()||'未命名分类';remember();}),
        button('导出此类',()=>download(`${g.name}.json`,{...structuredClone(settings),groups:[structuredClone(g)]})),
        button('删除分类',()=>{if(!confirm(`删除“${g.name}”及其中 ${g.rules.length} 个词条？`))return;settings.groups=settings.groups.filter(x=>x!==g);selected=null;remember();render();})));
    const from=field(selectedText,'原词（必填）',()=>{}); selectedText='';
    const to=field('','替换为（留空即删除）',()=>{});
    content.append(node('div',{class:'wr-row wr-add'},from,node('span',{},'→'),to,button('添加 / 更新',()=>{
        upsert(g,from.value,to.value);remember();render();
    })));
    const table=node('div',{class:'wr-rule-list'});
    const pager=node('div',{class:'wr-row'});
    const selectionInfo=node('span',{});
    const pastePanel=node('div',{class:'wr-paste-panel'});
    const selectionStatus=()=>{selectionInfo.textContent=`已选 ${selectedRules.size} 条 · ${clipboard?.mode==='cut'?'待剪切':'已复制'} ${clipboard?.rules.length??0} 条${clipboard?.rules.length?`（来自 ${clipboard.sourceName}）`:''}`;};
    const capture=mode=>{clipboard=createTransfer(g,selectedRules,mode);pastePanel.replaceChildren();refresh();status.textContent=mode==='cut'?'已标记待剪切。切换分类后粘贴成功才会移除原项；取消或刷新不会删除原词条。':`已复制 ${clipboard.rules.length} 条，现在可切换分类后粘贴。`;};
    const batchTools=node('div',{class:'wr-row'},
        button('全选搜索结果',()=>{g.rules.filter(r=>r.from.includes(search)||r.to.includes(search)).forEach(r=>selectedRules.add(r.id));refresh();}),
        button('清空选择',()=>{selectedRules.clear();refresh();}),
        button('复制所选',()=>capture('copy')),
        button('剪切所选',()=>capture('cut')),
        button('清空剪贴内容',()=>{clipboard=null;pastePanel.replaceChildren();refresh();}),
        button('粘贴到此类',()=>{
            if(!clipboard?.rules.length)throw new Error('请先在任意分类中复制或剪切词条。');
            if(clipboard.mode==='cut'&&clipboard.sourceId===g.id)throw new Error('请切换到其他分类后粘贴；原词条尚未移除。');
            const pending=clipboard,targetSnapshot=JSON.stringify(g.rules),plan=planPaste(g,pending.rules);
            const policy=node('select',{class:'text_pole'},node('option',{value:'skip'},'冲突：保留现有，跳过复制项'),node('option',{value:'overwrite'},'冲突：用复制项覆盖现有替换词'),node('option',{value:'disabled'},'冲突：新增为停用词条，稍后核对'));
            pastePanel.replaceChildren(node('p',{},`待新增 ${plan.additions.length} 条 · 相同重复 ${plan.duplicates.length} 条（跳过） · 冲突 ${plan.conflicts.length} 条`),
                ...(pending.mode==='cut'?[node('p',{},'剪切：仅移除已完整转入目标的词条。冲突被跳过、停用状态不一致或词条被修改时，原项保留。目标分类的总开关决定移动后是否生效。')]:[]),
                ...plan.conflicts.slice(0,20).map(x=>node('div',{class:'wr-conflict'},`${x.incoming.from}：现有 ${x.existing.map(r=>r.to||'〔删除〕').join(' / ')}；复制项 ${x.incoming.to||'〔删除〕'}`)),policy,
                button('确认粘贴',()=>{
                    if(clipboard!==pending||JSON.stringify(g.rules)!==targetSnapshot)throw new Error('剪贴内容或目标词库已变化，请重新点击粘贴查看预览。');
                    const result=pasteTransfer(settings,g.id,pending,policy.value);
                    if(pending.mode==='cut')clipboard=result.remaining.length?{...pending,rules:result.remaining}:null;
                    remember();render();
                    if(pending.mode==='cut')status.textContent=`已移动 ${result.moved} 条；${result.remaining.length} 条仍保留在来源分类。`;
                }),button('取消粘贴',()=>pastePanel.replaceChildren()));
        }),selectionInfo);
    const refresh=()=>{
        table.replaceChildren();pager.replaceChildren();
        const filtered=g.rules.filter(r=>r.from.includes(search)||r.to.includes(search));
        const max=Math.max(0,Math.ceil(filtered.length/80)-1);page=Math.min(page,max);
        const issues=new Map(inspectRules(settings).map(x=>[x.from,x]));
        table.append(node('div',{class:'wr-rule wr-table-head'},node('span',{},'选 / 启用'),node('span',{},'原词'),node('span',{},'替换为 · 空白即删除'),node('span',{},'操作')));
        filtered.slice(page*80,page*80+80).forEach(r=>{
            const issue=issues.get(r.from),label=issue?(issue.kind==='conflict'?'⚠ 冲突':'重复'):'删除';
            const pendingCut=clipboard?.mode==='cut'&&clipboard.sourceId===g.id&&clipboard.rules.some(x=>x.id===r.id);
            const row=node('div',{class:`wr-rule${pendingCut?' wr-cut-pending':''}`,'data-rule-id':r.id,title:pendingCut?'待剪切：粘贴成功后才移除':''},node('div',{class:'wr-row-checks'},checkbox('选择',selectedRules.has(r.id),v=>{v?selectedRules.add(r.id):selectedRules.delete(r.id);selectionStatus();}),checkbox('启用',r.enabled,v=>{r.enabled=v;remember();})),
                field(r.from,'原词',v=>{if(!v){status.textContent='原词不能为空，暂时保留之前的原词；请补充或删除此行。';return;}r.from=v;remember();}),
                field(r.to,'留空即删除',v=>{r.to=v;remember();}),
                node('div',{},...(issue?[button(label,()=>{allSearch=r.from;tab='全库检索与检查';render();},{class:`menu_button wr-button ${issue.kind==='conflict'?'wr-conflict':'wr-info'}`,title:'查看相关分类和生效规则'})]:[]),button('删除',()=>{g.rules=g.rules.filter(x=>x!==r);selectedRules.delete(r.id);remember();refresh();})));
            table.append(row);
        });
        pager.append(button('上一页',()=>{page=Math.max(0,page-1);refresh();}),node('span',{},`第 ${page+1}/${max+1} 页 · ${filtered.length} 条`),button('下一页',()=>{page=Math.min(max,page+1);refresh();}));
        selectionStatus();
    };
    content.append(field(search,'搜索当前分类的原词 / 替换词',v=>{search=v;page=0;refresh();}),batchTools,pastePanel,table,pager);
    const batch=node('textarea',{class:'text_pole',rows:4,placeholder:'每行一条，例如：\n旧称 → 新称\n【草稿标记】 →\n也支持 => 或制表符；# 开头为注释。'});
    content.append(node('details',{},node('summary',{},'批量添加到当前分类'),batch,button('检查并添加',()=>{
        const rules=parseBatch(batch.value);if(!rules.length)throw new Error('没有可添加的词条。');
        rules.forEach(r=>upsert(g,r.from,r.to));remember();render();
    }),node('small',{},'批量格式会去掉两端空格；需要匹配空格时使用单条编辑。')));
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
            const isolated=structuredClone(settings);isolated.groups=[];
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
                node('p',{},rule.description),node('small',{},`保护条件：${rule.protection}`),
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
    body.append(node('p',{class:'wr-explainer'},'特殊句式按前后文字和固定条件判断，不是无条件替换。无需填写正则：选择规则、调整处理方式，再用完整句子测试。'),
        checkbox('启用特殊句式',settings.contextual,v=>{settings.contextual=v;remember();preview();}),
        field(contextSearch,'搜索句式名称、用途或保护条件',v=>{contextSearch=v;draw();}),cards,
        node('details',{},node('summary',{},'调整亲属语境保护表'),
            node('p',{},'名词保护表用于“带去的句式”和“亲属语境判断”：匹配片段后紧接这些名词时，跳过相应规则。'),nouns,
            node('p',{},'动作保护字仅用于“亲属语境判断”：匹配片段前紧接任一字时跳过。每个字单独生效，不是短语表。'),verbs,
            button('恢复保护表默认值',()=>{const defaults=createContextOptions();settings.contextOptions.nouns=defaults.nouns;settings.contextOptions.verbs=defaults.verbs;remember();render();})),
        node('p',{},'保护条件只约束对应规则，其他句式和普通词库仍会继续处理。需要某段文字始终保持原样时，请到“预览与保护”添加完整保护词。'),testBox,
        node('small',{},'默认执行顺序与原规则一致；这些是文字模式判断，不能理解所有叙事语境。请同时测试希望替换和希望保留的句子。'));
    draw();preview();
}
function renderAudit(body) {
    const results=node('div',{}),summary=node('p',{});
    const filter=node('select',{class:'text_pole'},...Object.entries({all:'全部词条',conflict:'仅看冲突',duplicate:'仅看相同重复'}).map(([value,label])=>node('option',{value,selected:auditFilter===value},label)));
    let auditPage=0;
    const draw=()=>{
        const issues=inspectRules(settings),byFrom=new Map(issues.map(x=>[x.from,x]));
        const conflicts=issues.filter(x=>x.kind==='conflict'),duplicates=issues.filter(x=>x.kind==='duplicate');
        summary.textContent=`全库：${conflicts.length} 个冲突原词（${conflicts.filter(x=>x.activeConflict).length} 个当前启用冲突）；${duplicates.length} 个相同重复原词。相同重复仅提示，不影响匹配结果。`;
        const rows=settings.groups.flatMap(g=>g.rules.map(r=>({g,r,issue:byFrom.get(r.from)}))).filter(({g,r,issue})=>
            (auditFilter==='all'||issue?.kind===auditFilter)&&[g.name,r.from,r.to].some(x=>x.toLocaleLowerCase().includes(allSearch.toLocaleLowerCase())));
        const pages=Math.max(1,Math.ceil(rows.length/60));auditPage=Math.min(auditPage,pages-1);
        results.replaceChildren(node('p',{},`检索到 ${rows.length} 条 · 第 ${auditPage+1}/${pages} 页`));
        rows.slice(auditPage*60,auditPage*60+60).forEach(({g,r,issue})=>{
            const state=issue?.kind==='conflict'?(issue.activeConflict?'⚠ 冲突':'⚠ 潜在冲突（部分已停用）'):issue?'重复 · 仅提示':'无同名冲突';
            results.append(node('div',{class:`wr-audit-row ${issue?.kind==='conflict'?'wr-conflict-row':''}`},
                node('b',{},`${r.from} → ${r.to||'〔删除〕'}`),node('small',{},`${g.name} · ${g.enabled&&r.enabled?'启用':'停用'} · ${state}`),
                ...(issue?[node('small',{},issue.winner?`当前生效：${issue.winner.group} → ${issue.winner.to||'〔删除〕'}`:'当前没有启用项')]:[]),
                button('定位到分类',()=>{selected=g.id;search=r.from;page=0;tab='词库';render();})));
        });
        results.append(node('div',{class:'wr-row'},button('上一页',()=>{auditPage=Math.max(0,auditPage-1);draw();}),button('下一页',()=>{auditPage=Math.min(pages-1,auditPage+1);draw();})));
    };
    filter.addEventListener('change',()=>{auditFilter=filter.value;auditPage=0;draw();});
    body.append(node('p',{},'检查所有分类，包括停用项。相同原词与替换词属于重复；相同原词对应不同替换词属于冲突。长词包含短词按长词优先，不作为同名冲突。'),
        field(allSearch,'搜索全部分类、原词、替换词',v=>{allSearch=v;auditPage=0;draw();}),filter,summary,results);draw();
}
function renderPreview(body) {
    const input=node('textarea',{class:'text_pole',rows:7,placeholder:'粘贴一段文字，查看替换结果；不会修改聊天。'});
    const output=node('pre',{class:'wr-output'});
    const hits=node('div',{});
    const preview=()=>{
        const result=runner.run(input.value);output.textContent=result.text;
        hits.replaceChildren(node('b',{},`命中 ${result.hits.reduce((n,h)=>n+h.count,0)} 次`),
            ...result.hits.map(h=>node('div',{class:'wr-hit'},`${h.from} → ${h.to||'〔删除〕'} · ${h.group} × ${h.count}`)));
    };
    input.addEventListener('input',preview);
    const exceptions=node('textarea',{class:'text_pole',rows:4,value:settings.exceptions.join('\n'),placeholder:'每行一个保护词，完整词语保持不变。例：小三花'});
    exceptions.addEventListener('input',protect(()=>{settings.exceptions=[...new Set(exceptions.value.split(/\r?\n/).filter(Boolean))];remember();preview();}));
    body.append(node('p',{},'替换结果不会被同一次词库匹配再次处理；重复原词以后面的分类为准。特殊句式规则仍在词库前后处理。'),
        input,node('b',{},'替换结果'),output,hits,node('h4',{},'保护词'),exceptions,
        node('small',{},'保护词和代码块会原样保留。普通文本中的名字、链接等仍可能被单字规则影响。'),
        node('p',{},runner.conflicts.length?`⚠ 同名不同替换：${runner.conflicts.join('、')}，可在全库检索与检查中核对。`:'当前没有同名不同替换的冲突。'));
}
function renderBackup(body) {
    const file=node('input',{type:'file',accept:'.json,application/json'});
    const mode=node('select',{class:'text_pole'},node('option',{value:'merge'},'追加为新分类（推荐）'),node('option',{value:'replace'},'用备份覆盖全部设置'));
    body.append(node('p',{},'备份包括分类、词条、保护词、特殊句式配置和开关。追加导入只合并分类与保护词，保留当前特殊句式配置；覆盖全部设置才恢复备份中的句式配置。导入不执行脚本。'),
        button('导出全部词库与设置',()=>download(`ST-WordReplacer-${stamp()}.json`,settings)),file,mode,
        button('导入 JSON',async()=>{
            const f=file.files[0];if(!f)throw new Error('请先选择 JSON 文件。');
            if(f.size>10*1024*1024)throw new Error('文件不能超过 10 MB。');
            const imported=validateSettings(JSON.parse(await f.text()));
            if(mode.value==='replace'&&!confirm('覆盖当前全部设置？建议先导出备份。'))return;
            if(mode.value==='replace')settings=imported;
            else {
                if(settings.groups.length+imported.groups.length>200)throw new Error('合并后分类过多。');
                settings.groups.push(...imported.groups);settings.exceptions=[...new Set([...settings.exceptions,...imported.exceptions])];
            }
            selected=null;remember();render();status.textContent='导入完成。';
        }),node('hr'),button('恢复原始词库（先导出当前备份）',()=>{
            if(!confirm('恢复原始 124 条词库和默认开关？当前设置会先下载备份。'))return;
            download(`ST-WordReplacer-before-reset-${stamp()}.json`,settings);settings=createSettings();selected=null;remember();render();
        }),node('p',{},'脚本型 JSON 含可执行代码，不能在此直接导入；此处仅接受本扩展的词库备份。'));
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
        import:data=>{settings=validateSettings(data);selected=null;remember();if(dialog.open)render();},
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
            node('small',{},'v1.1.1 · 剪切粘贴 · 特殊句式 · 全库检查'),
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
