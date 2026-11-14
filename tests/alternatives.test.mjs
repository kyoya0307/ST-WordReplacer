import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings,validateSettings,compile,inspectRules,enableAlternatives,addAlternative,selectAlternative,editAlternative,removeAlternative,setReplacement,matchesRule,createTransfer,pasteTransfer,planPaste} from '../engine.js';
const fixture=()=>({...createSettings(),contextual:false,groups:[{id:'a',name:'分类甲',enabled:true,rules:[{id:'r',from:'词',to:'用词',enabled:true},{id:'normal',from:'旧称',to:'新称',enabled:true}]},{id:'b',name:'分类乙',enabled:true,rules:[]}]});
test('普通词条无候选字段，启用单条不改变其他词或默认结果',()=>{
    const s=fixture(),[r,normal]=s.groups[0].rules,original=structuredClone(normal);
    assert.equal(compile(s).run('词 旧称').text,'用词 新称');enableAlternatives(r,true);addAlternative(r,'措辞');
    assert.equal(compile(s).run('词 旧称').text,'用词 新称');assert.deepEqual(normal,original);
    assert.equal(Object.hasOwn(validateSettings(s).groups[0].rules[1],'alternatives'),false);
});
test('仅选中的候选生效且不随机，关闭候选模式保留当前值和备用项',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'措辞');selectAlternative(r,'措辞');
    for(let i=0;i<5;i++)assert.equal(compile(s).run('词词').text,'措辞措辞');
    enableAlternatives(r,false);assert.equal(compile(s).run('词').text,'措辞');assert.deepEqual(r.alternatives,['用词','措辞']);
    setReplacement(r,'表述');enableAlternatives(r,true);assert.deepEqual(r.alternatives,['用词','表述']);assert.equal(r.to,'表述');
});
test('空候选表示删除，换行及美元符号为普通文字；编辑当前项同步替换',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'');selectAlternative(r,'');
    assert.equal(compile(s).run('词！').text,'！');editAlternative(r,1,'新\n$&');assert.equal(compile(s).run('词').text,'新\n$&');
    assert.throws(()=>removeAlternative(r,1),/先选择/);removeAlternative(r,0);assert.deepEqual(r.alternatives,['新\n$&']);
});
test('候选备份往返和旧版词条兼容，非法候选与无效选中值拒绝',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'措辞');selectAlternative(r,'措辞');
    const restored=validateSettings(JSON.parse(JSON.stringify(s))).groups[0].rules[0];assert.equal(restored.to,'措辞');assert.deepEqual(restored.alternatives,r.alternatives);
    for(const change of [r=>r.alternatives=[],r=>r.alternatives=['别词'],r=>r.alternatives=[{}],r=>r.multiple='true']){
        const invalid=structuredClone(s);change(invalid.groups[0].rules[0]);assert.throws(()=>validateSettings(invalid));
    }
    enableAlternatives(r,false);assert.equal(validateSettings(s).groups[0].rules[0].multiple,false);
});
test('拒绝重复、过长或过多候选，失败时保留原状态',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'措辞');
    const before=structuredClone(r);assert.throws(()=>addAlternative(r,'措辞'),/相同/);assert.throws(()=>editAlternative(r,1,'用词'),/相同/);assert.throws(()=>editAlternative(r,1,'x'.repeat(10001)),/10000/);assert.deepEqual(r,before);
    for(let i=2;i<50;i++)addAlternative(r,`候选${i}`);assert.throws(()=>addAlternative(r,'超出'),/50/);assert.equal(r.alternatives.length,50);
});
test('备用候选不产生冲突，选中值变化才改变跨分类冲突；搜索可找到备用项',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'措辞');s.groups[1].rules=[{id:'other',from:'词',to:'用词',enabled:true}];
    assert.equal(inspectRules(s)[0].kind,'duplicate');assert.equal(matchesRule(r,'措辞'),true);assert.equal(compile(s).conflicts.length,0);
    selectAlternative(r,'措辞');assert.equal(inspectRules(s)[0].kind,'conflict');assert.equal(compile(s).conflicts.length,1);
});
test('复制和剪切保留完整候选且不共享数组；剪切后修改候选被拦截',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'措辞');selectAlternative(r,'措辞');
    const copied=createTransfer(s.groups[0],new Set(['r']),'copy');pasteTransfer(s,'b',copied);
    assert.deepEqual(s.groups[1].rules[0].alternatives,r.alternatives);editAlternative(s.groups[1].rules[0],0,'改名');assert.equal(r.alternatives[0],'用词');assert.equal(copied.rules[0].alternatives[0],'用词');
    const cut=createTransfer(s.groups[0],new Set(['r']),'cut');addAlternative(r,'新增');assert.throws(()=>pasteTransfer(s,'b',cut),/修改/);
    const fresh=createTransfer(s.groups[0],new Set(['r']),'cut');assert.equal(pasteTransfer(s,'b',fresh,'overwrite').moved,1);assert.equal(s.groups[0].rules.length,1);assert.deepEqual(s.groups[1].rules[0].alternatives,['用词','措辞','新增']);
});
test('当前替换相同而候选不同的粘贴需选择策略，跳过不丢失候选',()=>{
    const s=fixture(),r=s.groups[0].rules[0];enableAlternatives(r,true);addAlternative(r,'措辞');s.groups[1].rules=[{id:'target',from:'词',to:'用词',enabled:true}];
    const cut=createTransfer(s.groups[0],new Set(['r']),'cut');assert.equal(planPaste(s.groups[1],cut.rules).conflicts.length,1);
    assert.equal(pasteTransfer(s,'b',cut).moved,0);assert.deepEqual(r.alternatives,['用词','措辞']);assert.equal(s.groups[1].rules[0].alternatives,undefined);
    assert.equal(pasteTransfer(s,'b',cut,'overwrite').moved,1);assert.deepEqual(s.groups[1].rules[0].alternatives,['用词','措辞']);
});
