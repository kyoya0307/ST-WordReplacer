import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,createSettings} from '../engine.js';
import {templateRule} from '../templates.js';

const apply=(input,edits)=>edits.reduceRight((text,e)=>text.slice(0,e.start)+e.text+text.slice(e.end),input);
const verify=(settings,input)=>{
    const runner=compile(settings),out=runner.run(input,{trace:true});
    assert.equal(apply(input,out.edits??[]),out.text);
    assert.equal(out.text,runner.run(input).text);
    return out;
};
const config=()=>({...createSettings(),contextual:false,groups:[{id:'g',name:'示例',enabled:true,rules:[
    {from:'草稿',to:'',enabled:true},{from:'旧称',to:'新称呼',enabled:true},{from:'新称呼',to:'另一称呼',enabled:true},
]}]});

test('文字编辑位置可重放，删除、增字、重复、长词和 Unicode 保持一次替换结果',()=>{
    const s=config();
    const out=verify(s,'🧊草稿旧称，草稿旧称！');assert.equal(out.text,'🧊新称呼，新称呼！');
    verify(s,'没有命中');verify(s,'草稿');verify(s,'旧称'.repeat(100));
    for(let i=0;i<20;i++)verify(s,('草稿旧称甲。'.repeat(i)+'🧊旧称草稿').repeat(2));
});

test('保护词和代码段不产生编辑，句段删除与普通替换的原始位置正确',()=>{
    const s=config();s.contextual=true;s.sentenceRules=[templateRule(['标记'])];s.exceptions=['保留草稿'];
    verify(s,'保留草稿，旧称，标记。\n```js\n旧称草稿\n```\n旧称，标记，旧称。');
    assert.equal(verify(s,'旧称，标记。').text,'新称呼。');
    s.groups[0].deleteScope='clause';verify(s,'前文，草稿，旧称。后文，草稿。');
});

test('内置上下文规则和其后的词库处理可追踪，不丢失捕获组替换',()=>{
    const s=createSettings();
    for(const input of ['去他妈的，操作说明。','他妈的！操你妈！','臭娘们，后文。','三八妇女节，三八！'])verify(s,input);
    s.contextOptions.rules.kinship.replacement='自定义文字';verify(s,'他妈的！他妈的！');
    s.enabled=false;assert.equal(verify(s,'去他妈的').text,'去他妈的');
});
