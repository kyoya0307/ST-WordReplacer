import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,validateSettings,compile} from '../engine.js';
import {validateRule} from '../model.js';
import {searchEntries} from '../search.js';
const settings=(options={})=>({...createBlankSettings(),groups:[],ruleGroups:[{id:'correction',name:'纠错',enabled:true,defaultAction:'word',rules:[{id:'self',kind:'correction',action:'correction',keywords:['喉结','翅膀'],cues:['不对'],enabled:true,respectProtection:true,...options}]}]});
const clean=text=>compile(validateSettings(settings())).run(text).text;
test('关键词与破折号纠错提示配合，保留修正正文及相邻原文',()=>{
 assert.equal(clean('她的喉结——不对，她没有喉结，她的声音低下来。'),'她的声音低下来。');
 assert.equal(clean('她靠过来，她的喉结——不对，她没有喉结，她的声音低下来。窗外起风。'),'她靠过来，她的声音低下来。窗外起风。');
 assert.equal(clean('她的翅膀--不对，她没有翅膀，应该是她的手臂。'),'她的手臂。');
 assert.equal(clean('她的喉结——不对，是她的颈侧绷紧了。'),'她的颈侧绷紧了。');
});
test('连续解释和多次纠错分别清理，删到句末时整理逗号与引号',()=>{
 assert.equal(clean('她的喉结——不对，她没有喉结，刚才写错了，她的声音低下来。'),'她的声音低下来。');
 assert.equal(clean('她的喉结——不对，她没有喉结。她坐下。'),'她坐下。');
 assert.equal(clean('她坐下，她的喉结——不对，她没有喉结。'),'她坐下。');
 assert.equal(clean('“她的喉结——不对，她没有喉结，她的声音低下来。”'),'“她的声音低下来。”');
 assert.equal(clean('她的喉结——不对，她没有喉结，她低头。她的翅膀——不对，她没有翅膀，她转身。'),'她低头。她转身。');
});
test('缺少关键词或明确纠错标记时保留，普通不对劲及跨句关键词保持',()=>{
 for(const text of ['她的喉结动了一下。','她的喉结——不对劲，她皱眉。','她的头发——不对，她的手指。','喉结这个词出现了，今天天气——不对，是明天。','她的喉结。——不对，她的声音。','她说不对，又看了看自己的喉结。'])assert.equal(clean(text),text);
});
test('标点变体、字面关键词和自定义提示词可以配置，输入校验拒绝非法规则',()=>{
 for(const dash of ['——','—','--','－－','–'])assert.equal(clean(`她的翅膀${dash} 不对，她没有翅膀，她抬手。`),'她抬手。');
 const s=settings({keywords:['a+b'],cues:['写错了']});assert.equal(compile(validateSettings(s)).run('她的a+b——写错了，她没有a+b，她抬手。').text,'她抬手。');assert.equal(compile(validateSettings(s)).run('她的ab——写错了，她没有ab，她抬手。').text,'她的ab——写错了，她没有ab，她抬手。');
 for(const change of [{keywords:[]},{cues:[]},{cues:['']},{action:'clause'},{inheritAction:true}])assert.throws(()=>validateRule({...settings().ruleGroups[0].rules[0],...change}));
});
test('单条、分类、总开关及保护范围生效，备份往返和全局搜索保留配置',()=>{
 const source='她的喉结——不对，她没有喉结，她抬手。';
 for(const mutate of [s=>s.enabled=false,s=>s.ruleGroups[0].enabled=false,s=>s.ruleGroups[0].rules[0].enabled=false]){const s=settings();mutate(s);assert.equal(compile(validateSettings(s)).run(source).text,source);}
 const s=settings();s.protectionGroups=[{id:'keep',name:'范围保护',enabled:true,targets:['correction'],terms:[{id:'k',text:'没有喉结',enabled:true}]}];const round=validateSettings(s);assert.equal(compile(round).run(source).text,source);assert.equal(compile(round).run('```text\n'+source+'\n```').text,'```text\n'+source+'\n```');
 assert.equal(round.ruleGroups[0].rules[0].kind,'correction');assert.deepEqual(round.ruleGroups[0].rules[0].cues,['不对']);assert.equal(searchEntries(round,'不对')[0].item.kind,'correction');
});
test('纠错清理与词库替换可在同次处理衔接，原文位置追踪一致',()=>{
 const s=settings();s.groups=[{id:'words',name:'称呼',enabled:true,rules:[{from:'低下来',to:'轻下来',enabled:true}]}];const input='她的喉结——不对，她没有喉结，她的声音低下来。';const result=compile(validateSettings(s)).run(input,{trace:true});let text=input;for(const e of [...result.edits].reverse())text=text.slice(0,e.start)+e.text+text.slice(e.end);assert.equal(text,result.text);assert.equal(result.text,'她的声音轻下来。');
});
