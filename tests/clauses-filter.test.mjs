import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,compile,validateSettings} from '../engine.js';
import {validateRule} from '../model.js';
import {validateFilters} from '../filters.js';
const slow=(extra={})=>({...createBlankSettings(),groups:[],ruleGroups:[{id:'slow',name:'相邻分句',enabled:true,defaultAction:'clause',rules:[{id:'pair',kind:'keywords',keywords:['慢点','没人和你抢'],matchMode:'all',action:'clause',enabled:true,respectProtection:true,filters:{maxClauses:2,ordered:true,...extra}}]}]});
test('共同出现可以限定相邻分句和先后顺序，保留其他正文与标点',()=>{
 const run=t=>compile(validateSettings(slow())).run(t).text;
 assert.equal(run('吃慢点，没人和你抢。'),'');assert.equal(run('慢点吃，没人和你抢。'),'');
 assert.equal(run('她递来盘子，慢点吃，没人和你抢。窗外下雨。'),'她递来盘子。窗外下雨。');
 assert.equal(run('甲，吃慢点，没人和你抢，乙。'),'甲，乙。');
 for(const t of ['慢点吃，我去拿水，没人和你抢。','没人和你抢，你慢点。','慢点走。没人和你抢。','慢点吃。','没人和你抢。'])assert.equal(run(t),t);
});
test('重复关键词采用局部配对，多次命中及引号标点保持完整',()=>{
 const run=t=>compile(validateSettings(slow())).run(t).text;
 assert.equal(run('慢点走，我去开门，你慢点吃，没人和你抢。'),'慢点走，我去开门。');
 assert.equal(run('吃慢点，没人和你抢。喝慢点，没人和你抢。'),'');
 assert.equal(run('她说：“慢点吃，没人和你抢。”随后转身。'),'随后转身。');
});
test('可选分句条件兼容既有不限范围的规则，往返保留并校验输入',()=>{
 const s=slow();s.ruleGroups[0].rules[0].filters={};assert.equal(compile(validateSettings(s)).run('慢点吃，我去拿水，没人和你抢。').text,'');
 const out=validateSettings(slow());assert.equal(out.ruleGroups[0].rules[0].filters.maxClauses,2);assert.equal(out.ruleGroups[0].rules[0].filters.ordered,true);
 for(const maxClauses of [-1,51,1.5,'2'])assert.throws(()=>validateFilters({maxClauses}));assert.throws(()=>validateFilters({ordered:1}));
});
test('去掉固定开头保留任意中间汉字和结尾，边界、保护与开关继续适用',()=>{
 const s=createBlankSettings();s.groups=[];s.ruleGroups=[{id:'degree',name:'程度',enabled:true,defaultAction:'word',rules:[{id:'trim',kind:'pattern',prefix:'极',min:1,max:1,suffix:'的',action:'trimPrefix',enabled:true,respectProtection:true,filters:{exceptBefore:['北','南','积']}}]}];
 assert.equal(compile(validateSettings(s)).run('极轻的脚步和极重的箱子，极罕的字。北极冷的天气。').text,'轻的脚步和重的箱子，罕的字。北极冷的天气。');
 s.protectionGroups=[{id:'keep',name:'范围',enabled:true,targets:['degree'],terms:[{id:'t',text:'极重的箱子',enabled:true}]}];assert.equal(compile(validateSettings(s)).run('极重的箱子。').text,'极重的箱子。');
 s.ruleGroups[0].rules[0].enabled=false;assert.equal(compile(validateSettings(s)).run('极轻的脚步。').text,'极轻的脚步。');
 assert.throws(()=>validateRule({kind:'keywords',keywords:['极'],action:'trimPrefix'}));
});
