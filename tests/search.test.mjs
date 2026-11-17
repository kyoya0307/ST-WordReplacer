import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings} from '../engine.js';
import {searchEntries} from '../search.js';

const fixture=()=>({...createBlankSettings(),groups:[
    {id:'a',name:'通用',enabled:true,rules:[{id:'a1',from:'Sunrise',to:'晨光',enabled:true}]},
    {id:'b',name:'备用',enabled:false,rules:[{id:'b1',from:'晚霞',to:'晨光',enabled:false}]},
],ruleGroups:[{id:'c',name:'清理',enabled:true,defaultAction:'word',rules:[
    {id:'c1',name:'标记清理',kind:'keywords',keywords:['【晨光】'],matchMode:'any',action:'word',enabled:true},
    {id:'c2',name:'结构',kind:'pattern',prefix:'极',suffix:'的',min:1,max:1,action:'word',enabled:false,filters:{excludes:['晨光计划'],exceptBefore:['清晨']}},
    {id:'c3',name:'边界',kind:'boundary',keyword:'记录',startChars:'【',endChars:'】',action:'clause',enabled:true},
]}],protectionGroups:[{id:'d',name:'名称',enabled:true,targets:['all'],terms:[{id:'d1',text:'晨光计划',enabled:true}]}]});

test('全局搜索跨全部分类与三种内容，包含停用项并返回准确来源',()=>{
    const s=fixture(),rows=searchEntries(s,'晨光');
    assert.deepEqual(rows.map(x=>x.item.id),['a1','b1','c1','c2','d1']);
    assert.deepEqual(rows.map(x=>x.enabled),[true,false,true,false,true]);
    assert.equal(rows[1].group.name,'备用');assert.equal(rows.at(-1).type,'保护词');
    assert.equal(searchEntries(s,' 通用 ')[0].item,s.groups[0].rules[0]);
});
test('原词和替换词不区分英文大小写，模板前后文、保留条件与边界均可检索',()=>{
    const s=fixture();
    assert.equal(searchEntries(s,'SUNRISE')[0].item.id,'a1');
    assert.equal(searchEntries(s,'极')[0].item.id,'c2');
    assert.equal(searchEntries(s,'清晨')[0].item.id,'c2');
    assert(searchEntries(s,'】').some(row=>row.item.id==='c3'));
    assert.deepEqual(searchEntries(s,'   '),[]);assert.deepEqual(searchEntries(s,'缺失内容'),[]);
});
test('搜索即时反映修改和启停，不改变规则、分类顺序或总开关',()=>{
    const s=fixture(),before=structuredClone(s);searchEntries(s,'晨光');assert.deepEqual(s,before);
    s.groups[0].rules[0].enabled=false;assert.equal(searchEntries(s,'SUNRISE')[0].enabled,false);
    s.groups[0].rules[0].to='曙光';assert.equal(searchEntries(s,'曙光').length,1);
    s.enabled=false;assert.equal(searchEntries(s,'晨光').length,4);
});
