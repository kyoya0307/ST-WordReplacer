import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,compile,validateSettings} from '../engine.js';
import {TRIGGER_PRESETS,triggerPreset,triggerTitle,presetEntries,presetDraft} from '../presets.js';

test('每个标准模板固定匹配类型与处理方式，旧特殊处理进入兼容区域',()=>{
    for(const [id,p]of Object.entries(TRIGGER_PRESETS).filter(([,p])=>p.kind)){
        const rule=presetDraft(id);assert.equal(triggerPreset(rule,{defaultAction:'sentence'}),id);assert.equal(rule.inheritAction,false);assert.equal(rule.name,'');
        assert.equal(rule.action,p.action);assert.equal(rule.kind,p.kind);
    }
    assert.equal(triggerPreset({kind:'keywords',keywords:['甲'],matchMode:'any',action:'replace',to:'乙'},{defaultAction:'clause'}),'custom');
    assert.equal(triggerPreset({kind:'boundary',keyword:'甲',action:'clause'},{defaultAction:'clause'}),'custom');
});
test('按实际生效范围识别旧规则，查看模板保持所有原数据、顺序与开关',()=>{
    const s=createBlankSettings();s.ruleGroups=[{id:'mixed',name:'旧分类',enabled:true,defaultAction:'clause',rules:[
        {id:'a',...presetDraft('keywords'),action:'word',inheritAction:true},
        {id:'b',...presetDraft('pattern'),enabled:false},
        {id:'c',...presetDraft('together')},
    ]}];const before=structuredClone(s);
    assert.equal(presetEntries(s,'keywords')[0].rule.id,'a');assert.equal(presetEntries(s,'pattern')[0].rule.enabled,false);
    for(const id of Object.keys(TRIGGER_PRESETS))presetEntries(s,id);
    assert.deepEqual(s,before);assert.equal(presetEntries(s,'keywords')[0].group,s.ruleGroups[0]);
});
test('内容自动作为标题，旧编号标题改用触发词，保留已有自定义备注',()=>{
    assert.equal(triggerTitle({...presetDraft('keywords'),keywords:['【甲】','【乙】'],name:'触发规则 2'}),'【甲】 / 【乙】');
    assert.equal(triggerTitle(presetDraft('together')),'声音 ＋ 平');
    assert.equal(triggerTitle(presetDraft('pattern')),'极 ＋ 1 个汉字 ＋ 的');
    assert.equal(triggerTitle({...presetDraft('keywords'),name:'节选清理'}),'节选清理');
    assert.equal(triggerTitle({...presetDraft('keywords'),name:'清理规则 20'}),'【待删】');
});
test('分句删除、共同出现、固定结构和完整句子模板执行固定效果，往返保持',()=>{
    const cases=[['keywords','她点头，【待删】这句是示例。她坐下。','她点头。她坐下。'],
        ['together','她点头，声音传来，语调平静。她坐下。','她点头。她坐下。'],
        ['pattern','极轻的脚步，极重的门。','脚步，门。'],
        ['sentence','她点头，【待删】这句是示例。她坐下。','她坐下。'],
        ['text','甲【待删】乙','甲乙'],['markers','甲[示例开始]内容[示例结束]乙','甲乙']];
    for(const [id,input,expected]of cases){
        const s={...createBlankSettings(),groups:[],ruleGroups:[{id:'g',name:TRIGGER_PRESETS[id].title,enabled:true,defaultAction:'word',rules:[presetDraft(id)]}]};
        assert.equal(compile(s).run(input).text,expected,id);assert.equal(compile(validateSettings(s)).run(input).text,expected,id);
    }
});
test('添加草稿相互独立，保存后的标准触发不随来源分类默认动作漂移',()=>{
    const a=presetDraft('keywords'),b=presetDraft('keywords');a.keywords.push('额外');assert.deepEqual(b.keywords,['【待删】']);
    const g={id:'g',name:'来源',enabled:true,defaultAction:'sentence',rules:[b]},s={...createBlankSettings(),groups:[],ruleGroups:[g]};
    assert.equal(compile(s).run('正文，【待删】示例。').text,'正文。');
    g.defaultAction='word';assert.equal(compile(s).run('正文，【待删】示例。').text,'正文。');
});
