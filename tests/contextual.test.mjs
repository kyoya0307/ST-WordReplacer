// 用途：规则与显示行为回归测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,createSettings,compile,validateSettings} from '../engine.js';
import {contextGroup,validateRule,syncGroups,literalConflicts} from '../model.js';
import {createContextOptions} from '../legacy.js';
import {validateFilters} from '../filters.js';
import {CONTEXT_GUIDES} from '../context-guide.js';
const config=(filters={})=>({...createBlankSettings(),ruleGroups:[{id:'g',name:'条件示例',enabled:true,defaultAction:'word',rules:[{id:'r',name:'水果称呼',kind:'keywords',keywords:['苹果'],matchMode:'any',action:'replace',to:'水果',enabled:true,respectProtection:true,filters:validateFilters(filters)}]}]});
const ctx=()=>({...createBlankSettings(),ruleGroups:[contextGroup(createContextOptions())]});

test('说明中的修改示例与实际单条处理一致，正常用法在单条及组合执行时保留',()=>{
    const expected={combination:'',direction:'去他的！',exclamation:'我劁！',kinship:'！',prefix:'真！',isolated:'！',number:'！'};
    const all=compile(ctx());
    for(const [id,guide] of Object.entries(CONTEXT_GUIDES)){
        const s=ctx();s.ruleGroups[0].rules=s.ruleGroups[0].rules.filter(r=>r.template===id);const single=compile(s);
        assert.equal(single.run(guide.change).text,expected[id],id);
        for(const input of guide.normal){assert.equal(single.run(input).text,input,`${id} single: ${input}`);assert.equal(all.run(input).text,input,`${id} all: ${input}`);}
    }
});

test('新增正常亲属表达保护限定对应规则，开关、用户替换、补充条件和字面替换保持独立',()=>{
    for(const [id,input,old] of [['combination','去老婆娘家吃饭。','去家吃饭。'],['exclamation','操妈妈的心。','劁妈的心。'],['prefix','这些都是她妈送的。','这些都是送的。']]){
        const s=ctx();s.ruleGroups[0].rules=s.ruleGroups[0].rules.filter(r=>r.template===id);const r=s.ruleGroups[0].rules[0];
        assert.equal(compile(s).run(input).text,input);
        r.safeContext=false;assert.equal(compile(s).run(input).text,old);
        r.enabled=false;assert.equal(compile(s).run(input).text,input);
    }
    const s=ctx();s.ruleGroups[0].rules=s.ruleGroups[0].rules.filter(r=>r.template==='exclamation');const r=s.ruleGroups[0].rules[0];
    r.action='replace';r.to='惊叹';assert.equal(compile(s).run('我操！').text,'惊叹！');assert.equal(compile(s).run('操妈妈的心。').text,'操妈妈的心。');
    r.filters=validateFilters({excludes:['示例']});assert.equal(compile(s).run('示例：我操！').text,'示例：我操！');
    s.groups=[{id:'w',name:'单字',enabled:true,rules:[{from:'妈',to:'亲',enabled:true}]}];assert.equal(compile(s).run('操妈妈的心。').text,'操亲亲的心。');
});
test('成对示例：前接、后接、前接保留、后接保留条件使用字面列表',()=>{
    const cases=[
        [{before:['红']},'红苹果，青苹果。','红水果，青苹果。'],
        [{after:['汁']},'苹果汁和苹果树。','水果汁和苹果树。'],
        [{exceptBefore:['青']},'青苹果，红苹果。','青苹果，红水果。'],
        [{exceptAfter:['公司']},'苹果公司，桌上有苹果。','苹果公司，桌上有水果。'],
        [{before:['a.b']},'a.b苹果，axb苹果。','a.b水果，axb苹果。'],
    ];for(const [filters,input,output]of cases)assert.equal(compile(config(filters)).run(input).text,output);
});
test('伴随词与保留词明确区分分句和整句，换行保持边界',()=>{
    const s=config({contains:['品牌'],scope:'clause'});assert.equal(compile(s).run('品牌叫苹果，桌上有苹果。').text,'品牌叫水果，桌上有苹果。');
    s.ruleGroups[0].rules[0].filters.scope='sentence';assert.equal(compile(s).run('品牌叫苹果，桌上有苹果。').text,'品牌叫水果，桌上有水果。');
    assert.equal(compile(config({excludes:['品牌']})).run('这个品牌叫苹果。桌上有苹果。').text,'这个品牌叫苹果。桌上有水果。');
    assert.equal(compile(config({contains:['品牌']})).run('品牌。\n桌上有苹果。').text,'品牌。\n桌上有苹果。');
});
test('独立出现条件使用完整 Unicode 汉字，分隔边界包含标点与空白',()=>{
    const s=config({boundary:'han'});s.ruleGroups[0].rules[0].keywords=['草稿'];
    assert.equal(compile(s).run('草稿。草稿纸。𠮷草稿。').text,'水果。草稿纸。𠮷草稿。');
    s.ruleGroups[0].rules[0].filters.boundary='separated';assert.equal(compile(s).run('a草稿。 草稿。').text,'a草稿。 水果。');
});
test('共同出现可限定同分句与最大间隔，近处重复命中仍能处理',()=>{
    const s=config({scope:'clause'}),r=s.ruleGroups[0].rules[0];Object.assign(r,{keywords:['声音','平'],matchMode:'all',action:'clause'});delete r.to;
    assert.equal(compile(s).run('她点头，声音传来，语调平静。').text,'她点头，声音传来，语调平静。');
    r.filters.scope='sentence';r.filters.distance=3;
    assert.equal(compile(s).run('她点头，声音很平。').text,'她点头。');
    assert.equal(compile(s).run('声音传到了很远的地方，语调很平。').text,'声音传到了很远的地方，语调很平。');
    assert.equal(compile(s).run('声音传到了很远的地方，声音很平。').text,'声音传到了很远的地方。');
});
test('附加条件先判断再扩展删除范围，保留原因可见',()=>{
    const s=config({exceptAfter:['公司']}),r=s.ruleGroups[0].rules[0];r.action='clause';delete r.to;
    const result=compile(s).run('苹果公司发布消息，桌上有苹果。',{explain:true,trace:true});
    assert.equal(result.text,'苹果公司发布消息。');assert.equal(result.preserved[0].reason,'命中后接保留条件');
    let replay='苹果公司发布消息，桌上有苹果。';for(const e of [...result.edits].reverse())replay=replay.slice(0,e.start)+e.text+replay.slice(e.end);assert.equal(replay,result.text);
});
test('旧 7 类语境完整迁入普通规则分类，开关、固定替换及阶段保留',()=>{
    const s=createSettings();s.groups=[];s.contextOptions.rules.number.replacement='固定称呼';s.contextOptions.rules.prefix.enabled=false;
    const next=validateSettings(s),g=next.ruleGroups.find(g=>g.rules.some(r=>r.kind==='context'));
    assert.equal(g.rules.length,7);assert.equal(next.contextual,false);assert.equal(g.rules.find(r=>r.template==='prefix').enabled,false);assert.equal(compile(next).run('三八！').text,'固定称呼！');
    assert.equal(g.rules.find(r=>r.template==='number').action,'replace');
    const again=validateSettings(next);assert.equal(again.ruleGroups.flatMap(g=>g.rules).filter(r=>r.kind==='context').length,7);
});
test('新版语境保护修复后续覆盖与表外所属结构，独立触发继续处理',()=>{
    const run=compile(ctx());
    for(const input of ['这些都是他妈的手机。','我拜访了他妈的茶馆。','去他妈的家取书。','𠮷操𠮷','三八大桥通车。'])assert.equal(run.run(input).text,input,input);
    assert.equal(run.run('他妈的！').text,'！');assert.equal(run.run('三八！').text,'！');assert.equal(run.run('操！').text,'劁！');
    assert.equal(run.run('这些都是他妈的手机。',{explain:true}).preserved.some(p=>p.reason.includes('保护')||p.reason.includes('所属')),true);
});
test('语境保护策略可单条选择；关闭后沿用原处理，表外内容由附加条件保留',()=>{
    const s=ctx();for(const r of s.ruleGroups[0].rules)r.safeContext=false;
    assert.equal(compile(s).run('我拜访了他妈的茶馆。').text,'我拜访了茶馆。');
    for(const r of s.ruleGroups[0].rules)r.filters=validateFilters({excludes:['茶馆']});
    assert.equal(compile(s).run('我拜访了他妈的茶馆。').text,'我拜访了他妈的茶馆。');
});
test('语境模板遵守指定分类和共享保护，普通单字替换独立生效',()=>{
    const s=ctx(),g=s.ruleGroups[0];s.protectionGroups=[{id:'p',name:'保护',enabled:true,targets:[g.id],terms:[{text:'三八',enabled:true}]}];assert.equal(compile(s).run('三八！').text,'三八！');
    s.groups=[{id:'w',name:'单字',enabled:true,rules:[{id:'a',from:'妈',to:'亲',enabled:true}]}];assert.equal(compile(s).run('我拜访了他妈的茶馆。').text,'我拜访了他亲的茶馆。');
});
test('前后条件和策略可导出恢复；非法条件原子拒绝',()=>{
    const s=ctx();s.ruleGroups[0].rules[0].filters=validateFilters({exceptBefore:['【引用】']});
    const copy=validateSettings(JSON.parse(JSON.stringify(s)));assert.deepEqual(copy.ruleGroups[0].rules[0].filters.exceptBefore,['【引用】']);
    assert.throws(()=>validateFilters({distance:-1}));assert.throws(()=>validateFilters({before:['']}));assert.throws(()=>validateFilters({scope:'paragraph'}));
    assert.throws(()=>validateRule({kind:'context',template:'unknown',action:'context'}));assert.throws(()=>validateRule({kind:'context',template:'number',action:'sentence'}));
});
test('全局保护片段仍参与同句条件判断，保护内容本身保持原样',()=>{
    const s=ctx(),r=s.ruleGroups[0].rules.find(r=>r.template==='number');r.safeContext=false;r.filters=validateFilters({excludes:['品牌']});
    s.protectionGroups=[{id:'p',name:'全局',enabled:true,targets:['all'],terms:[{text:'品牌',enabled:true}]}];
    assert.equal(compile(s).run('品牌：三八。').text,'品牌：三八。');
    r.filters=validateFilters({contains:['品牌']});assert.equal(compile(s).run('品牌：三八。').text,'品牌：。');
});
test('语境规则只执行一次，停用卡片不会被遗留总开关重新激活',()=>{
    const s=ctx();for(const r of s.ruleGroups[0].rules)r.enabled=false;s.contextual=true;
    const next=validateSettings(s);assert.equal(next.contextual,false);assert.equal(compile(next).run('三八！').text,'三八！');
});
test('明确互斥的前接条件各自处理，不列为同词冲突',()=>{
    const s=config({before:['红']}),g=s.ruleGroups[0];g.rules.push({...g.rules[0],id:'b',to:'青色水果',filters:validateFilters({before:['青']})});
    assert.equal(literalConflicts(s).length,0);assert.equal(compile(s).run('红苹果，青苹果。').text,'红水果，青青色水果。');
    g.rules[1].filters.before=['大红'];assert.equal(literalConflicts(s).length,1);
});
