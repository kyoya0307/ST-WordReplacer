import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, validateSettings, compile, parseBatch, replaceMessage } from '../engine.js';
function custom(rules, extras={}) {
    return {...createSettings(),contextual:false,groups:[{id:'test',name:'测试',enabled:true,rules:rules.map(([from,to])=>({from,to,enabled:true}))}],...extras};
}
test('迁入原词库 124 条并保留原值',()=>{
    const s=createSettings();assert.equal(s.groups.flatMap(g=>g.rules).length,124);
    assert.equal(compile(s).run('巾帼不让须眉，旺夫相，命硬克夫。').text,'，锦程相，命格自强。');
    assert.equal(s.user,false);assert.equal(s.edited,false);
});
test('长词优先，空值删除，替换结果不串改',()=>{
    const r=compile(custom([['旺夫','X'],['旺夫相','Y'],['Y','Z'],['删','']]));
    assert.equal(r.run('旺夫相 旺夫 删').text,'Y X ');
});
test('正则特殊字符以纯文本匹配，替换文本 $& 原样保留',()=>{
    const r=compile(custom([['a.b[0]','$&'],['x+','!']]));
    assert.equal(r.run('a.b[0] aXb0 x+').text,'$& aXb0 !');
});
test('分类靠后覆盖，关闭分类和词条',()=>{
    const s=custom([['原','一']]);s.groups.push({name:'覆盖',enabled:true,rules:[{from:'原',to:'二',enabled:true}]});
    assert.equal(compile(s).run('原').text,'二');assert.deepEqual(compile(s).conflicts,['原']);
    s.groups[1].enabled=false;assert.equal(compile(s).run('原').text,'一');
    s.groups[0].rules[0].enabled=false;assert.equal(compile(s).run('原').text,'原');
});
test('保护词和各类代码块，未闭合围栏保留至结尾',()=>{
    const r=compile(custom([['小三','第三者']],{exceptions:['小三花']}));
    assert.equal(r.run('小三花 小三 `小三`\n```js\n小三\n```\n~~~\n小三\n~~~').text,'小三花 第三者 `小三`\n```js\n小三\n```\n~~~\n小三\n~~~');
    assert.equal(r.run('小三\n```小三').text,'第三者\n```小三');
});
test('保护词覆盖特殊句式，重复调用不泄漏正则位置',()=>{
    const r=compile({...createSettings(),exceptions:['他妈的']});
    assert.equal(r.run('他妈的').text,'他妈的');assert.equal(r.run('他妈的').text,'他妈的');
});
test('保留三八节和亲属句式，特殊规则可关闭',()=>{
    const s=createSettings(),r=compile(s);
    assert.equal(r.run('三八妇女节 这是他妈的家').text,'三八妇女节 这是他妈的家');
    assert.equal(r.run('操你妈').text,'劁');
    s.contextual=false;assert.equal(compile(s).run('操你妈').text,'操你妈');
});
test('关闭总开关不处理文本',()=>assert.deepEqual(compile(custom([['a','b']],{enabled:false})).run('a'),{text:'a',hits:[]}));
test('空词库不会生成空匹配正则',()=>assert.equal(compile(custom([])).run('abc').text,'abc'));
test('命中列表统计次数',()=>assert.equal(compile(custom([['甲','乙']])).run('甲甲').hits[0].count,2));
test('批量支持三种分隔符、删除和注释',()=>{
    const r=parseBatch('# 注释\n原 → 新\n删 =>\n旧\t新\n');assert.deepEqual(r.map(x=>[x.from,x.to]),[['原','新'],['删',''],['旧','新']]);
    assert.throws(()=>parseBatch('正确→替换\n错误行'),/第 2 行/);
    assert.throws(()=>parseBatch('→替换'),/原词为空/);
});
test('JSON 校验，拒绝脚本及非法空原词，不执行导入内容',()=>{
    assert.throws(()=>validateSettings({type:'script',content:'evil()'}));
    assert.throws(()=>validateSettings(custom([['','x']])));
    assert.throws(()=>validateSettings({...custom([]),exceptions:[{}]}));
    const s=custom([['<script>','<img onerror=evil()>']]);assert.equal(validateSettings(s).groups[0].rules[0].to,'<img onerror=evil()>');
});
test('有效备份往返及深拷贝',()=>{
    const s=createSettings(),copy=validateSettings(JSON.parse(JSON.stringify(s)));
    assert.equal(copy.groups.flatMap(g=>g.rules).length,124);
    copy.groups[0].rules[0].to='其他';assert.notEqual(s.groups[0].rules[0].to,'其他');
});
test('替换正文及当前 swipe，不动其他候选、推理区或系统消息',()=>{
    const runner=compile(custom([['原','新']]));const m={mes:'原',swipe_id:1,swipes:['原','原'],extra:{reasoning:'原'}};
    const snapshot=replaceMessage(m,runner);assert.equal(m.mes,'新');assert.deepEqual(m.swipes,['原','新']);assert.equal(m.extra.reasoning,'原');assert.equal(snapshot.original,'原');
    const system={mes:'原',is_system:true};assert.equal(replaceMessage(system,runner),null);assert.equal(system.mes,'原');
});
test('没有 swipe 数组的消息和无命中消息',()=>{
    const runner=compile(custom([['原','新']]));const m={mes:'原'};
    assert.equal(replaceMessage(m,runner).replacement,'新');assert.equal(replaceMessage(m,runner),null);
});
