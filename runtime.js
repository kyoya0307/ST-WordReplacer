// 自动处理只作用于显示副本和生成请求副本，从不修改 chat / swipes / extra。
import { patchDisplayText } from './display-dom.js';
export function scopeAllows(settings, message) {
    return !!(settings.enabled && message && !message.is_system && message.extra?.type!=='narrator' &&
        (message.is_user ? settings.user : settings.assistant));
}
export function displayCopy(message, settings, runner) {
    if(!settings.display || !scopeAllows(settings,message))return message;
    const input=typeof message.extra?.display_text==='string'?message.extra.display_text:message.mes;
    if(typeof input!=='string')return message;
    const text=runner.run(input).text;
    if(text===input)return message;
    return {...message,mes:text,extra:{...message.extra,...(typeof message.extra?.display_text==='string'?{display_text:text}:{})}};
}
export function transformPrompt(messages, settings, runner, {sourceChat, reasoning={}, expand=s=>s, nativeRegex, type}={}) {
    if(!settings.prompt||!settings.enabled||!Array.isArray(messages))return;
    if(messages===sourceChat)throw new Error('拒绝在原始聊天数组上应用提示词替换。');
    messages.forEach((message,index)=>{
        if(!scopeAllows(settings,message)||typeof message.mes!=='string')return;
        let prefixLength=0;
        // ST 在 interceptor 之前把 reasoning 包装在正文前面；精确识别并保留它。
        if(message.extra?.reasoning){
            const depth=messages.length-index-(type==='continue'?2:1);
            const raw=String(message.extra.reasoning);
            const reason=nativeRegex?.getRegexedString
                ?nativeRegex.getRegexedString(raw,nativeRegex.regex_placement.REASONING,{isPrompt:true,depth}):raw;
            const prefix=expand(reasoning.prefix||''),suffix=expand(reasoning.suffix||''),separator=expand(reasoning.separator||'');
            const full=`${prefix}${reason}${suffix}${separator}`;
            if(full&&message.mes.startsWith(full))prefixLength=full.length;
            else if(message.mes===`${prefix}${reason}`)prefixLength=message.mes.length;
            else if(prefix&&suffix&&message.mes.startsWith(prefix)){
                // 兼容其他扩展已加工的推理前缀。
                const end=message.mes.indexOf(suffix,prefix.length);
                if(end>=0){prefixLength=end+suffix.length;if(message.mes.slice(prefixLength).startsWith(separator))prefixLength+=separator.length;}
            }
        }
        const text=message.mes.slice(0,prefixLength)+runner.run(message.mes.slice(prefixLength)).text;
        if(text!==message.mes)messages[index]={...message,mes:text};
    });
}
export function installRuntime(getContext,getSettings,getRunner,{loadNativeRegex=()=>import('../../regex/engine.js'),onError=console.error}={}) {
    let timer=null, regexPromise;
    const c=getContext(),types=c.eventTypes??c.event_types??{};
    const formatter=c.messageFormatter;
    const nativeFormatting=typeof formatter?.addHook==='function'&&!!formatter.stage?.BEFORE_REGEX;
    const formatted=new Map(),legacyRendered=new WeakMap(),editing=new Set(),domRecords=new WeakMap();
    const sourceText=m=>typeof m.extra?.display_text==='string'?m.extra.display_text:m.mes;
    const hasMarkup=input=>/<!doctype\b|<\/?[a-z][^>]*>/i.test(input??'');
    const deferFormatting=(input,message)=>hasMarkup(input)||hasMarkup(message&&sourceText(message));
    const transform=(input,meta)=>{
        const settings=getSettings(),source=getContext().chat[meta.messageId];
        if(meta.isReasoning||!settings.display||editing.has(Number(meta.messageId)))return input;
        // Rich messages retain their source text until the DOM pass. Its reversible text-node
        // records let settings changes restore prose while keeping live widgets in place.
        if(deferFormatting(input,source))return input;
        const message={is_system:meta.isSystem||source?.is_system,is_user:meta.isUser??source?.is_user,extra:source?.extra};
        return scopeAllows(settings,message)?getRunner().run(input).text:input;
    };
    if(nativeFormatting){
        // 在 ST 的 Markdown / 前端渲染之前处理正文，不再覆写其他扩展生成的 DOM。
        formatter.addHook((input,meta)=>{
            if(meta.isReasoning)return input;
            try{
                const output=transform(input,meta),ctx=getContext(),id=Number(meta.messageId),message=ctx.chat[id];
                if(message&&Number.isInteger(id)&&id>=0)formatted.set(id,{chat:ctx.chat,message,source:sourceText(message),input,output,meta,deferred:deferFormatting(input,message)});
                return output;
            }catch(error){onError(error);return input;}
        },{stage:formatter.stage.BEFORE_REGEX,order:formatter.order?.EARLY??10});
        // MESSAGE_EDITED 在 ST 渲染编辑结果之前发出；关闭该选项时仅跳过这次编辑。
        if(types.MESSAGE_EDITED)c.eventSource.on(types.MESSAGE_EDITED,id=>{if(!getSettings().edited)editing.add(Number(id));});
        if(types.MESSAGE_UPDATED)c.eventSource.on(types.MESSAGE_UPDATED,id=>editing.delete(Number(id)));
        if(types.CHAT_CHANGED)c.eventSource.on(types.CHAT_CHANGED,()=>{
            const ctx=getContext();
            for(const [id,record] of formatted)if(record.chat!==ctx.chat||record.message!==ctx.chat[id])formatted.delete(id);
            editing.clear();
        });
    }
    const hasFrontend=(el,input)=>
        hasMarkup(input)||
        !!el?.querySelector('iframe,object,embed,script,style,custom-style')||
        [...(el?.querySelectorAll('pre code')??[])].some(code=>/<\/?[a-z][^>]*>/i.test(code.textContent));
    const render=id=>{
        id=Number(id);
        const ctx=getContext(),m=ctx.chat[id];if(!m)return;
        const el=document.querySelector(`#chat .mes[mesid="${id}"]`);
        if(!el||el.querySelector('.edit_textarea,.reasoning_edit_textarea'))return;
        const input=sourceText(m);
        // 含界面的消息不整条重画；无格式化接口时，只就地更新可读正文。
        if(hasFrontend(el,input)){
            if(!nativeFormatting||hasMarkup(input)||formatted.get(id)?.deferred){
                const root=el.querySelector('.mes_text');
                if(root){
                    const s=getSettings(),enabled=s.display&&scopeAllows(s,m)&&!editing.has(id);
                    patchDisplayText(root,s,enabled?getRunner():{run:text=>({text,hits:[],edits:[]})},domRecords);
                }
            }
            return;
        }
        if(nativeFormatting){
            const previous=formatted.get(id);
            if(previous?.chat===ctx.chat&&previous.message===m&&previous.source===input){
                if(transform(previous.input,previous.meta)===previous.output)return;
            }else if(displayCopy(m,getSettings(),getRunner())===m)return;
            // 必须传原文。格式化 hook 只处理一次，避免 A→B、B→C 串改。
            ctx.updateMessageBlock(id,m);
        }else{
            const copy=displayCopy(m,getSettings(),getRunner()),output=sourceText(copy),previous=legacyRendered.get(el);
            const current=previous?.chat===ctx.chat&&previous.message===m&&previous.source===input;
            if(current?previous.output===output:copy===m)return;
            ctx.updateMessageBlock(id,copy);
            legacyRendered.set(el,{chat:ctx.chat,message:m,source:input,output});
        }
    };
    const refresh=()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>{document.querySelectorAll('#chat .mes[mesid]').forEach(el=>{try{render(Number(el.getAttribute('mesid')));}catch(e){onError(e);}});},120);
    };
    if(!nativeFormatting){
        for(const key of ['CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_SWIPED'])if(types[key])c.eventSource.on(types[key],id=>{
            // ST 刚重绘的普通楼层需要重新应用；不沿用上一版 DOM 的缓存。
            const el=document.querySelector(`#chat .mes[mesid="${Number(id)}"]`);
            if(el)legacyRendered.delete(el);
            setTimeout(()=>{try{render(id);}catch(e){onError(e);}},0);
        });
        if(types.MESSAGE_UPDATED)c.eventSource.on(types.MESSAGE_UPDATED,id=>{if(getSettings().edited){
            const el=document.querySelector(`#chat .mes[mesid="${Number(id)}"]`);
            if(el)legacyRendered.delete(el);
            setTimeout(()=>{try{render(id);}catch(e){onError(e);}},0);
        }});
        for(const key of ['CHAT_CHANGED','MORE_MESSAGES_LOADED'])if(types[key])c.eventSource.on(types[key],refresh);
        const chat=document.getElementById('chat');
        if(chat){const observer=new window.MutationObserver(refresh);observer.observe(chat,{childList:true});}
    }else{
        for(const key of ['CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_UPDATED'])if(types[key])c.eventSource.on(types[key],id=>{
            setTimeout(()=>{try{render(id);}catch(error){onError(error);}},0);
        });
        for(const key of ['CHAT_CHANGED','MORE_MESSAGES_LOADED'])if(types[key])c.eventSource.on(types[key],refresh);
    }
    globalThis.STWordReplacerPrompt=async(messages,_size,_abort,type)=>{
        if(!getSettings().prompt||!getSettings().enabled)return;
        const c=getContext();
        if(messages.some(m=>m.extra?.reasoning))regexPromise??=loadNativeRegex().catch(()=>null);
        const nativeRegex=regexPromise?await regexPromise:null;
        transformPrompt(messages,getSettings(),getRunner(),{sourceChat:c.chat,reasoning:c.powerUserSettings?.reasoning,expand:c.substituteParams??(s=>s),nativeRegex,type});
    };
    refresh();return {refresh,render,nativeFormatting};
}
