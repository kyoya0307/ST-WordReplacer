import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,createBlankSettings,validateSettings} from '../engine.js';
import {validateFilters} from '../filters.js';
const config=()=>({...createBlankSettings(),ruleGroups:[{id:'g',name:'清理',enabled:true,defaultAction:'clause',rules:[{id:'r',kind:'keywords',keywords:['待删'],matchMode:'any',action:'clause',enabled:true,respectProtection:true}]}],protectionGroups:[{id:'p',name:'保护',enabled:true,targets:['all'],terms:[{id:'t',text:'小三花',enabled:true}]}]});
function check(s,input,expected){const result=compile(s).run(input,{trace:true,explain:true});assert.equal(result.text,expected);let replay=input;for(const e of [...result.edits].reverse())replay=replay.slice(0,e.start)+e.text+replay.slice(e.end);assert.equal(replay,expected);}

test('分句、整句和自定边界删除仅留下保护词，其他命中部分继续删除',()=>{
    for(const action of ['clause','sentence']){const s=config();s.ruleGroups[0].rules[0].action=action;check(s,'待删的小三花。她坐下。','小三花她坐下。');}
    const s=config();Object.assign(s.ruleGroups[0].rules[0],{kind:'boundary',keyword:'待删',startChars:'。',endChars:'。'});check(s,'待删的小三花。她坐下。','小三花她坐下。');
    check(config(),'待删小三花待删小三花。','小三花小三花');
});
test('只删伴随条件下的目标分句，保护范围不会扩大到所在分句',()=>{
    const s=config(),r=s.ruleGroups[0].rules[0];r.keywords=['平'];r.filters=validateFilters({contains:['声音'],scope:'sentence'});
    check(s,'小三花发出声音，语调很平。','小三花发出声音。');
    check(s,'小三花的声音很平。','小三花');
    check(s,'小三花发出声音，她走过平原。','小三花发出声音。');
});
test('受保护词内部的关键词不触发删句；同句另一次独立命中继续清理',()=>{
    const s=config();s.ruleGroups[0].rules[0].keywords=['小三'];check(s,'小三花发出声音。','小三花发出声音。');check(s,'小三花遇见小三。','小三花');
});
test('书名整体识别，书名内部关键词与同句外部关键词分别判断',()=>{
    const s=config();s.protectTitles=true;s.ruleGroups[0].rules[0].keywords=['绝望'];
    check(s,'她正在读《最后的绝望》。','她正在读《最后的绝望》。');
    check(s,'她拿着《最后的绝望》陷入绝望。','《最后的绝望》');
    s.groups=[{id:'w',name:'词库',enabled:true,rules:[{from:'最后',to:'最初',enabled:true}]}];check(s,'《最后的绝望》。最后。','《最后的绝望》。最初。');
    const round=validateSettings(s);assert.equal(round.protectTitles,true);round.protectTitles=false;check(round,'她正在读《最后的绝望》。','');
});
test('重叠保护词全部覆盖，代码围栏闭合之后的正文仍可处理',()=>{
    const s=config();s.ruleGroups=[];s.protectionGroups[0].terms=['北京大学','大学城'].map(text=>({text,enabled:true}));s.groups=[{id:'w',name:'字',enabled:true,rules:[{from:'城',to:'镇',enabled:true},{from:'待删',to:'',enabled:true}]}];
    check(s,'北京大学城。城。','北京大学城。镇。');
    check(s,'```待删```待删`保留`','```待删````保留`');
});
test('进阶清理优先与分类作用域分别生效，开关与往返保留',()=>{
    const s=config(),r=s.ruleGroups[0].rules[0];r.respectProtection=false;check(validateSettings(s),'待删小三花。','');r.respectProtection=true;
    const second={...r,id:'r2',respectProtection:false};s.ruleGroups[0].rules.push(second);check(s,'待删小三花。','');
    second.enabled=false;check(s,'待删小三花。','小三花');s.protectionGroups[0].terms[0].enabled=false;check(s,'待删小三花。','');
});
test('部分对白保留保护词与成对引号，删空对白仍清理引导语',()=>{
    check(config(),'她说：“待删小三花。”她转身。','她说：“小三花”她转身。');
    check(config(),'她说：“待删。”她转身。','她转身。');
});
