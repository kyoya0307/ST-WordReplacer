import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,compile} from '../engine.js';
import {installNovelReader} from '../novel-reader.js';

function host({ready=true}={}){
    const listeners=new Map();
    globalThis.document={body:{},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),querySelectorAll:()=>[]};
    globalThis.MutationObserver=class{observe(){}disconnect(){}};
    const settings=createBlankSettings();settings.groups=[{id:'g',name:'词库',enabled:true,rules:[{from:'原词',to:'替换词',enabled:true},{from:'替换词',to:'串改',enabled:true}]}];
    let runner=compile(settings),visible;
    const source=Object.freeze({mes:'原词',is_user:false,swipes:Object.freeze(['原词','第二个原词']),extra:Object.freeze({})}),array=Object.freeze([source]),chapter={messages:array},info={messages:array,chapters:[chapter]};
    const reader={async loadChat(){return info;},getChapter:()=>chapter,getChapters:()=>[chapter],async renderChapter(){},async renderChapterBlock(){return null;}};
    const original=reader.loadChat,api={extName:'ST-Novel-Reader',reader},errors=[];
    if(ready)visible=api;
    const bridge=installNovelReader(()=>settings,()=>runner,{getReader:()=>visible,onError:e=>errors.push(e)});
    return {settings,chapter,info,reader,source,array,bridge,errors,original,update(){runner=compile(settings);},appear(){visible=api;listeners.get('pointerdown')?.();}};
}

test('小说阅读器只生成显示副本，保留消息与版本原文，替换结果不串改',async()=>{
    const h=host();try{
        const info=await h.reader.loadChat();assert.equal(info.messages,h.array);assert.equal(info.messages[0],h.source);
        const rendered=h.reader.getChapter(1).messages[0];assert.equal(rendered.mes,'替换词');assert.deepEqual(rendered.swipes,['替换词','第二个替换词']);
        assert.notEqual(rendered,h.source);assert.equal(h.source.mes,'原词');assert.deepEqual(h.source.swipes,['原词','第二个原词']);
        assert.equal(h.chapter.messages[0],rendered);assert.deepEqual(h.errors,[]);
    }finally{h.bridge.dispose();}assert.equal(h.reader.loadChat,h.original);assert.equal(h.chapter.messages,h.array);
});

test('小说阅读器沿用单条、总开关、显示范围，并从原文重新计算',()=>{
    const h=host();try{
        const text=()=>h.chapter.messages[0].mes;
        for(const change of [()=>h.settings.enabled=false,()=>h.settings.display=false,()=>h.settings.assistant=false,()=>h.settings.groups[0].rules[0].enabled=false]){
            change();h.update();assert.equal(text(),'原词');
            h.settings.enabled=true;h.settings.display=true;h.settings.assistant=true;h.settings.groups[0].rules[0].enabled=true;h.update();assert.equal(text(),'替换词');
        }
        h.settings.groups[0].rules[0].to='更新词';h.update();assert.equal(text(),'更新词');assert.equal(h.source.mes,'原词');
    }finally{h.bridge.dispose();}
});

test('小说阅读器在插件之后出现也能接入，原有章节与新加载章节均使用当前规则',async()=>{
    const h=host({ready:false});try{
        assert.equal(h.reader.loadChat,h.original);assert.equal(h.chapter.messages[0].mes,'原词');
        h.appear();assert.notEqual(h.reader.loadChat,h.original);assert.equal(h.chapter.messages[0].mes,'替换词');
        assert.equal((await h.reader.loadChat()).chapters[0].messages[0].mes,'替换词');assert.deepEqual(h.errors,[]);
    }finally{h.bridge.dispose();}
});

test('小说阅读器可从聊天信息读取章节，部分接口只读时保持可用',async()=>{
    const h=host({ready:false});try{
        delete h.reader.getChapters;h.reader.getChatInfo=()=>h.info;
        Object.defineProperty(h.reader,'getChapter',{value:h.reader.getChapter,writable:false,configurable:true});
        h.appear();assert.equal(h.reader.getChatInfo().chapters[0].messages[0].mes,'替换词');
        assert.equal((await h.reader.loadChat()).messages[0].mes,'原词');assert.deepEqual(h.errors,[]);
    }finally{h.bridge.dispose();}
});
