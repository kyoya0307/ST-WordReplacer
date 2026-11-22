// 用途：生成章节显示副本。
// ST-Novel-Reader compatibility. Only this extension installs the adapter;
// the reader's files, original messages and persistent chat cache stay unchanged.
import {scopeAllows} from './runtime.js';
import {patchDisplayText} from './display-dom.js';
import {uid} from './engine.js';

export function readerDisplayText(input,settings,runner){
    if(typeof input!=='string')return input;
    if(!/<!doctype\b|<\/?[a-z][^>]*>/i.test(input))return runner.run(input).text;
    // Parse into an inert template: attributes, scripts, styles and embedded UI
    // never participate in replacement. Keep fenced/inline code byte-for-byte.
    const template=document.createElement('template'),slots=[],token=uid();
    const text=input.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`|<[^>]+>/gi,code=>{
        if(code.startsWith('<')&&!/^<(script|style)\b/i.test(code))return code;
        const index=slots.push(code)-1;return `<span hidden data-wr-reader-slot="${token}-${index}"></span>`;
    });
    template.innerHTML=text;
    const placeholders=[...template.content.querySelectorAll('[data-wr-reader-slot]')].map(el=>[el.outerHTML,slots[Number(el.getAttribute('data-wr-reader-slot').slice(token.length+1))]]);
    const result=patchDisplayText(template.content,settings,runner,new WeakMap());
    if(!result.changed)return input;
    let output=template.innerHTML;
    for(const [placeholder,code]of placeholders)output=output.replace(placeholder,()=>code);
    return output;
}

export function installNovelReader(getSettings,getRunner,{getReader=()=>globalThis.NovelReader,onError=console.error}={}){
    const chapters=new WeakMap(),messages=new WeakMap(),renders=new Map(),blocks=new Map(),methods=[];
    let api=null,core=null,timer=null,revision=0,disposed=false,lastConfig='';
    const project=source=>{
        if(!source||typeof source!=='object')return source;
        const s=getSettings(),runner=getRunner();
        if(!s.display||!scopeAllows(s,source))return source;
        const old=messages.get(source),swipes=Array.isArray(source.swipes)?source.swipes:null;
        if(old?.runner===runner&&old.text===source.mes&&old.extra===source.extra&&old.swipes?.length===(swipes?.length??0)&&
            (!swipes||swipes.every((text,i)=>old.swipes[i]===text)))return old.copy;
        const copy={...source,mes:readerDisplayText(source.mes,s,runner)};
        if(swipes)copy.swipes=swipes.map(text=>readerDisplayText(text,s,runner));
        messages.set(source,{runner,text:source.mes,extra:source.extra,swipes:swipes?.slice()??[],copy});return copy;
    };
    const prepare=list=>{
        if(!Array.isArray(list))return;
        for(const chapter of list){
            if(!chapter||chapters.has(chapter))continue;
            const descriptor=Object.getOwnPropertyDescriptor(chapter,'messages');
            if(!descriptor?.configurable||!Array.isArray(descriptor.value))continue;
            // A chapter is a derived reading view. Its getter supplies new display
            // objects; neither the original array nor its messages are rewritten.
            const source=descriptor.value;chapters.set(chapter,source);
            Object.defineProperty(chapter,'messages',{configurable:descriptor.configurable,enumerable:descriptor.enumerable,
                get:()=>disposed?source:source.map(message=>{try{return project(message);}catch(error){onError(error);return message;}}),set:undefined});
        }
    };
    const prepareCurrent=()=>prepare(core?.getChapters?.()??core?.getChatInfo?.()?.chapters);
    const wrap=(name,make)=>{
        const original=core[name];if(typeof original!=='function')return;
        const descriptor=Object.getOwnPropertyDescriptor(core,name);
        if(descriptor&&(!('value'in descriptor)||!descriptor.writable))return;
        const wrapped=make(original);core[name]=wrapped;methods.push({name,original,wrapped});
    };
    const attach=()=>{
        if(disposed)return false;
        const candidate=getReader();
        if(candidate===api)return !!core;
        if(candidate?.extName!=='ST-Novel-Reader'||![candidate.reader?.getChapters,candidate.reader?.getChatInfo].some(fn=>typeof fn==='function'))return false;
        api=candidate;core=api.reader;
        wrap('loadChat',fn=>async function(...args){const result=await fn.apply(this,args);prepare(result?.chapters);return result;});
        wrap('getChapter',fn=>function(...args){const chapter=fn.apply(this,args);prepare([chapter]);return chapter;});
        wrap('getChapters',fn=>function(...args){const list=fn.apply(this,args);prepare(list);return list;});
        wrap('getChatInfo',fn=>function(...args){const info=fn.apply(this,args);prepare(info?.chapters);return info;});
        wrap('renderChapter',fn=>function(container,index,options){
            prepareCurrent();renders.set(container,{index,options});return fn.call(this,container,index,options);
        });
        wrap('renderChapterBlock',fn=>async function(...args){
            prepareCurrent();const block=await fn.apply(this,args);if(block)blocks.set(block,{index:args[1]});return block;
        });
        prepareCurrent();return true;
    };
    const redraw=async()=>{
        if(!attach())return;
        const {theme,wordPageSize,wordOrder,prompt,edited,...config}=getSettings(),key=JSON.stringify(config);
        if(key===lastConfig)return;lastConfig=key;
        prepareCurrent();const current=++revision;
        // Flip mode measures the projected chapter before splitting it. Trigger
        // its existing ResizeObserver to rebuild cached pages after a rule edit.
        for(const container of document.querySelectorAll('.novel-reader-scroll.novel-flip-mode')){
            const width=container.style.width,priority=container.style.getPropertyPriority('width');
            container.style.setProperty('width',`${Math.max(1,container.getBoundingClientRect().width-1)}px`,'important');
            requestAnimationFrame(()=>requestAnimationFrame(()=>{
                if(width)container.style.setProperty('width',width,priority);else container.style.removeProperty('width');
            }));
        }
        for(const [container,record]of renders){
            if(!container.isConnected){renders.delete(container);continue;}
            if(container.classList.contains('novel-flip-mode')||container.querySelector('.novel-chapter-block'))continue;
            const top=container.scrollTop;
            await core.renderChapter(container,record.index,{...record.options,onRendered:null});
            if(current!==revision)return;container.scrollTop=top;
        }
        for(const [block,record]of [...blocks]){
            if(!block.isConnected){blocks.delete(block);continue;}
            const scroll=block.closest('.novel-reader-scroll'),top=scroll?.scrollTop;
            const tmp=document.createElement('div'),fresh=await core.renderChapterBlock(tmp,record.index);
            if(current!==revision)return;
            if(fresh&&block.isConnected){block.replaceWith(fresh);blocks.delete(block);}
            if(scroll)scroll.scrollTop=top;
        }
    };
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>redraw().catch(onError),120);};
    const discover=()=>{try{if(!core&&attach()){observer.disconnect();document.removeEventListener('pointerdown',discover,true);refresh();}}catch(error){onError(error);}};
    const observer=new MutationObserver(discover);observer.observe(document.body,{childList:true});
    document.addEventListener('pointerdown',discover,true);discover();
    return {refresh,dispose(){
        disposed=true;clearTimeout(timer);observer.disconnect();document.removeEventListener('pointerdown',discover,true);
        for(const {name,original,wrapped}of methods)if(core?.[name]===wrapped)core[name]=original;
        renders.clear();blocks.clear();
    }};
}
