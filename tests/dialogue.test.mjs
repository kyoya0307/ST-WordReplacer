// 用途：规则与显示行为回归测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,validateSettings,compile} from '../engine.js';
import {compileSentenceRules} from '../sentences.js';

const settings=(action='clause')=>validateSettings({...createBlankSettings(),groups:[],ruleGroups:[{id:'clean',name:'清理',enabled:true,rules:[{id:'one',kind:'keywords',keywords:['待删'],matchMode:'any',action,enabled:true,respectProtection:true}]}],protectionGroups:[]});
const run=(text,action='clause')=>compile(settings(action)).run(text).text;

test('对白删空清理引导语，同行与换行的相邻正文保留',()=>{
    for(const action of ['clause','sentence'])for(const [input,output] of [
        ['她说：“待删。”她转身。','她转身。'],
        ['她说：\n“待删。”\n她转身。','她转身。'],
        ['前文。\r\n她问：\r\n“待删。”\r\n她转身。','前文。\r\n她转身。'],
        ['她说，\n“待删。”\n她转身。','她转身。'],
        ['她低声说：“待删。”她转身。','她转身。'],
        ['小林回答：「待删。」她转身。','她转身。'],
        ['她说：“待删”她转身。','她转身。'],
    ])assert.equal(run(input,action),output,`${action}: ${input}`);
});

test('部分对白保留引导语与成对引号，包括多句对白及尾部分句',()=>{
    for(const [input,output] of [
        ['她说：“待删，留下这句。”她转身。','她说：“留下这句。”她转身。'],
        ['她说：\n“待删，留下这句。”','她说：\n“留下这句。”'],
        ['她说：“待删。留下这句。”她转身。','她说：“留下这句。”她转身。'],
        ['她说：“留下这句。待删。”她转身。','她说：“留下这句。”她转身。'],
        ['她说：“留下这句，待删。”','她说：“留下这句。”'],
        ['她说："待删，留下。"','她说："留下。"'],
    ])assert.equal(run(input),output,input);
});

test('独立动作、相邻对白及嵌套对白各自保持边界',()=>{
    for(const [input,output] of [
        ['她推开门，低声说：“待删。”她转身。','她推开门。她转身。'],
        ['她推开门，低声说：“待删。”','她推开门。'],
        ['她推开门。她说：“待删。”她转身。','她推开门。她转身。'],
        ['她说：“待删。”她问：“留下？”','她问：“留下？”'],
        ['她说：“待删。”她问：“待删。”她坐下。','她坐下。'],
        ['她说：“她问：‘待删。’”她坐下。','她坐下。'],
        ['她说：“待删，留下。她问：‘待删。’”','她说：“留下。”'],
    ])assert.equal(run(input),output,input);
});

test('多条规则共同删空对白；文字删除保持原有范围',()=>{
    const s=settings();s.ruleGroups[0].rules.push({...s.ruleGroups[0].rules[0],id:'two',keywords:['清理乙']});
    assert.equal(compile(s).run('她说：“待删。清理乙。”她坐下。').text,'她坐下。');
    assert.equal(run('她说：“待删。”','word'),'她说：“。”');
});

test('规则停用、代码与局部保护生效，清理保持可重放的原文位置',()=>{
    const input='她说：\n“待删。”\n她坐下。';
    for(const mutate of [s=>s.enabled=false,s=>s.ruleGroups[0].enabled=false,s=>s.ruleGroups[0].rules[0].enabled=false]){
        const s=settings();mutate(s);assert.equal(compile(s).run(input).text,input);
    }
    assert.equal(run('```text\n'+input+'\n```'),'```text\n'+input+'\n```');
    const s=settings();s.protectionGroups=[{id:'keep',name:'保留',enabled:true,targets:[s.ruleGroups[0].id],terms:[{id:'k',text:'待删保留',enabled:true}]}];
    assert.equal(compile(s).run('她说：“待删。待删保留。”').text,'她说：“待删保留。”');
    for(const text of [input,'她说：“待删，留下。”','她说：“待删。待删。”她坐下。']){
        const result=compile(settings()).run(text,{trace:true});let replay=text;
        for(const e of [...result.edits].reverse())replay=replay.slice(0,e.start)+e.text+replay.slice(e.end);
        assert.equal(replay,result.text);
    }
});

test('旧模板、旧边界与自我纠错规则具有相同的对白收尾行为',()=>{
    for(const rule of [{keywords:['待删'],matchMode:'any',scope:'clause',enabled:true},{keyword:'待删',enabled:true}]){
        const clean=compileSentenceRules([rule]);
        assert.equal(clean('她说：\n“待删。”\n她坐下。').text,'她坐下。');
    }
    const s=settings();s.ruleGroups[0].rules=[{id:'self',kind:'correction',action:'correction',keywords:['喉结'],cues:['不对'],enabled:true,respectProtection:true}];
    const clean=compile(validateSettings(s));
    assert.equal(clean.run('她说：“她的喉结——不对，她没有喉结，她低下头。”').text,'她说：“她低下头。”');
    assert.equal(clean.run('她说：“她的喉结——不对，她没有喉结。”她坐下。').text,'她坐下。');
});
