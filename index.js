import {createBlankSettings,validateSettings,compile,uid,setReplacement} from './engine.js';
import {syncGroups} from './model.js';
import {installRuntime} from './runtime.js';
import {Manager,download} from './manager.js';

const KEY='st_word_replacer';
let settings,runner,runtime,manager,dialog,status,historyPlan=null,undo=null,selectedText='';
const context=()=>SillyTavern.getContext();
const node=(tag,attrs={},...children)=>{
    const el=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){
        if(key.startsWith('on'))el.addEventListener(key.slice(2),value);else if(key==='class')el.className=value;else if(key in el)el[key]=value;else el.setAttribute(key,value);
    }el.append(...children);return el;
};
const protect=fn=>async(...args)=>{try{await fn(...args);}catch(e){report(e);}};
const button=(text,fn,attrs={})=>node('button',{type:'button',class:'menu_button wr-button',onclick:protect(fn),...attrs},text);
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
function report(error){console.error('[ST-WordReplacer]',error);manager?.notice(error.message,true);globalThis.toastr?.error(error.message,'词汇快捷替换');}
function remember(){
    syncGroups(settings);runner=compile(settings);context().extensionSettings[KEY]=settings;context().saveSettingsDebounced();runtime?.refresh();
}
export function openManager(prefill=''){manager?.open(prefill);dialog=manager?.dialog;}
function upsert({category='日常用词',from,to=''}){
    if(typeof from!=='string'||!from.trim()||from.length>2000||typeof to!=='string'||to.length>10000)throw new Error('请填写有效的原词和替换文字。');
    let g=settings.groups.find(x=>x.name===category);
    if(!g){if(settings.groups.length>=200)throw new Error('分类上限为 200。');g={id:uid(),name:String(category).trim().slice(0,100)||'日常用词',enabled:true,rules:[]};settings.groups.push(g);}
    const old=g.rules.find(r=>r.from===from);if(old){setReplacement(old,to);old.enabled=true;}else{
        if(settings.groups.reduce((n,g)=>n+g.rules.length,0)>=20000)throw new Error('词条上限为 20000。');g.rules.push({id:uid(),from,to,enabled:true});
    }remember();if(dialog?.open)manager.render();return true;
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
    body.append(node('p',{class:'wr-conflict'},'应用后会永久改写当前聊天，确认时先下载原文备份。'),
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
export function mountEntrypoints() {
    const host=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');
    if(host&&!document.getElementById('wr-settings')){
        const header=node('div',{class:'inline-drawer-toggle inline-drawer-header'},
            node('b',{},'词汇快捷替换'),
            node('div',{class:'inline-drawer-icon fa-solid fa-circle-chevron-down down'}));
        const content=node('div',{class:'inline-drawer-content'},
            button('打开词库管理',()=>openManager()),
            node('small',{},'v1.2.5 · 开发测试版 · 词库 · 条件规则 · 保护词'),
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
export function initialize(){
    if(document.getElementById('wr-manager'))return;
    const c=context(),saved=c.extensionSettings[KEY];let valid=true;
    try{settings=saved?validateSettings(saved):createBlankSettings();}catch(e){settings={...createBlankSettings(),enabled:false};valid=false;report(new Error(`配置读取失败，处理已暂停。${e.message}`));}
    runner=compile(settings);
    manager=new Manager({get settings(){return settings;},set settings(value){settings=value;},get runtime(){return runtime;},context,report,save:remember,
        get beforeMigration(){return c.extensionSettings[KEY+'_before_v4'];},renderHistory:body=>{status=manager.status;renderHistory(body);}});
    dialog=manager.dialog;
    if(valid){
        if(saved&&saved.version<4&&!c.extensionSettings[KEY+'_before_v4'])c.extensionSettings[KEY+'_before_v4']=structuredClone(saved);
        c.extensionSettings[KEY]=settings;c.saveSettingsDebounced();
    }
    if(!mountEntrypoints()){
        const observer=new window.MutationObserver(()=>{if(mountEntrypoints())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});
    }
    const selectionButton=button('＋ 加入词库',()=>{selectionButton.hidden=true;openManager(selectedText);},{id:'wr-selection',hidden:true,title:'把选中文字作为原词添加'});document.body.append(selectionButton);
    document.addEventListener('mouseup',e=>{
        if(dialog.contains(e.target)||selectionButton.contains(e.target))return;
        const selection=window.getSelection(),text=selection?.toString().trim(),inChat=selection?.anchorNode?.parentElement?.closest('#chat');
        if(inChat&&text&&text.length<=200){selectedText=text;selectionButton.hidden=false;}else selectionButton.hidden=true;
    });selectionButton.addEventListener('mousedown',e=>e.preventDefault());
    runtime=installRuntime(context,()=>settings,()=>runner,{onError:report});
    const types=c.eventTypes??c.event_types;
    if(types.CHAT_CHANGED)c.eventSource.on(types.CHAT_CHANGED,()=>{historyPlan=null;undo=null;selectionButton.hidden=true;});
    globalThis.STWordReplacer=Object.freeze({open:openManager,preview:text=>runner.run(String(text)),export:()=>structuredClone(settings),upsert,
        import:data=>{const next=validateSettings(data);compile(next);settings=next;manager.selected={};manager.draft=null;manager.clipboard=null;manager.selection.clear();remember();if(dialog.open)manager.render();}});
}
if(typeof SillyTavern!=='undefined'){
    const c=context(),type=(c.eventTypes??c.event_types)?.APP_READY;
    if(type)c.eventSource.on(type,initialize);else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
}
