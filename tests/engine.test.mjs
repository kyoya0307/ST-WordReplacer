import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, validateSettings, validateExceptions, compile, parseBatch, replaceMessage, inspectRules, planPaste, pasteRules } from '../engine.js';
import { displayCopy, transformPrompt } from '../runtime.js';
function custom(rules, extras={}) {
    return {...createSettings(),contextual:false,groups:[{id:'test',name:'测试',enabled:true,rules:rules.map(([from,to])=>({from,to,enabled:true}))}],...extras};
}
test('迁入原词库 124 条并保留原值',()=>{
    const s=createSettings();assert.equal(s.groups.flatMap(g=>g.rules).length,124);
    assert.equal(compile(s).run('巾帼不让须眉，旺夫相，命硬克夫。').text,'，锦程相，命格自强。');
    assert.equal(s.user,false);assert.equal(s.edited,true);assert.equal(s.display,true);assert.equal(s.prompt,true);
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

test('空值词条全局删除，不漏掉第二个词或后续重复，重复调用结果一致',()=>{
    const s=custom([['草稿标记',''],['说明标记',''],['附注标记','']]),r=compile(s);
    const input='草稿标记甲说明标记乙附注标记丙。'.repeat(30);
    for(let i=0;i<5;i++){
        const out=r.run(input);assert.equal(out.text,'甲乙丙。'.repeat(30));
        assert.deepEqual(out.hits.map(h=>h.count),[30,30,30]);
    }
    assert.equal(displayCopy({mes:input,is_user:false},s,r).mes,'甲乙丙。'.repeat(30));
    const request=[{mes:input,is_user:false}];transformPrompt(request,s,r);assert.equal(request[0].mes,'甲乙丙。'.repeat(30));
});

test('保护词可阻止空值词条删除，未保护的重复仍全部删除',()=>{
    const s=custom([['标记','']],{exceptions:['完整标记词']}),r=compile(s);
    assert.equal(r.run('完整标记词，标记，完整标记词，标记。').text,'完整标记词，，完整标记词，。');
    const out=validateSettings({...s,exceptions:['完整标记词','完整标记词']});assert.deepEqual(out.exceptions,['完整标记词']);
    assert.deepEqual(validateExceptions(['甲','','甲','乙']),['甲','乙']);
    assert.throws(()=>validateExceptions(['甲'.repeat(2001)]));assert.throws(()=>validateExceptions(Array.from({length:5001},(_,i)=>String(i))));
    assert.throws(()=>validateExceptions([null]));
});
test('批量支持三种分隔符、删除和注释',()=>{
    const r=parseBatch('# 注释\n原 → 新\n删 =>\n旧\t新\n');assert.deepEqual(r.map(x=>[x.from,x.to]),[['原','新'],['删',''],['旧','新']]);
    assert.throws(()=>parseBatch('正确→替换\n错误行'),/第 2 行/);
    assert.throws(()=>parseBatch('→替换'),/原词为空/);
});
test('批量支持半角全角等号和短横箭头，按首个分隔符解析并保留两侧内容',()=>{
    const rows=parseBatch('单车=自行车\n标记=\n晚霞＝夕光\n甲->乙\na-b=c-d\n公式=x=y\n旧=>新\n网址=https://example.test/a-b?q=1');
    assert.deepEqual(rows.map(r=>[r.from,r.to]),[['单车','自行车'],['标记',''],['晚霞','夕光'],['甲','乙'],['a-b','c-d'],['公式','x=y'],['旧','新'],['网址','https://example.test/a-b?q=1']]);
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
test('重复只提示，仅同时启用的不同替换列为冲突，并显示当前胜出规则',()=>{
    const s=custom([['甲','乙']]);s.groups.push({id:'b',name:'分类二',enabled:true,rules:[{id:'2',from:'甲',to:'乙',enabled:true}]});
    assert.equal(inspectRules(s)[0].kind,'duplicate');assert.deepEqual(compile(s).conflicts,[]);
    s.groups[1].rules[0].to='丙';let issue=inspectRules(s)[0];assert.equal(issue.kind,'conflict');assert.equal(issue.activeConflict,true);assert.equal(issue.winner.group,'分类二');
    s.groups[1].enabled=false;assert.deepEqual(inspectRules(s),[]);assert.deepEqual(compile(s).conflicts,[]);
    s.groups[1].enabled=true;s.groups[1].rules[0].enabled=false;assert.deepEqual(inspectRules(s),[]);assert.deepEqual(compile(s).conflicts,[]);
    s.groups[1].rules[0].enabled=true;assert.equal(inspectRules(s)[0].kind,'conflict');
});

test('停用版本不把已启用的相同替换变成冲突；检查结果不包含停用项',()=>{
    const s=custom([['旧称','新称']]);
    s.groups.push({id:'b',name:'相同版本',enabled:true,rules:[{from:'旧称',to:'新称',enabled:true}]},
        {id:'c',name:'停用版本',enabled:false,rules:[{from:'旧称',to:'另一称呼',enabled:true}]});
    assert.equal(inspectRules(s)[0].kind,'duplicate');assert.equal(inspectRules(s)[0].rows.length,2);assert.deepEqual(compile(s).conflicts,[]);
    s.groups[2].enabled=true;assert.deepEqual(compile(s).conflicts,['旧称']);
    s.groups[2].rules[0].enabled=false;assert.deepEqual(compile(s).conflicts,[]);
    s.groups.forEach(g=>{g.enabled=false;});assert.deepEqual(inspectRules(s),[]);
});
test('复制粘贴保留空替换/多行/开关，为复制项生成新 ID',()=>{
    const g={rules:[]},incoming=[{id:'old',from:'带\n换行',to:'',enabled:false}];
    pasteRules(g,incoming);assert.equal(g.rules[0].from,incoming[0].from);assert.equal(g.rules[0].to,'');assert.equal(g.rules[0].enabled,false);assert.notEqual(g.rules[0].id,'old');assert.equal(incoming[0].id,'old');
    pasteRules(g,incoming);assert.equal(g.rules.length,1);
});
test('粘贴预览与三种冲突策略，失败时不产生部分修改',()=>{
    const incoming=[{from:'原',to:'新',enabled:true},{from:'新增',to:'值',enabled:true}];
    const target=()=>({rules:[{id:'a',from:'原',to:'旧',enabled:true}]});
    let g=target();assert.equal(planPaste(g,incoming).conflicts.length,1);pasteRules(g,incoming);assert.equal(g.rules[0].to,'旧');assert.equal(g.rules.length,2);
    g=target();pasteRules(g,incoming,'overwrite');assert.equal(g.rules[0].to,'新');
    g=target();pasteRules(g,incoming,'disabled');assert.equal(g.rules[1].enabled,false);assert.equal(g.rules[1].to,'新');
    g=target();assert.throws(()=>pasteRules(g,incoming,'disabled',0));assert.equal(g.rules.length,1);assert.equal(g.rules[0].to,'旧');
});
test('目标分类已有多个同名不同替换时，不把冲突误判为相同重复',()=>{
    const g={rules:[{id:'a',from:'原',to:'旧',enabled:true},{id:'b',from:'原',to:'新',enabled:true}]};
    const input=[{from:'原',to:'新'}];assert.equal(planPaste(g,input).conflicts.length,1);pasteRules(g,input,'overwrite');assert.deepEqual(g.rules.map(r=>r.to),['新','新']);
});
test('旧版迁移保留用户词库，新版导入保留用户关闭编辑选项',()=>{
    const old={...custom([['原','新']]),version:1,edited:false};const s=validateSettings(old);assert.equal(s.version,4);assert.equal(s.edited,true);assert.equal(s.groups[0].rules[0].from,'原');
    assert.equal(validateSettings({...s,edited:false}).edited,false);
});
test('显示替换创建副本，聊天正文、swipes、推理和显示覆盖原值完全保留',()=>{
    const s=custom([['原','新']]),r=compile(s);
    const m={mes:'原',is_user:false,swipe_id:0,swipes:['原'],extra:{reasoning:'原',display_text:'原'}};
    const snapshot=structuredClone(m),out=displayCopy(m,s,r);
    assert.equal(out.mes,'新');assert.equal(out.extra.display_text,'新');assert.deepEqual(m,snapshot);
    assert.equal(displayCopy(m,{...s,display:false},r),m);
    assert.equal(displayCopy({...m,is_user:true},s,r).mes,'原');
    assert.equal(displayCopy({...m,extra:{type:'narrator'}},s,r).mes,'原');
});
test('提示词替换仅改请求对象，保留源消息、其他角色及原对象引用',()=>{
    const s=custom([['原','新']]),r=compile(s),source=[{mes:'原',is_user:false},{mes:'原',is_user:true},{mes:'原',is_system:true}];
    const messages=[...source];transformPrompt(messages,s,r,{sourceChat:source});
    assert.deepEqual(messages.map(m=>m.mes),['新','原','原']);assert.equal(source[0].mes,'原');assert.notEqual(messages[0],source[0]);
    assert.throws(()=>transformPrompt(source,s,r,{sourceChat:source}),/拒绝/);
    const disabled=[...source];transformPrompt(disabled,{...s,prompt:false},r);assert.equal(disabled[0].mes,'原');
});
test('提示词中包含推理时保留完整推理前缀，只处理正文',()=>{
    const s=custom([['原','新']]),r=compile(s),m={mes:'<think>原推理</think>\n原正文',extra:{reasoning:'原推理'}};
    const request=[m];transformPrompt(request,s,r,{reasoning:{prefix:'<think>',suffix:'</think>',separator:'\n'}});
    assert.equal(request[0].mes,'<think>原推理</think>\n新正文');assert.equal(m.mes,'<think>原推理</think>\n原正文');
    const incomplete=[{mes:'<think>原推理',extra:{reasoning:'原推理'}}];transformPrompt(incomplete,s,r,{reasoning:{prefix:'<think>',suffix:'</think>'},type:'continue'});assert.equal(incomplete[0].mes,'<think>原推理');
});
test('原生正则已处理推理时识别真实前缀，不改推理',()=>{
    const s=custom([['原','新']]),r=compile(s),request=[{mes:'原已格式化\n原正文',extra:{reasoning:'原推理'}}];
    transformPrompt(request,s,r,{reasoning:{separator:'\n'},nativeRegex:{regex_placement:{REASONING:6},getRegexedString:()=> '原已格式化'}});
    assert.equal(request[0].mes,'原已格式化\n新正文');
});
