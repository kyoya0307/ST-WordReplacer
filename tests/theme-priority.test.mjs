import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings,validateSettings,THEMES,compile} from '../engine.js';
test('六种配色可保存；旧备份或未知配色回退跟随 ST，不丢弃词库',()=>{
    assert.equal(createSettings().theme,'st');assert.equal(Object.keys(THEMES).length,6);
    for(const theme of Object.keys(THEMES))assert.equal(validateSettings({...createSettings(),theme}).theme,theme);
    const s=createSettings();delete s.theme;assert.equal(validateSettings(s).theme,'st');
    s.theme='unknown';assert.equal(validateSettings(s).theme,'st');assert.equal(validateSettings(s).groups.flatMap(g=>g.rules).length,7);
});
test('单字与短句同时存在时长词优先，独立单字仍生效，不受分类顺序影响',()=>{
    const s={...createSettings(),contextual:false,groups:[
        {id:'phrase',name:'短句',enabled:true,rules:[{id:'p',from:'嫁给我',to:'和我结婚',enabled:true}]},
        {id:'character',name:'单字',enabled:true,rules:[{id:'c',from:'嫁',to:'娶',enabled:true}]},
    ]};
    assert.equal(compile(s).run('嫁给我；嫁').text,'和我结婚；娶');
    s.groups.reverse();assert.equal(compile(s).run('嫁给我；嫁').text,'和我结婚；娶');
});
