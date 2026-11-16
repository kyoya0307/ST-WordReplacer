import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings,validateSettings,compile,inspectRules} from '../engine.js';
import {templateRule} from '../templates.js';
import {displayCopy,transformPrompt} from '../runtime.js';
const config=(keywords=['标记甲'],match='any',scope='clause')=>({...createSettings(),groups:[],sentenceRules:[{id:'t',...templateRule(keywords,match,scope)}]});
test('分句删除的句首、中间、句尾标点，以及无标点末句',()=>{
    const run=compile(config());
    for(const [input,output] of [
        ['标记甲，后文。','后文。'],['前文，标记甲，后文。','前文，后文。'],
        ['前文，标记甲。','前文。'],['前文,标记甲?!','前文?!'],
        ['标记甲。后句。','后句。'],['标记甲',''],['前文，标记甲','前文'],
        ['前文，标记甲，标记甲。','前文。'],['标记甲，标记甲，后文。','后文。'],
        ['标记甲，标记甲。',''],['前文\n标记甲\n后文','前文\n\n后文'],
    ])assert.equal(run.run(input).text,output,input);
});
test('同句全部关键词不限顺序、不限间隔，不跨句号或换行',()=>{
    const run=compile(config(['声音','平'],'all'));
    for(const [input,output] of [
        ['前文，声音很平。','前文。'],['平静的声音。后句。','后句。'],
        ['前文，声音传来，中间分句，语调平静，后文。','前文，后文。'],
        ['前文，平静的描述，中间分句，声音传来。','前文。'],
        ['声音传来，语调平静。',''],['声音传来。平静的房间。','声音传来。平静的房间。'],
        ['声音传来\n平静的房间','声音传来\n平静的房间'],
        ['声音很大。','声音很大。'],['很平静。','很平静。'],
        ['声音'+ '远'.repeat(500)+'平。',''],
    ])assert.equal(run.run(input).text,output,input);
});
test('所有出现位置都参与覆盖，未命中的头尾分句保留',()=>{
    const run=compile(config(['声音','平'],'all'));
    assert.equal(run.run('开头，声音，平，中间，声音，结尾。').text,'开头，结尾。');
});
test('多个规则合并后再处理逗号，避免残留逗号句号或只剩标点',()=>{
    const s=config(['甲']);s.sentenceRules.push(templateRule(['乙']));const run=compile(s);
    assert.equal(run.run('保留，甲，乙。').text,'保留。');
    assert.equal(run.run('甲，乙。下一句。').text,'下一句。');
    assert.equal(run.run('甲，保留，乙。').text,'保留。');
});
test('删除句首或句尾分句后，引号和括号保持成对',()=>{
    const run=compile(config());
    for(const [input,output] of [
        ['她说：“保留，标记甲。”','她说：“保留。”'],
        ['她说：“标记甲，保留。”','“保留。”'],
        ['“标记甲。”后句。','后句。'],
        ['“前句。标记甲。”后句。','“前句。”后句。'],
        ['（标记甲，保留。）','（保留。）'],
        ['"保留，标记甲。"','"保留。"'],
    ])assert.equal(run.run(input).text,output,input);
});
test('完整句子范围删除整句；关键词按文字处理，不解析正则',()=>{
    assert.equal(compile(config(['标记甲'],'any','sentence')).run('前句。保留，标记甲，保留。后句。').text,'前句。后句。');
    const run=compile(config(['a+b']));assert.equal(run.run('axb。a+b，后文。').text,'axb。后文。');
});
test('硬规则可不遵守保护；默认模板仍遵守保护词和代码块',()=>{
    const s=config(['声音','平'],'all');s.exceptions=['保留'];
    assert.equal(compile(s).run('声音很平保留。').text,'声音很平保留。');
    assert.equal(compile(s).run('`声音很平`。').text,'`声音很平`。');
    s.sentenceRules[0].respectProtection=false;
    assert.equal(compile(s).run('声音很平保留。').text,'');assert.equal(compile(s).run('`声音很平`。').text,'');
});
test('分类空替换删分句，非空替换、其他分类和单字保持原有行为',()=>{
    const s=config();s.sentenceRules=[];
    s.groups=[{id:'g',name:'删除示例',enabled:true,deleteScope:'clause',rules:[{from:'标记甲',to:'',enabled:true},{from:'旧称',to:'新称',enabled:true}]},
        {id:'b',name:'其他',enabled:true,rules:[{from:'副词',to:'',enabled:true},{from:'甲',to:'乙',enabled:true}]}];
    const run=compile(s);
    assert.equal(run.run('前文，标记甲。副词旧称甲。').text,'前文。新称乙。');
    s.contextual=false;assert.equal(compile(s).run('前文，标记甲。').text,'前文。');
    s.groups[0].enabled=false;assert.equal(compile(s).run('前文，标记甲。').text,'前文，标记乙。');
});
test('同名词的后置分类覆盖删除范围，审计识别同为空值的不同范围',()=>{
    const s=config();s.sentenceRules=[];
    s.groups=[{id:'a',name:'分句',enabled:true,deleteScope:'clause',rules:[{from:'标记甲',to:'',enabled:true}]},{id:'b',name:'文字',enabled:true,rules:[{from:'标记甲',to:'',enabled:true}]}];
    assert.equal(compile(s).run('前文，标记甲。').text,'前文，。');assert.equal(inspectRules(s)[0].activeConflict,true);
    s.groups.reverse();assert.equal(compile(s).run('前文，标记甲。').text,'前文。');
});
test('v3 备份保留模板字段及分类范围，旧版配置兼容',()=>{
    const s=config(['声音','平'],'all');s.sentenceRules[0].respectProtection=false;
    s.groups=[{name:'删除示例',deleteScope:'clause',enabled:true,rules:[]}];
    const restored=validateSettings(JSON.parse(JSON.stringify(s)));
    assert.equal(restored.version,4);assert.equal(restored.groups.length,0);assert.deepEqual(restored.ruleGroups[0].rules[0].keywords,['声音','平']);
    assert.equal(restored.ruleGroups[0].rules[0].respectProtection,false);assert.equal(compile(restored).run('声音很平。').text,'');
    assert.equal(validateSettings({...s,version:2}).version,4);
    for(const rule of [templateRule([]),templateRule(['x'],'bad'),templateRule(['x'],'any','bad'),templateRule(['x\ny'])])assert.throws(()=>validateSettings({...s,sentenceRules:[rule]}));
});
test('模板开关、全局开关和特殊句式开关有效，预览范围保持原文位置',()=>{
    const s=config(['声音','平'],'all'),input='前文，声音很平。后句。';
    const result=compile(s).run(input);
    assert.equal(result.deletions.map(d=>input.slice(d.start,d.end)).join(''),'，声音很平');
    for(const change of [x=>x.enabled=false,x=>x.contextual=false,x=>x.sentenceRules[0].enabled=false]){const draft=structuredClone(s);change(draft);assert.equal(compile(draft).run(input).text,input);}
});
test('显示与模型输入副本使用模板，原文及 swipe 不变',()=>{
    const s=config(['声音','平'],'all'),runner=compile(s),source={mes:'前文，声音很平。',swipes:['前文，声音很平。'],is_user:false};
    const before=structuredClone(source);assert.equal(displayCopy(source,s,runner).mes,'前文。');
    const request=[source];transformPrompt(request,s,runner);assert.equal(request[0].mes,'前文。');assert.deepEqual(source,before);
});
