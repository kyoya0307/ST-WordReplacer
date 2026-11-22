// 用途：规则与显示行为回归测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings,validateSettings,compile} from '../engine.js';
import {sentenceTemplate,compileSentenceRules,validateSentenceRules} from '../sentences.js';
import {displayCopy,transformPrompt} from '../runtime.js';
const config=(preset='punctuation')=>({...createSettings(),groups:[],sentenceRules:[{id:'s',...sentenceTemplate('声音很平',preset)}]});
test('关键词删除从上一个标点之后到句末，保留相邻句子与起点标点',()=>{
    const r=compile(config());
    assert.equal(r.run('前句。声音很平。后句。').text,'前句。后句。');
    const input='他点头，声音很平，但语速快。下一句。',out=r.run(input);
    assert.equal(out.text,'他点头，下一句。');assert.equal(out.deletions[0].text,'声音很平，但语速快。');
    assert.equal(input.slice(out.deletions[0].start,out.deletions[0].end),out.deletions[0].text);
});
test('完整句子模式跨过逗号冒号，支持自定义边界',()=>{
    const s=config('sentence');assert.equal(compile(s).run('前句。他点头，声音很平，但语速快。后句。').text,'前句。后句。');
    s.sentenceRules[0].startChars='|';s.sentenceRules[0].endChars='|';
    assert.equal(compile(s).run('保留|声音很平，内容|后文').text,'保留|后文');
});
test('没有末尾标点、连续结束标点、换行均有明确边界',()=>{
    const r=compile(config());
    assert.equal(r.run('前句。声音很平').text,'前句。');
    assert.equal(r.run('声音很平？！……后句。').text,'后句。');
    assert.equal(r.run('前句。\r\n声音很平\r\n后句。').text,'前句。\r\n\r\n后句。');
    assert.equal(r.run('前句。\r声音很平\r后句。').text,'前句。\r\r后句。');
});
test('移除句段内成对引号的末尾闭引号，保留外层叙述的闭引号',()=>{
    const r=compile(config());
    assert.equal(r.run('她说：“声音很平。”后句。').text,'后句。');
    assert.equal(r.run('她说：“前句。声音很平。”后句。').text,'她说：“前句。”后句。');
    assert.equal(r.run('"声音很平。"后句。').text,'后句。');
});
test('同句重复关键词和重叠规则合并删除范围，不重复删除',()=>{
    const s=config('sentence');s.sentenceRules.push({id:'b',...sentenceTemplate('语速快','sentence')});
    const result=compile(s).run('声音很平，声音很平，语速快。保留。');
    assert.equal(result.text,'保留。');assert.equal(result.deletions.length,1);assert.deepEqual(result.deletions[0].keywords,['声音很平','语速快']);
});
test('关键词是纯文字，正则符号不会成为表达式',()=>{
    const run=compileSentenceRules([sentenceTemplate('a.b')]);assert.equal(run('a.b!axb!').text,'axb!');
});
test('保护词或代码块涉及的句段跳过删除，其他句段仍可删除',()=>{
    const s=config();s.exceptions=['需要保留'];
    assert.equal(compile(s).run('声音很平，需要保留。声音很平。').text,'声音很平，需要保留。');
    assert.equal(compile(s).run('声音很平，`代码`。后句。').text,'声音很平，`代码`。后句。');
    assert.equal(compile(s).run('```\n声音很平。\n```\n声音很平。').text,'```\n声音很平。\n```\n');
});
test('句段规则在普通词库之前执行，关闭开关时保留原行为',()=>{
    const s=config();s.groups=[{id:'g',name:'普通',enabled:true,rules:[{id:'r',from:'声音很平',to:'平静',enabled:true}]}];
    assert.equal(compile(s).run('声音很平。').text,'');
    s.sentenceRules[0].enabled=false;assert.equal(compile(s).run('声音很平。').text,'平静。');
    s.sentenceRules[0].enabled=true;s.contextual=false;assert.equal(compile(s).run('声音很平。').text,'平静。');
    s.enabled=false;assert.equal(compile(s).run('声音很平。').text,'声音很平。');
});
test('句段规则备份往返、旧备份默认空列表及错误配置校验',()=>{
    const s=config(),restored=validateSettings(JSON.parse(JSON.stringify(s)));
    assert.equal(restored.ruleGroups[0].rules[0].keyword,'声音很平');assert.equal(compile(restored).run('声音很平。').text,'');
    delete s.sentenceRules;assert.deepEqual(validateSettings(s).sentenceRules,[]);
    for(const keyword of ['','\n','跨\n行','x'.repeat(2001)])assert.throws(()=>validateSentenceRules([sentenceTemplate(keyword)]));
    assert.throws(()=>validateSentenceRules(Array.from({length:201},()=>sentenceTemplate('词'))));
    assert.throws(()=>validateSentenceRules([{keyword:'词',startChars:{}}]));
});
test('句段删除只改变显示和请求副本，聊天原文保持',()=>{
    const s=config(),r=compile(s),source={mes:'声音很平。保留。',is_user:false};
    assert.equal(displayCopy(source,s,r).mes,'保留。');assert.equal(source.mes,'声音很平。保留。');
    const request=[source];transformPrompt(request,s,r);assert.equal(request[0].mes,'保留。');assert.equal(source.mes,'声音很平。保留。');
});
