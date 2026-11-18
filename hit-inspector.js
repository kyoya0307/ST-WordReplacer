import {EVENT_LABELS} from './explanation.js';
const node=(tag,attrs={},...children)=>{
    const e=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){
        if(key.startsWith('on'))e.addEventListener(key.slice(2),value);else if(key in e)e[key]=value;else e.setAttribute(key,value);
    }e.append(...children.filter(x=>x!==null&&x!==undefined));return e;
};
const sourceName={manual:'手动保护词',builtin:'内置保护',condition:'条件规则',dictionary:'词库'};
const compact=text=>text.length>90?`${text.slice(0,90)}…`:text;
const key=e=>JSON.stringify([e.groupId,e.ruleId,e.rule]);
function paint(element,input,ranges=[],kind='all'){
    element.replaceChildren();let pos=0;
    const merged=[];
    for(const r of [...ranges].sort((a,b)=>a.start-b.start||a.end-b.end)){
        const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});
    }
    for(const r of merged){element.append(document.createTextNode(input.slice(pos,r.start)),node('mark',{'data-hit-kind':kind},input.slice(r.start,r.end)));pos=r.end;}
    element.append(document.createTextNode(input.slice(pos)));
}
export function createHitInspector(marked,onNavigate){
    let source='',result={},events=[],selected=null,page=0;
    const button=(text,fn,attrs={})=>node('button',{type:'button',className:'wr-button menu_button',onclick:fn,...attrs},text);
    const kinds=node('select',{className:'text_pole','aria-label':'查看哪类命中',onchange:()=>{selected=null;page=0;draw();}},...Object.entries({all:'全部记录',...EVENT_LABELS}).map(([value,text])=>node('option',{value},text)));
    const rules=node('select',{className:'text_pole','aria-label':'查看哪条规则',onchange:()=>{selected=null;page=0;draw();}});
    const list=node('div',{className:'wr-inspector-list','aria-label':'可点选的命中记录'}),detail=node('section',{className:'wr-inspector-detail','aria-label':'所选命中解释','aria-live':'polite'}),count=node('small',{}),pages=node('div',{className:'wr-row'});
    const panel=node('section',{className:'wr-hit-inspector','aria-label':'命中检查'},node('div',{className:'wr-row'},node('h4',{},'命中检查'),button('显示全部位置',()=>{selected=null;draw();})),node('div',{className:'wr-inspector-filters'},kinds,rules),count,list,pages,detail);
    function showDetail(event){
        detail.replaceChildren();
        if(!event){detail.append(node('small',{},'点选记录，在上方原文中查看对应位置。'));return;}
        detail.append(node('b',{},`${EVENT_LABELS[event.kind]} · ${event.rule??'规则'}`),node('small',{},`${sourceName[event.sourceType]??'规则'} / ${event.group??''}`),node('p',{},event.reason??''));
        if(event.passive)detail.append(node('small',{},'此处匹配了保护内容；是否拦截某次清理，请查看对应的处理记录。'));
        detail.append(node('div',{className:'wr-inspector-fragment'},event.text??''));
        if(event.to!==undefined)detail.append(node('small',{},`本次处理结果：${event.to||'〔删除〕'}`));
        for(const range of event.ranges??[]){const prefix=source.slice(0,range.start),line=prefix.split('\n').length,column=Array.from(prefix.slice(prefix.lastIndexOf('\n')+1)).length+1;detail.append(node('small',{},`原文第 ${line} 行，第 ${column} 字起：${compact(source.slice(range.start,range.end))}`));}
        if(event.ruleId)detail.append(button('定位这条规则',()=>onNavigate?.(event)));
        for(const p of event.protectors??[])detail.append(node('div',{className:'wr-inspector-blocker'},node('small',{},`保留依据：${sourceName[p.sourceType]??'保护'} / ${p.group??''} / ${p.rule??p.text??''}`),node('span',{},p.text??''),p.ruleId?button(p.sourceType==='manual'?'查看此保护词':'查看保留规则',()=>onNavigate?.(p)):null));
        if(event.winner?.rule)detail.append(node('small',{},`重叠规则：${event.winner.group??''} / ${event.winner.rule}`));
    }
    function draw(){
        const filtered=events.filter(e=>(kinds.value==='all'||e.kind===kinds.value)&&(rules.value==='all'||key(e)===rules.value));
        const active=filtered.find(e=>e.id===selected),last=Math.max(0,Math.ceil(filtered.length/15)-1);page=Math.min(page,last);
        paint(marked,source,active?active.ranges:selected?[]:filtered.flatMap(e=>e.ranges??[]),active?.kind??'all');
        count.textContent=`${filtered.length} 条记录${result.eventsTruncated?' · 已达显示上限，可缩短原文检查':''}`;
        list.replaceChildren(...filtered.slice(page*15,page*15+15).map(e=>{
            const b=button('',()=>{selected=e.id;draw();marked.scrollIntoView?.({block:'nearest'});},{className:'wr-button wr-inspector-event','aria-pressed':String(selected===e.id),'data-event-kind':e.kind});
            b.append(node('span',{className:'wr-badge'},EVENT_LABELS[e.kind]),node('span',{},e.rule??e.group??'规则'),node('small',{},compact(e.text??'')));return b;
        }));
        if(!filtered.length)list.append(node('small',{},events.length?'当前筛选下没有记录。':'当前输入没有命中已启用内容。'));
        pages.replaceChildren();if(last)pages.append(button('上一组',()=>{page--;draw();},{disabled:page===0}),node('small',{},`${page+1}/${last+1}`),button('下一组',()=>{page++;draw();},{disabled:page===last}));
        showDetail(active);
    }
    return {element:panel,update(input,next){
        source=input;result=next;events=next.events??[];selected=null;page=0;
        const prior=rules.value,entries=new Map(events.map(e=>[key(e),e]));
        rules.replaceChildren(node('option',{value:'all'},'全部规则'),...[...entries].map(([value,e])=>node('option',{value},`${sourceName[e.sourceType]??''} / ${e.group??''} / ${e.rule??''}`)));
        rules.value=entries.has(prior)?prior:'all';draw();
    }};
}
