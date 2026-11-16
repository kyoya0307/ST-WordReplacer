import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,createSettings,validateSettings,compile} from '../engine.js';
import {groupState,setGroupEnabled,syncGroups,validateRule,literalConflicts} from '../model.js';
const wordGroup=(id='w',from='旧称',to='新称')=>({id,name:id,enabled:true,rules:[{id:id+'r',from,to,enabled:true}]});
const pattern=()=>({id:'p',name:'程度修饰',kind:'pattern',prefix:'极',suffix:'的',min:1,max:1,action:'word',enabled:true,respectProtection:true});
const ruleGroup=(rules=[pattern()],more={})=>({id:'g',name:'句子清理',enabled:true,defaultAction:'clause',concealed:true,rules,...more});
const replay=(input,edits)=>{for(const e of [...edits].reverse())input=input.slice(0,e.start)+e.text+input.slice(e.end);return input;};
test('新安装使用空白配置；旧配置迁入词库、规则和保护词，停用分类真实停用',()=>{
    const blank=createBlankSettings();assert.equal(blank.version,4);assert.equal(blank.groups[0].rules.length,0);assert.equal(blank.contextual,false);
    const old={...createSettings(),contextual:false,groups:[wordGroup(),{...wordGroup('off'),enabled:false},{...wordGroup('remove','【待删】',''),deleteScope:'clause'}],exceptions:['操作说明']};
    const before=compile(old),next=validateSettings(old);
    assert.equal(next.groups.length,2);assert.equal(next.groups[1].rules[0].enabled,false);assert.equal(next.ruleGroups.length,1);assert.equal(next.ruleGroups[0].concealed,false);assert.equal(next.protectionGroups[0].terms[0].text,'操作说明');
    for(const input of ['她点头，【待删】这句是草稿。她坐下。','旧称，旧称。操作说明。'])assert.equal(compile(next).run(input).text,before.run(input).text);
    assert.deepEqual(old.groups[1].rules[0].enabled,true);
});
test('分类三态使用真实条目状态，单条开启即部分启用，总开关暂停保留选择',()=>{
    const g=wordGroup();g.rules.push({id:'second',from:'早上',to:'清晨',enabled:false});assert.equal(groupState(g).mixed,true);
    setGroupEnabled(g,false);assert.equal(groupState(g).active,0);g.rules[0].enabled=true;const s={...createBlankSettings(),groups:[g]};syncGroups(s);assert.equal(g.enabled,true);assert.equal(groupState(g).mixed,true);
    s.enabled=false;assert.equal(compile(s).run('旧称').text,'旧称');assert.equal(g.rules[0].enabled,true);
    setGroupEnabled(g,true);assert.equal(groupState(g).checked,true);
});
test('固定结构按字数全局处理，支持罕见汉字，标点和换行作为边界',()=>{
    const s={...createBlankSettings(),ruleGroups:[ruleGroup()]},run=compile(s);
    assert.equal(run.run('极轻的脚步，极重的门，极𠮷的字。').text,'脚步，门，字。');
    assert.equal(run.run('极，的。极\n的。极其轻的。').text,'极，的。极\n的。极其轻的。');
    s.ruleGroups[0].rules[0].max=2;assert.equal(compile(s).run('极其轻的脚步').text,'脚步');
});
test('关键词分句、整句和共同出现可独立配置，沿用分类默认值',()=>{
    const rule={id:'r',kind:'keywords',keywords:['声音','平'],matchMode:'all',action:'clause',inheritAction:true,enabled:true,respectProtection:true};
    const s={...createBlankSettings(),ruleGroups:[ruleGroup([rule])]};
    assert.equal(compile(s).run('她点头，声音传来，语调平静。她坐下。').text,'她点头。她坐下。');
    s.ruleGroups[0].defaultAction='sentence';assert.equal(compile(s).run('她点头，声音传来，语调平静。她坐下。').text,'她坐下。');
    assert.equal(compile(s).run('声音传来。天气平静。').text,'声音传来。天气平静。');
    s.ruleGroups[0].rules[0].enabled=false;syncGroups(s);assert.equal(compile(s).run('声音很平。').text,'声音很平。');
});
test('跨行标记按配对范围逐个处理，符号与替换文字按字面解释',()=>{
    const r={kind:'markers',start:'[开始]',end:'[/结束]',action:'word',enabled:true,respectProtection:true},s={...createBlankSettings(),ruleGroups:[ruleGroup([r])]};
    assert.equal(compile(s).run('甲[开始]\n草稿。\n[/结束]乙[开始]次段[/结束]丙[开始]未闭合').text,'甲乙丙[开始]未闭合');
    r.action='replace';r.to='$&';assert.equal(compile(s).run('[开始]草稿[/结束]').text,'$&');
});
test('分组保护适用于词库和规则，全部保护与强制规则分别生效',()=>{
    const s={...createBlankSettings(),groups:[wordGroup('w','极','很')],ruleGroups:[ruleGroup()],protectionGroups:[{id:'keep',name:'保护',enabled:true,targets:['g'],terms:[{text:'极轻的脚步',enabled:true}]}]};
    assert.equal(compile(s).run('极轻的脚步，极重的门。').text,'很轻的脚步，门。');
    s.protectionGroups[0].targets=['all'];assert.equal(compile(s).run('极轻的脚步，极重的门。').text,'极轻的脚步，门。');
    s.ruleGroups[0].rules[0].respectProtection=false;assert.equal(compile(s).run('极轻的脚步，极重的门。').text,'脚步，门。');
    s.ruleGroups=[];s.protectionGroups[0].targets=['w'];assert.equal(compile(s).run('极轻的脚步，极重的门。').text,'极轻的脚步，很重的门。');
});
test('指定内置语境保护保持文字，其余语境仍处理',()=>{
    const s={...createBlankSettings(),contextual:true,protectionGroups:[{id:'k',name:'语境保护',enabled:true,targets:['context'],terms:[{text:'三八',enabled:true}]}]};
    assert.equal(compile(s).run('三八').text,'三八');s.protectionGroups[0].terms[0].enabled=false;assert.equal(compile(s).run('三八').text,'');
});
test('新格式往返重映射保护目标，分类名重复时按 ID 保留范围',()=>{
    const s={...createBlankSettings(),groups:[wordGroup('w')],ruleGroups:[ruleGroup()],protectionGroups:[{id:'k',name:'保护',enabled:true,targets:['w','g'],terms:[{id:'t',text:'极轻的',enabled:true}]}]};
    const a=validateSettings(s),b=validateSettings(JSON.parse(JSON.stringify(a)));
    assert.deepEqual(b.protectionGroups[0].targets,[b.groups[0].id,b.ruleGroups[0].id]);assert.notEqual(a.groups[0].id,b.groups[0].id);assert.equal(compile(b).run('极轻的脚步，极重的门。').text,'极轻的脚步，门。');
    assert.throws(()=>validateSettings({...s,protectionGroups:[{...s.protectionGroups[0],targets:['missing']}]}));
});
test('规则编辑校验边界、缺少字段、字数范围和替换类型',()=>{
    for(const change of [{min:0},{max:31},{min:2,max:1},{prefix:''},{suffix:null},{kind:'arbitrary'},{action:'document'}])assert.throws(()=>validateRule({...pattern(),...change}));
    assert.throws(()=>validateRule({kind:'keywords',keywords:['a'],matchMode:'all',action:'replace',to:'b'}));
    assert.throws(()=>validateRule({kind:'markers',start:'a',end:'',action:'word'}));
});
test('原始位置编辑可在富文本中重放，删除与替换重叠时范围合并',()=>{
    const s={...createBlankSettings(),groups:[wordGroup('w','单车','自行车')],ruleGroups:[ruleGroup([
        pattern(),{kind:'markers',start:'[删]',end:'[/删]',action:'word',enabled:true,respectProtection:true},
        {kind:'keywords',keywords:['【待删】'],matchMode:'any',action:'clause',enabled:true,respectProtection:true},
    ])]};
    const input='极轻的脚步，单车驶来，【待删】极重的描述。[删]极高的段落。[/删]正文。';
    const result=compile(s).run(input,{trace:true});assert.equal(result.text,'脚步，自行车驶来。正文。');assert.equal(replay(input,result.edits),result.text);
});
test('多个独立规则合并尾部分句后整理逗号和句末，保留成对引号',()=>{
    const s={...createBlankSettings(),ruleGroups:[ruleGroup(['甲','乙'].map(k=>({kind:'keywords',keywords:[k],matchMode:'any',action:'clause',enabled:true,respectProtection:true})))]};
    const run=compile(s);
    assert.equal(run.run('保留，甲，乙。').text,'保留。');assert.equal(run.run('甲，乙。保留。').text,'保留。');
    assert.equal(run.run('“保留，甲，乙。”').text,'“保留。”');
});
test('跨词库和条件规则检查同词不同处理，仅列启用项，相同删除结果合并',()=>{
    const r={kind:'keywords',keywords:['旧称'],matchMode:'any',action:'clause',enabled:true,respectProtection:true},s={...createBlankSettings(),groups:[wordGroup()],ruleGroups:[ruleGroup([r])]};
    assert.equal(literalConflicts(s).length,1);r.enabled=false;assert.equal(literalConflicts(s).length,0);
    r.enabled=true;r.action='word';s.groups[0].rules[0].to='';assert.equal(literalConflicts(s).length,0);
});
