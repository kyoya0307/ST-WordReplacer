// 用途：流式正文实时更新。
// Streaming events precede ST's DOM write. Observe the active reply as well as
// tokens, and coalesce updates without postponing them until generation ends.
export function installStreamingDisplay(getContext,{patch,onError=console.error,interval=40}={}){
    const context=getContext(),types=context.eventTypes??context.event_types??{};
    const streamEvent=types.STREAM_TOKEN_RECEIVED??types.SMOOTH_STREAM_TOKEN_RECEIVED;
    if(!streamEvent)return;
    let state=null,timer=null,observer=null,watched=null;
    const pending=new Map(),Observer=globalThis.MutationObserver??globalThis.window?.MutationObserver;
    const cancel=()=>{clearTimeout(timer);timer=null;state=null;pending.clear();observer?.disconnect();watched=null;};
    const observe=()=>{
        if(!observer||!state)return;
        const chat=document.getElementById('chat');
        if(chat){observer.observe(chat,{subtree:true,childList:true,characterData:true});watched=chat;}
    };
    const flush=()=>{
        clearTimeout(timer);timer=null;
        const ctx=getContext();if(!state||state.chat!==ctx.chat){cancel();return;}
        observer?.disconnect();
        const entries=[...pending];pending.clear();
        try{for(const [id,message]of entries)if(ctx.chat[id]===message){try{patch(id);}catch(error){onError(error);}}}
        finally{observe();}
    };
    const queue=id=>{
        if(!state||!Number.isInteger(id)||id<0)return;
        const ctx=getContext();if(state.chat!==ctx.chat){cancel();return;}
        const active=state.processor?.messageId;
        if(Number.isInteger(active)&&active>=0&&id!==active)return;
        if(!ctx.chat[id])return;
        state.targets.set(id,ctx.chat[id]);pending.set(id,ctx.chat[id]);if(timer===null)timer=setTimeout(flush,interval);
    };
    const queueElement=element=>{
        const root=element?.closest?.('.mes_text'),message=root?.closest('.mes[mesid]');
        if(message)queue(Number(message.getAttribute('mesid')));
    };
    if(Observer)observer=new Observer(records=>{
        for(const record of records){
            queueElement(record.target.nodeType===3?record.target.parentElement:record.target);
            for(const node of record.addedNodes??[])if(node.nodeType===1){
                queueElement(node);
                for(const root of node.querySelectorAll?.('.mes_text')??[])queueElement(root);
            }
        }
    });
    context.eventSource.on(streamEvent,()=>{
        const ctx=getContext(),processor=ctx.streamingProcessor;
        if(processor?.type==='impersonate'){cancel();return;}
        if(!state||state.chat!==ctx.chat||state.processor!==processor){cancel();state={chat:ctx.chat,processor,targets:new Map()};observe();}
        else if(watched!==document.getElementById('chat')){observer?.disconnect();observe();}
        queue(processor?.messageId);
    });
    const finish=()=>{if(state){queue(state.processor?.messageId);flush();}cancel();};
    for(const key of ['GENERATION_ENDED','GENERATION_STOPPED'])if(types[key])context.eventSource.on(types[key],finish);
    for(const key of ['GENERATION_STARTED','CHAT_CHANGED'])if(types[key])context.eventSource.on(types[key],cancel);
    return {isActive:id=>{const chat=getContext().chat;return !!state&&state.chat===chat&&state.targets.get(id)===chat[id];}};
}
