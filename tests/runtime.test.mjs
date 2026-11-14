import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, compile } from '../engine.js';
import { installRuntime } from '../runtime.js';

function host({native=true,source='原词',iframe=false}={}) {
    const settings={...createSettings(),contextual:false,groups:[{id:'test',name:'示例',enabled:true,rules:[
        {from:'原词',to:'新词',enabled:true},{from:'新词',to:'再改',enabled:true},
    ]}]};
    const handlers=new Map(),hooks=[],updates=[],errors=[];
    const element={iframe,editing:false,reasoningEdit:false,output:source,
        querySelector(selector){return selector.includes('textarea')?(this.editing||this.reasoningEdit?{}:null):(this.iframe?{}:null);},
        querySelectorAll(){return [];},getAttribute(){return '0';}};
    globalThis.document={querySelector:()=>element,querySelectorAll:()=>[element],getElementById:()=>null};
    const context={chat:[{mes:source,is_user:false,extra:{reasoning:'原词'},swipes:[source]}],
        eventTypes:Object.fromEntries(['MESSAGE_EDITED','MESSAGE_UPDATED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_SWIPED','CHAT_CHANGED','MORE_MESSAGES_LOADED'].map(k=>[k,k])),
        eventSource:{on(key,fn){const list=handlers.get(key)??[];list.push(fn);handlers.set(key,list);}},
        updateMessageBlock(id,message){updates.push({id,message});element.output=native?format(message.extra?.display_text??message.mes,{messageId:id,isUser:message.is_user,isSystem:message.is_system}):message.extra?.display_text??message.mes;element.iframe=false;},
    };
    if(native)context.messageFormatter={stage:{BEFORE_REGEX:'beforeRegex'},order:{EARLY:10},addHook(fn,options){hooks.push({fn,options});}};
    const format=(input,meta={})=>hooks.reduce((text,hook)=>hook.fn(text,{messageId:0,isUser:false,isSystem:false,isReasoning:false,...meta}),input);
    const emit=(key,id=0)=>{for(const fn of handlers.get(key)??[])fn(id);};
    const runtime=installRuntime(()=>context,()=>settings,()=>compile(settings),{onError:e=>errors.push(e)});
    return {settings,context,element,hooks,handlers,updates,errors,format,emit,runtime};
}

// 每个宿主的初始化刷新计时器在结束前排空，避免跨用例访问全局 DOM。
const settle=()=>new Promise(resolve=>setTimeout(resolve,150));

test('新版接口在 Markdown 前仅替换一次，保留源消息、代码、swipes 和推理',async()=>{
    const input='原词\n```html\n<html><body>原词</body></html>\n```',h=host({source:input});
    const original=structuredClone(h.context.chat);
    assert.equal(h.hooks.length,1);assert.equal(h.hooks[0].options.stage,'beforeRegex');
    assert.equal(h.format(input),'新词\n```html\n<html><body>原词</body></html>\n```');
    assert.equal(h.format('原词',{isReasoning:true}),'原词');
    assert.equal(h.format('原词',{isUser:true}),'原词');
    assert.equal(h.format('原词',{isSystem:true}),'原词');
    h.context.chat[0].extra.type='narrator';assert.equal(h.format('原词'),'原词');delete h.context.chat[0].extra.type;
    assert.equal(h.format('原词',{messageId:-1}),'新词');
    assert.deepEqual(h.context.chat,original);
    await settle();assert.equal(h.updates.length,0);assert.deepEqual(h.errors,[]);
});

test('原生渲染事件、设置刷新和总开关不会销毁已运行的 iframe',async()=>{
    const h=host({source:'原词\n```html\n<body>界面</body>\n```'});
    h.element.output=h.format(h.context.chat[0].mes);h.element.iframe=true;
    for(const key of ['CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_UPDATED','MORE_MESSAGES_LOADED'])h.emit(key);
    h.runtime.refresh();await settle();assert.equal(h.element.iframe,true);assert.equal(h.updates.length,0);
    h.settings.enabled=false;h.runtime.refresh();await settle();assert.equal(h.element.iframe,true);
    assert.equal(h.format(h.context.chat[0].mes),h.context.chat[0].mes);
    assert.equal(h.updates.length,0);
});

test('普通消息改词或关闭时更新一次，配色与无变化刷新不重画，结果不串改',async()=>{
    const h=host();h.element.output=h.format('原词');h.emit('CHAT_CHANGED');
    h.runtime.render(0);assert.equal(h.updates.length,0);
    h.settings.theme='pink';h.runtime.render(0);assert.equal(h.updates.length,0);
    h.settings.groups[0].rules[0].to='更新词';h.runtime.render(0);assert.equal(h.element.output,'更新词');assert.equal(h.updates.length,1);
    assert.equal(h.updates[0].message,h.context.chat[0]);
    h.settings.enabled=false;h.runtime.render(0);assert.equal(h.element.output,'原词');assert.equal(h.updates.length,2);
    h.runtime.render(0);assert.equal(h.updates.length,2);
    h.settings.enabled=true;h.settings.groups[0].rules[0].to='新词';h.runtime.render(0);assert.equal(h.element.output,'新词');
    h.settings.display=false;h.runtime.render(0);assert.equal(h.element.output,'原词');
    await settle();assert.equal(h.updates.length,4);
});

test('原生编辑选项、显示覆盖与切换聊天后的缓存正确',async()=>{
    const h=host();h.settings.edited=false;h.emit('MESSAGE_EDITED');assert.equal(h.format('原词'),'原词');
    h.emit('MESSAGE_UPDATED');assert.equal(h.format('原词'),'新词');
    h.context.chat[0].extra.display_text='原词覆盖';assert.equal(h.format('原词覆盖'),'新词覆盖');
    h.settings.enabled=false;h.runtime.render(0);assert.equal(h.element.output,'原词覆盖');
    h.settings.enabled=true;h.context.chat=[{mes:'原词新聊天',is_user:false}];h.element.output=h.format('原词新聊天');h.emit('CHAT_CHANGED');
    h.settings.enabled=false;h.runtime.render(0);assert.equal(h.element.output,'原词新聊天');
    h.settings.enabled=true;h.element.reasoningEdit=true;const before=h.updates.length;h.runtime.render(0);assert.equal(h.updates.length,before);
    h.element.reasoningEdit=false;await settle();assert.equal(h.element.output,'新词新聊天');
});

test('原生代码块不依赖整条消息的事后刷新，词库错误不破坏宿主渲染',async()=>{
    const h=host({source:'```js\nconst text = "原词";\n```'});
    assert.equal(h.format(h.context.chat[0].mes),h.context.chat[0].mes);
    h.settings.groups=null;assert.equal(h.format('原词'),'原词');assert.equal(h.errors.length,1);
    h.settings.enabled=false;await settle();assert.equal(h.updates.length,0);
});

test('旧版无命中、停用和 HTML 消息不重绘；普通消息仍能替换和恢复',async()=>{
    const h=host({native:false,source:'无需替换'});
    h.runtime.render(0);assert.equal(h.updates.length,0);
    h.context.chat[0].mes='原词';h.settings.enabled=false;h.runtime.render(0);assert.equal(h.updates.length,0);
    h.settings.enabled=true;h.runtime.render(0);assert.equal(h.element.output,'新词');
    h.runtime.render(0);assert.equal(h.updates.length,1);
    h.settings.enabled=false;h.runtime.render(0);assert.equal(h.element.output,'原词');assert.equal(h.updates.length,2);
    h.settings.enabled=true;h.context.chat[0].mes='<html><body>原词</body></html>';h.runtime.render(0);assert.equal(h.updates.length,2);
    h.context.chat[0].mes='原词';h.element.iframe=true;h.runtime.render(0);assert.equal(h.element.iframe,true);assert.equal(h.updates.length,2);
    await settle();assert.equal(h.updates.length,2);
});

test('旧版重新渲染普通消息后重新替换，不误用上一次 DOM 缓存',async()=>{
    const h=host({native:false});h.runtime.render(0);assert.equal(h.element.output,'新词');
    h.element.output='原词';h.emit('CHARACTER_MESSAGE_RENDERED');await settle();assert.equal(h.element.output,'新词');assert.equal(h.updates.length,2);
    const request=[{...h.context.chat[0],extra:{}}];await globalThis.STWordReplacerPrompt(request,0,()=>{},'normal');assert.equal(request[0].mes,'新词');assert.equal(h.context.chat[0].mes,'原词');
});
