// 自动处理只作用于显示副本和生成请求副本，从不修改 chat / swipes / extra。
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
    const render=id=>{
        const c=getContext(),m=c.chat[Number(id)];if(!m)return;
        const el=document.querySelector(`#chat .mes[mesid="${Number(id)}"]`);
        if(el?.querySelector('.edit_textarea'))return;
        c.updateMessageBlock(Number(id),displayCopy(m,getSettings(),getRunner()));
    };
    const refresh=()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>{document.querySelectorAll('#chat .mes[mesid]').forEach(el=>{try{render(Number(el.getAttribute('mesid')));}catch(e){onError(e);}});},120);
    };
    const c=getContext(),types=c.eventTypes??c.event_types;
    for(const key of ['CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_SWIPED'])if(types[key])c.eventSource.on(types[key],id=>{
        // MESSAGE_SWIPED 可在 ST 自己的重绘前发出，下一任务再刷新。
        setTimeout(()=>{try{render(id);}catch(e){onError(e);}},0);
    });
    if(types.MESSAGE_UPDATED)c.eventSource.on(types.MESSAGE_UPDATED,id=>{if(getSettings().edited)setTimeout(()=>{try{render(id);}catch(e){onError(e);}},0);});
    for(const key of ['CHAT_CHANGED','MORE_MESSAGES_LOADED'])if(types[key])c.eventSource.on(types[key],refresh);
    const chat=document.getElementById('chat');
    if(chat){const observer=new window.MutationObserver(refresh);observer.observe(chat,{childList:true});}
    globalThis.STWordReplacerPrompt=async(messages,_size,_abort,type)=>{
        if(!getSettings().prompt||!getSettings().enabled)return;
        const c=getContext();
        if(messages.some(m=>m.extra?.reasoning))regexPromise??=loadNativeRegex().catch(()=>null);
        const nativeRegex=regexPromise?await regexPromise:null;
        transformPrompt(messages,getSettings(),getRunner(),{sourceChat:c.chat,reasoning:c.powerUserSettings?.reasoning,expand:c.substituteParams??(s=>s),nativeRegex,type});
    };
    refresh();return {refresh,render};
}
