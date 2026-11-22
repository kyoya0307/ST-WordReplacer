// 用途：规则与显示行为回归测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankSettings,compile,validateSettings} from '../engine.js';
import {syncGroups,setGroupEnabled} from '../model.js';
import {displayCopy,transformPrompt} from '../runtime.js';

const variants=[
    ['普通替换','groups',{from:'单车',to:'自行车'},'单车单车','自行车自行车'],
    ['空值删除','groups',{from:'【待删】',to:''},'甲【待删】乙【待删】','甲乙'],
    ['关键词','ruleGroups',{kind:'keywords',keywords:['【待删】'],matchMode:'any',action:'word'},'甲【待删】乙【待删】','甲乙'],
    ['共同触发','ruleGroups',{kind:'keywords',keywords:['声音','平'],matchMode:'all',action:'clause'},'她点头，声音很平。她坐下。','她点头。她坐下。'],
    ['固定结构','ruleGroups',{kind:'pattern',prefix:'极',suffix:'的',min:1,max:1,action:'word'},'极轻的脚步，极重的门。','脚步，门。'],
    ['标记','ruleGroups',{kind:'markers',start:'[示例]',end:'[/示例]',action:'word'},'甲[示例]内容[/示例]乙','甲乙'],
    ['自定边界','ruleGroups',{kind:'boundary',keyword:'【待删】',startChars:'，',endChars:'。',action:'clause'},'正文，【待删】草稿。','正文，'],
    ['语境','ruleGroups',{kind:'context',template:'number',action:'replace',to:'替换结果',safeContext:true},'三八！','替换结果！'],
];
function config(key,rule){const s=createBlankSettings();s.groups=[];s[key]=[{id:'g',name:'验证分类',enabled:true,defaultAction:'word',rules:[{id:'r',enabled:true,respectProtection:true,...rule}]}];return s;}
for(const [name,key,rule,input,output]of variants)test(`${name}：单条、分类、总开关关闭后预览、显示和请求均停止，导入保留停用`,()=>{
    const s=config(key,rule),message={mes:input,is_user:false,extra:{reasoning:'推理原文'},swipes:[input]};
    const verify=(settings,expected)=>{
        const before=structuredClone(message),runner=compile(settings);
        assert.equal(runner.run(input).text,expected);
        assert.equal(displayCopy(message,settings,runner).mes,expected);
        const messages=[message];transformPrompt(messages,settings,runner);assert.equal(messages[0].mes,expected);
        assert.deepEqual(message,before);
    };
    verify(s,output);
    s[key][0].rules[0].enabled=false;syncGroups(s);verify(s,input);verify(validateSettings(s),input);
    s[key][0].rules[0].enabled=true;syncGroups(s);verify(s,output);
    setGroupEnabled(s[key][0],false);syncGroups(s);verify(s,input);verify(validateSettings(s),input);
    setGroupEnabled(s[key][0],true);syncGroups(s);verify(s,output);
    s.enabled=false;verify(s,input);verify(validateSettings(s),input);assert.equal(s[key][0].rules[0].enabled,true);
});
test('显示、模型输入与用户/AI 作用范围相互独立',()=>{
    const s=config('groups',{from:'单车',to:'自行车'}),runner=compile(s),ai={mes:'单车',is_user:false},user={mes:'单车',is_user:true};
    s.display=false;assert.equal(displayCopy(ai,s,runner),ai);
    let request=[ai,user];transformPrompt(request,s,runner);assert.deepEqual(request.map(m=>m.mes),['自行车','单车']);
    s.display=true;s.prompt=false;assert.equal(displayCopy(ai,s,runner).mes,'自行车');request=[ai];transformPrompt(request,s,runner);assert.equal(request[0],ai);
    s.assistant=false;s.user=true;s.prompt=true;assert.equal(displayCopy(ai,s,runner),ai);assert.equal(displayCopy(user,s,runner).mes,'自行车');request=[ai,user];transformPrompt(request,s,runner);assert.deepEqual(request.map(m=>m.mes),['单车','自行车']);
});
test('保护词的单条和分类开关真实控制保护，停用后不被旧 exceptions 激活',()=>{
    const s=config('groups',{from:'晨光',to:'曙光'});
    s.protectionGroups=[{id:'keep',name:'名称保护',enabled:true,targets:['all'],terms:[{id:'t',text:'晨光计划',enabled:true}]}];syncGroups(s);
    const input='晨光计划与晨光',run=()=>compile(s).run(input).text;
    assert.equal(run(),'晨光计划与曙光');s.protectionGroups[0].terms[0].enabled=false;syncGroups(s);assert.equal(run(),'曙光计划与曙光');
    setGroupEnabled(s.protectionGroups[0],true,'terms');syncGroups(s);assert.equal(run(),'晨光计划与曙光');
    setGroupEnabled(s.protectionGroups[0],false,'terms');syncGroups(s);assert.equal(run(),'曙光计划与曙光');assert.equal(compile(validateSettings(s)).run(input).text,'曙光计划与曙光');
});
