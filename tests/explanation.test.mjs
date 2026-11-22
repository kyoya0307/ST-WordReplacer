// 用途：规则与显示行为回归测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,createBlankSettings,validateSettings} from '../engine.js';
import {contextGroup} from '../model.js';
import {createContextOptions} from '../legacy.js';
import {searchEntries} from '../search.js';
const word=(id,from,to)=>({id,name:id,enabled:true,rules:[{id:`${id}-word`,from,to,enabled:true}]});
const rule=(id,keywords,action='clause',to)=>({id,name:id,kind:'keywords',keywords,matchMode:'any',action,to,enabled:true,respectProtection:true});
const group=(id,rules)=>({id,name:id,enabled:true,defaultAction:'clause',rules});
const protect=text=>({id:'p',name:'名字保护',enabled:true,targets:['all'],terms:[{id:'p-word',text,enabled:true}]});
function explain(s,input){const plain=compile(s).run(input,{trace:true}),full=compile(s).run(input,{trace:true,explain:true});assert.equal(full.text,plain.text);assert.deepEqual(full.edits,plain.edits);for(const e of full.events)for(const r of e.ranges)assert(r.start>=0&&r.end<=input.length&&r.start<r.end);return full;}

test('命中记录区分删除、替换、手动保护与内置书名；使用准确的规则 ID',()=>{
    const s={...createBlankSettings(),protectTitles:true,groups:[word('fruit','苹果','梨'),word('draft','草稿','')],protectionGroups:[protect('苹果公司')]};
    const input='苹果公司。苹果。草稿。《最后的苹果》。',r=explain(s,input);
    assert.equal(r.text,'苹果公司。梨。。《最后的苹果》。');
    assert(r.events.some(e=>e.kind==='replace'&&e.ruleId==='fruit-word'&&e.ranges.some(p=>p.start===5)));
    assert(r.events.some(e=>e.kind==='delete'&&e.ruleId==='draft-word'));
    assert(r.events.some(e=>e.kind==='protect'&&e.sourceType==='manual'&&e.ruleId==='p-word'));
    assert(r.events.some(e=>e.kind==='protect'&&e.rule==='《书名》保护'));
    assert(r.events.some(e=>e.kind==='protect'&&e.protectors?.some(p=>p.ruleId==='p-word')));
});
test('前一阶段删字与扩展替换之后的事件仍定位到原文，包括重复词和生成文字',()=>{
    const s={...createBlankSettings(),ruleGroups:[group('清理',[rule('删草稿',['草稿'],'word'),rule('改称呼',['苹果'],'replace','鲜苹果')])],groups:[word('fruit','鲜苹果','梨')]};
    const input='草稿苹果。草稿苹果。',r=explain(s,input);assert.equal(r.text,'梨。梨。');
    const events=r.events.filter(e=>e.sourceType==='dictionary'&&e.kind==='replace');
    assert.deepEqual(events.map(e=>e.ranges),[[{start:2,end:4}],[{start:7,end:9}]]);
    assert(events.every(e=>e.text==='鲜苹果'));
});
test('多条删除共同命中保留各自来源；被覆盖替换具有胜出来源',()=>{
    const s={...createBlankSettings(),ruleGroups:[group('规则',[rule('甲',['甲']),rule('乙',['乙']),rule('改甲',['甲'],'replace','丙')])]};
    const r=explain(s,'甲乙。');assert.equal(r.text,'');
    assert(r.events.some(e=>e.kind==='delete'&&e.ruleId==='甲'));assert(r.events.some(e=>e.kind==='delete'&&e.ruleId==='乙'));
    assert(r.events.some(e=>e.kind==='overridden'&&e.ruleId==='改甲'&&e.winner));
    const d={...createBlankSettings(),groups:[word('先','苹果','梨'),word('后','苹果','桃')]};assert(explain(d,'苹果').events.some(e=>e.kind==='overridden'&&e.winner.groupId==='后'));
});
test('内置正常用法拦住重叠的词库或删句，单字替换继续独立执行',()=>{
    const s={...createBlankSettings(),ruleGroups:[contextGroup(createContextOptions()),group('删句',[rule('婆娘',['婆娘'])])],groups:[word('称呼','他妈的','他爸的')]};
    assert.equal(explain(s,'这是他妈的家。').text,'这是他妈的家。');assert.equal(explain(s,'她去老婆娘家吃饭。').text,'她去老婆娘家吃饭。');
    const literal=s.groups;s.groups=[word('单字','妈','亲')];assert.equal(explain(s,'这是他妈的家。').text,'这是他亲的家。');
    s.groups=literal;s.ruleGroups[0].rules.forEach(r=>r.enabled=false);assert.equal(explain(s,'这是他妈的家。').text,'这是他爸的家。');
});
test('亲属保留条件归本条规则，迁移旧表一次、清空真正生效、往返和搜索保留',()=>{
    const old={...createBlankSettings(),contextOptions:createContextOptions(),ruleGroups:[contextGroup(createContextOptions())]};
    old.contextOptions.nouns.push('星图');old.contextOptions.verbs+='读';old.ruleGroups[0].rules.forEach(r=>delete r.contextKeep);
    let s=validateSettings(old),r=s.ruleGroups[0].rules.find(r=>r.template==='kinship');
    assert(r.contextKeep.after.includes('星图'));assert(r.contextKeep.before.includes('读'));
    s.ruleGroups[0].rules=s.ruleGroups[0].rules.filter(x=>x===r);
    assert.equal(compile(s).run('这是他妈的星图。').text,'这是他妈的星图。');
    r.contextKeep.after=[];r.contextKeep.before=[];s.contextOptions.nouns.push('星图');s=validateSettings(s);
    assert.equal(compile(s).run('这是他妈的星图。').text,'这是星图。');
    r=s.ruleGroups[0].rules[0];r.contextKeep.after=['星图'];assert(searchEntries(s,'星图').some(x=>x.item===r));
    assert.throws(()=>validateSettings({...s,ruleGroups:[group('bad',[{...r,contextKeep:{after:['']}}])]}));
});
test('正常用法边界收紧，语气表达可清理，内置保护记录可定位到规则',()=>{
    const s={...createBlankSettings(),ruleGroups:[contextGroup(createContextOptions())]};
    for(const input of ['他妈的离谱。','他妈的家伙！'])assert.notEqual(compile(s).run(input).text,input);
    for(const input of ['我拜访了他妈的茶馆。','她拿着她娘的手稿。','这些都是她妈送的。','去他妈妈那里。'])assert.equal(explain(s,input).text,input);
    const r=explain(s,'她拿着她娘的手稿。');assert(r.events.some(e=>e.kind==='protect'&&e.sourceType==='builtin'&&e.ruleId));
});
test('条件保留与范围保护的解释各自保留，超长记录明确截断，总开关关闭无假命中',()=>{
    const r=rule('苹果',['苹果'],'replace','梨');r.filters={exceptAfter:['公司']};
    const s={...createBlankSettings(),ruleGroups:[group('水果',[r])]};assert(explain(s,'苹果公司。').events.some(e=>e.kind==='protect'&&e.ruleId==='苹果'&&e.reason.includes('公司')));
    r.filters={after:['汁']};assert(explain(s,'苹果树。').events.some(e=>e.kind==='skip'&&e.reason.includes('汁')));
    const many={...createBlankSettings(),groups:[word('fruit','苹果','梨')]};const result=compile(many).run('苹果。'.repeat(1002),{explain:true});assert.equal(result.events.length,1000);assert.equal(result.eventsTruncated,true);assert.equal(result.text,'梨。'.repeat(1002));
    many.enabled=false;assert.equal(compile(many).run('苹果',{explain:true}).events,undefined);
});
