import { createSettings, validateSettings, compile, parseBatch, replaceMessage, uid } from './engine.js';

const KEY = 'st_word_replacer';
let settings, runner, selected, dialog, pane, status, search = '', page = 0, tab = '词库';
let historyPlan = null, undo = null, selectedText = '';
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
    globalThis.toastr?.error(error.message, '分类词库');
}
function remember() {
    runner = compile(settings);
    context().extensionSettings[KEY] = settings;
    context().saveSettingsDebounced();
    if (status) {status.textContent = '修改已记录 · 自动保存到 ST 设置';status.classList.remove('wr-error');}
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
    const top = node('div',{class:'wr-top'},node('div',{},node('strong',{},'分类词库 · 快捷替换'),node('small',{},'修改后自动保存 · 空替换词表示删除')),
        button('关闭',()=>dialog.close(),{'aria-label':'关闭词库管理'}));
    const controls = node('div',{class:'wr-controls'},
        checkbox('启用替换',settings.enabled,v=>{settings.enabled=v;remember();}),
        checkbox('AI 回复完成后',settings.assistant,v=>{settings.assistant=v;remember();}),
        checkbox('自己发出的消息',settings.user,v=>{settings.user=v;remember();}),
        checkbox('编辑后的消息',settings.edited,v=>{settings.edited=v;remember();}),
        checkbox('保护代码块',settings.protectCode,v=>{settings.protectCode=v;remember();}));
    const tabs = node('nav',{class:'wr-tabs'},...['词库','预览与保护','备份与导入','历史消息'].map(name=>button(name,()=>{tab=name;render();},{class:`menu_button wr-button ${name===tab?'wr-active':''}`})));
    const body = node('div',{class:'wr-body'});
    status = node('div',{class:'wr-status',role:'status','aria-live':'polite'},'词库只保存在你的 ST 设置中，不会自动上传 GitHub。');
    pane.append(top,controls,tabs,body,status);
    if (tab==='词库') renderDictionary(body);
    if (tab==='预览与保护') renderPreview(body);
    if (tab==='备份与导入') renderBackup(body);
    if (tab==='历史消息') renderHistory(body);
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
    checkbox('特殊句式规则（原脚本）',settings.contextual,v=>{settings.contextual=v;remember();}),
    node('small',{},'特殊规则处理脏话组合，不能保证理解上下文。可在预览中测试，或关闭后只用词库。'));
    const content=node('section',{class:'wr-content'});body.append(node('div',{class:'wr-layout'},sidebar,content));
    const g=group();
    if(!g){content.append(node('p',{},'请先新建分类。'));return;}
    selected=g.id;
    content.append(node('div',{class:'wr-row'},field(g.name,'分类名称',v=>{g.name=v.trim()||'未命名分类';remember();}),
        button('导出此类',()=>download(`${g.name}.json`,{...createSettings(),groups:[structuredClone(g)]})),
        button('删除分类',()=>{if(!confirm(`删除“${g.name}”及其中 ${g.rules.length} 个词条？`))return;settings.groups=settings.groups.filter(x=>x!==g);selected=null;remember();render();})));
    const from=field(selectedText,'原词（必填）',()=>{}); selectedText='';
    const to=field('','替换为（留空即删除）',()=>{});
    content.append(node('div',{class:'wr-row wr-add'},from,node('span',{},'→'),to,button('添加 / 更新',()=>{
        upsert(g,from.value,to.value);remember();render();
    })));
    const table=node('div',{class:'wr-rule-list'});
    const pager=node('div',{class:'wr-row'});
    const refresh=()=>{
        table.replaceChildren();pager.replaceChildren();
        const filtered=g.rules.filter(r=>r.from.includes(search)||r.to.includes(search));
        const max=Math.max(0,Math.ceil(filtered.length/80)-1);page=Math.min(page,max);
        table.append(node('div',{class:'wr-rule wr-table-head'},node('span',{},'启用'),node('span',{},'原词'),node('span',{},'替换为 · 空白即删除'),node('span',{},'操作')));
        filtered.slice(page*80,page*80+80).forEach(r=>{
            const row=node('div',{class:'wr-rule'},checkbox('',r.enabled,v=>{r.enabled=v;remember();}),
                field(r.from,'原词',v=>{if(!v){status.textContent='原词不能为空，暂时保留之前的原词；请补充或删除此行。';return;}r.from=v;remember();}),
                field(r.to,'留空即删除',v=>{r.to=v;remember();}),
                button('删除',()=>{g.rules=g.rules.filter(x=>x!==r);remember();refresh();}));
            table.append(row);
        });
        pager.append(button('上一页',()=>{page=Math.max(0,page-1);refresh();}),node('span',{},`第 ${page+1}/${max+1} 页 · ${filtered.length} 条`),button('下一页',()=>{page=Math.min(max,page+1);refresh();}));
    };
    content.append(field(search,'搜索当前分类的原词 / 替换词',v=>{search=v;page=0;refresh();}),table,pager);
    const batch=node('textarea',{class:'text_pole',rows:4,placeholder:'每行一条，例如：\n老天爷 → 老天奶\n母狗 →\n也支持 => 或制表符；# 开头为注释。'});
    content.append(node('details',{},node('summary',{},'批量添加到当前分类'),batch,button('检查并添加',()=>{
        const rules=parseBatch(batch.value);if(!rules.length)throw new Error('没有可添加的词条。');
        rules.forEach(r=>upsert(g,r.from,r.to));remember();render();
    }),node('small',{},'批量格式会去掉两端空格；需要匹配空格时使用单条编辑。')));
    refresh();
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
        node('p',{},runner.conflicts.length?`同名规则覆盖：${runner.conflicts.join('、')}`:'当前没有同名原词冲突。'));
}
function renderBackup(body) {
    const file=node('input',{type:'file',accept:'.json,application/json'});
    const mode=node('select',{class:'text_pole'},node('option',{value:'merge'},'追加为新分类（推荐）'),node('option',{value:'replace'},'用备份覆盖全部设置'));
    body.append(node('p',{},'备份包括分类、词条、保护词和开关。导入只读取 JSON 数据，不执行脚本。'),
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
        }),node('p',{},'原始酒馆助手 JSON 含可执行代码，不能在此直接导入。你提供的原始词库已经迁入扩展。'));
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
    body.append(node('p',{},'只在你手动预览并确认后改写历史正文；不会修改角色卡、世界书、推理区和未选中的 swipe。'),
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
async function onMessage(id, kind) {
    const c=context(), message=c.chat[Number(id)];
    if(!settings.enabled||!message||message.is_system)return;
    if(kind==='edit'&&!settings.edited)return;
    if(kind!=='edit'&&(message.is_user?!settings.user:!settings.assistant))return;
    const changed=replaceMessage(message,runner);if(!changed)return;
    c.updateMessageBlock(Number(id),message);
    await c.saveChat();
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
    const c=context();
    if(c.SlashCommandParser&&c.SlashCommand){
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({name:'wordlib',callback:()=>{openManager();return '';},helpString:'打开分类词库管理面板'}));
    }
}
export function initialize() {
    if(document.getElementById('wr-manager'))return;
    const c=context();
    const saved=c.extensionSettings[KEY];
    try {settings=saved?validateSettings(saved):createSettings();} catch(error){settings={...createSettings(),enabled:false};report(new Error(`现有词库格式异常，替换已暂停；原设置未覆盖。${error.message}`));}
    runner=compile(settings);
    dialog=node('dialog',{id:'wr-manager',class:'wr-dialog','aria-label':'分类词库管理'});
    pane=node('div',{});dialog.append(pane);document.body.append(dialog);
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    const host=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');
    if(host)host.append(node('div',{class:'wr-settings'},node('b',{},'分类词库 · 快捷替换'),button('打开词库管理',()=>openManager()),node('small',{},'Alt + Shift + W · 或输入 /wordlib')));
    const quick=button('词库',()=>openManager(),{id:'wr-quick',title:'打开词库管理（Alt+Shift+W）'});
    const toolbar=document.querySelector('#send_form');
    if(toolbar)toolbar.append(quick);else{quick.classList.add('wr-floating');document.body.append(quick);}
    document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.code==='KeyW'){e.preventDefault();openManager();}});
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
    for(const [event,kind] of [[types.MESSAGE_RECEIVED,'assistant'],[types.MESSAGE_SENT,'user'],[types.MESSAGE_EDITED,'edit']])if(event)c.eventSource.on(event,protect(id=>onMessage(id,kind)));
    if(types.CHAT_CHANGED)c.eventSource.on(types.CHAT_CHANGED,()=>{historyPlan=null;undo=null;selectionButton.hidden=true;});
    installAPI();
}
if(typeof SillyTavern!=='undefined'){
    const c=context(),type=(c.eventTypes??c.event_types)?.APP_READY;
    if(type)c.eventSource.on(type,initialize);else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
}
