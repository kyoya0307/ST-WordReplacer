import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings,validateSettings,compile,createTransfer,pasteTransfer} from '../engine.js';
import {CONTEXT_RULES,createContextOptions,compileContext} from '../legacy.js';

const rule=(id,from,to,enabled=true)=>({id,from,to,enabled});
const fixture=()=>({...createSettings(),groups:[{id:'source',name:'来源',enabled:true,rules:[rule('a','旧称','新称'),rule('b','标记','',false)]},{id:'target',name:'目标',enabled:true,rules:[]}]});
const transfer=(s,mode='cut')=>createTransfer(s.groups[0],new Set(['a','b']),mode);
test('剪切先保留原项，粘贴后才移动，空替换与开关不丢失',()=>{
    const s=fixture(),clip=transfer(s);assert.equal(s.groups[0].rules.length,2);
    const result=pasteTransfer(s,'target',clip);
    assert.equal(result.moved,2);assert.equal(result.remaining.length,0);assert.equal(s.groups[0].rules.length,0);
    assert.deepEqual(s.groups[1].rules.map(r=>[r.from,r.to,r.enabled]),[['旧称','新称',true],['标记','',false]]);
    assert.notEqual(s.groups[1].rules[0].id,'a');
});
test('取消剪切或覆盖剪贴内容不会删除原项；复制可重复粘贴',()=>{
    const s=fixture();transfer(s);let clip=transfer(s,'copy');
    pasteTransfer(s,'target',clip);pasteTransfer(s,'target',clip);
    assert.equal(s.groups[0].rules.length,2);assert.equal(s.groups[1].rules.length,2);
});
test('剪切冲突默认留在来源，相同目标完整接收后才移除',()=>{
    const s=fixture();s.groups[1].rules=[rule('c','旧称','另称')];
    const result=pasteTransfer(s,'target',transfer(s));
    assert.equal(result.moved,1);assert.equal(result.remaining.length,1);assert.equal(s.groups[0].rules[0].from,'旧称');
    assert.equal(s.groups[1].rules[0].to,'另称');
    pasteTransfer(s,'target',{...transfer(s),rules:result.remaining},'overwrite');assert.equal(s.groups[0].rules.length,0);
});
test('剪切遇到停用状态不一致，不丢失来源启用规则',()=>{
    const s=fixture();s.groups[1].rules=[rule('c','旧称','新称',false)];
    let result=pasteTransfer(s,'target',transfer(s));assert.equal(result.remaining.length,1);assert.equal(s.groups[0].rules[0].enabled,true);
    s.groups[1].rules[0].to='别称';result=pasteTransfer(s,'target',transfer(s),'disabled');
    assert.equal(result.moved,0);assert.equal(s.groups[0].rules.length,1);assert.equal(s.groups[1].rules.at(-1).enabled,false);
});
test('剪切来源修改、删除、同类粘贴均原子拒绝',()=>{
    for(const change of [s=>s.groups[0].rules[0].to='修改',s=>s.groups[0].rules.pop(),s=>s.groups.shift()]){
        const s=fixture(),clip=transfer(s);change(s);const before=structuredClone(s);
        assert.throws(()=>pasteTransfer(s,'target',clip),/修改|删除/);assert.deepEqual(s,before);
    }
    const s=fixture();assert.throws(()=>pasteTransfer(s,'source',transfer(s)),/其他分类/);assert.equal(s.groups[0].rules.length,2);
});
test('剪切按移动后总量检查容量，复制超量不部分写入',()=>{
    const s=fixture();s.groups[1].rules=Array.from({length:19998},(_,i)=>rule(`f${i}`,`填充${i}`,'值'));
    const copy=transfer(s,'copy');assert.throws(()=>pasteTransfer(s,'target',copy),/20000/);assert.equal(s.groups[1].rules.length,19998);
    assert.equal(pasteTransfer(s,'target',transfer(s)).moved,2);assert.equal(s.groups[1].rules.length,20000);
});
test('原始 13 个步骤分为 7 组，典型语境及保护项保持原行为',()=>{
    assert.equal(CONTEXT_RULES.length,7);assert.equal(CONTEXT_RULES.reduce((n,r)=>n+r.steps.length,0),13);
    const r=compileContext();
    const cases=[['臭娘们',''],['去他妈的！','去他的！'],['去他妈！','去他！'],['操你妈','劁'],['我操！','我劁！'],['操！','劁！'],['他妈的！','！'],['你他妈！','你！'],['真他娘！','真！'],['这他娘！','这！'],['都是他妈！','都是！'],['妈的！','！'],['三八！','！']];
    for(const [input,expected] of cases)assert.equal(r.run(r.run(input,'before'),'after'),expected,input);
    for(const input of ['去他妈的家','这是他妈的家','别碰他妈的东西','我想他妈的手艺了','操作说明','体操课','你娘真好','三八妇女节','三八线','一三八'])assert.equal(r.run(r.run(input,'before'),'after'),input,input);
});
test('逐项关闭、固定替换文字、命中名称及规则顺序',()=>{
    const s=createSettings();s.groups=[];
    s.contextOptions.rules.number.enabled=false;assert.equal(compile(s).run('三八！').text,'三八！');
    s.contextOptions.rules.number={enabled:true,replacement:'$1 新称'};
    const result=compile(s).run('三八！');assert.equal(result.text,'$1 新称！');assert.equal(result.hits[0].group,'特殊句式 · 数字与固定名称判断');assert.equal(result.hits[0].from,'三八');
    s.contextOptions.rules.direction.replacement='已处理';assert.equal(compile(s).run('去他妈的！').text,'已处理！');
    assert.equal(compile(s).run('去他妈的家').text,'去他妈的家');
    s.contextual=false;assert.equal(compile(s).run('三八！').text,'三八！');
});
test('保护表按文字转义，动作字和空表可编辑',()=>{
    const options=createContextOptions();options.nouns.push('礼物','a.b','$&');options.verbs+='读$';
    let r=compileContext(options);
    for(const input of ['去他妈的礼物','他妈的a.b','读他妈的！','他妈的$&','$他妈的！'])assert.equal(r.run(input,'after'),input);
    assert.equal(r.run('他妈的axb','after'),'axb');
    options.nouns=[];options.verbs='';r=compileContext(options);assert.equal(r.run('是他妈的家','after'),'是家');
});
test('特殊句式配置可备份，旧备份自动补齐，非法配置拒绝',()=>{
    const s=createSettings();s.contextOptions.rules.number.replacement='中性称呼';s.contextOptions.rules.prefix.enabled=false;
    s.contextOptions.nouns.push('礼物');const restored=validateSettings(JSON.parse(JSON.stringify(s)));assert.deepEqual(restored.contextOptions,s.contextOptions);
    delete s.contextOptions;assert.deepEqual(validateSettings(s).contextOptions,createContextOptions());
    assert.throws(()=>validateSettings({...s,contextOptions:{nouns:['']}}),/保护表/);
    assert.throws(()=>validateSettings({...s,contextOptions:{rules:{number:{replacement:123}}}}),/替换文字/);
});
test('全局保护词和代码块也保护自定义句式，不被特例覆盖',()=>{
    const s=createSettings();s.groups=[];s.contextOptions.rules.number.replacement='中性称呼';s.exceptions=['三八称呼'];
    assert.equal(compile(s).run('三八称呼 `三八` 三八！').text,'三八称呼 `三八` 中性称呼！');
});
