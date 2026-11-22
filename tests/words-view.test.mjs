// 用途：规则与显示行为回归测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedWordRules,wordPageSize,wordRulePage} from '../words-view.js';
import {createBlankSettings,validateSettings,compile} from '../engine.js';

test('原词按拼音排列，默认顺序完整恢复，原始数组与同词优先级保持',()=>{
    const rules=['冬','春','白','阿','阿'].map((from,index)=>({id:index,from,to:String(index),enabled:true})),before=structuredClone(rules);
    assert.deepEqual(orderedWordRules(rules,'pinyin').map(r=>r.from),['阿','阿','白','春','冬']);
    assert.deepEqual(orderedWordRules(rules,'pinyin').slice(0,2).map(r=>r.id),[3,4]);
    assert.deepEqual(orderedWordRules(rules,'default'),before);assert.deepEqual(rules,before);
    const s={...createBlankSettings(),groups:[{id:'g',name:'日常',enabled:true,rules}]};const text=compile(s).run('阿白春冬').text;
    s.wordOrder='pinyin';orderedWordRules(rules,s.wordOrder);assert.equal(compile(s).run('阿白春冬').text,text);
});
test('每页10或15条可持久化，旧备份默认15条与原顺序，无效偏好回退',()=>{
    const old=createBlankSettings();delete old.wordPageSize;delete old.wordOrder;const migrated=validateSettings(old);
    assert.equal(migrated.wordPageSize,15);assert.equal(migrated.wordOrder,'default');
    for(const size of [10,15]){const s=validateSettings({...old,wordPageSize:size,wordOrder:'pinyin'});assert.equal(wordPageSize(s),size);assert.equal(s.wordOrder,'pinyin');}
    assert.equal(validateSettings({...old,wordPageSize:60,wordOrder:'random'}).wordPageSize,15);assert.equal(validateSettings({...old,wordPageSize:60,wordOrder:'random'}).wordOrder,'default');
});
test('定位和编辑按当前排序与每页数量计算页码，数值后缀自然排列',()=>{
    const group={rules:Array.from({length:32},(_,i)=>({from:`项目${31-i}`}))};
    const first=group.rules.at(-1),last=group.rules[0];
    assert.equal(wordRulePage(group,first,{wordPageSize:10,wordOrder:'default'}),3);
    assert.equal(wordRulePage(group,first,{wordPageSize:10,wordOrder:'pinyin'}),0);
    assert.equal(wordRulePage(group,last,{wordPageSize:15,wordOrder:'pinyin'}),2);
    assert.equal(orderedWordRules(group.rules,'pinyin')[2].from,'项目2');
});
