// 用途：处理富文本中的可读文字。
// 旧版 ST 的保守兼容显示：只改可读正文的文本节点，保留所有标签、属性和 iframe。
const blocked=new Set(['IFRAME','OBJECT','EMBED','SCRIPT','STYLE','CUSTOM-STYLE','TEXTAREA','BUTTON','SVG','MATH']);
const blocks=new Set(['P','DIV','SECTION','ARTICLE','LI','UL','OL','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','DETAILS','SUMMARY','TR']);
export function patchDisplayText(root,settings,runner,records,{streamSource}={}){
    const entries=[];let input='',changed=0;
    const restore=el=>{
        if(el.nodeType===3){
            const old=records.get(el);
            if(old&&el.data===old.output&&el.data!==old.source){el.data=old.source;changed++;}
            records.delete(el);return;
        }
        for(const child of el.childNodes??[])restore(child);
    };
    const boundary=()=>{if(input&&!input.endsWith('\n'))input+='\n';};
    const visit=el=>{
        if(el.nodeType===3){
            const old=records.get(el);let source=old&&el.data===old.output?old.source:el.data;
            // Some stream renderers append to an existing, already-patched node.
            // Recover its raw prefix only when the message source confirms it.
            if(old&&typeof streamSource==='string'&&el.data!==old.output&&el.data.startsWith(old.output)){
                const appended=old.source+el.data.slice(old.output.length);
                if(streamSource.includes(appended))source=appended;
            }
            entries.push({node:el,source,start:input.length,end:input.length+source.length});input+=source;return;
        }
        if(el.nodeType===11){for(const child of el.childNodes)visit(child);return;}
        if(el.nodeType!==1)return;
        if(blocked.has(el.tagName)||el.hidden||el.getAttribute('aria-hidden')==='true'||el.getAttribute('contenteditable')==='true'||
            (settings.protectCode&&['PRE','CODE'].includes(el.tagName))){restore(el);boundary();return;}
        if(el.tagName==='BR'){boundary();return;}
        if(blocks.has(el.tagName))boundary();
        for(const child of el.childNodes)visit(child);
        if(blocks.has(el.tagName))boundary();
    };
    visit(root);
    const result=runner.run(input,{trace:true}),changes=new Map(entries.map(e=>[e,[]]));
    for(const edit of result.edits??[]){
        const touched=entries.filter(e=>e.end>edit.start&&e.start<edit.end);
        if(!touched.length&&edit.start===edit.end){
            const entry=entries.find(e=>e.start<=edit.start&&e.end>=edit.start);if(entry)touched.push(entry);
        }
        touched.forEach((entry,index)=>changes.get(entry).push({start:Math.max(0,edit.start-entry.start),end:Math.min(entry.source.length,edit.end-entry.start),text:index===0?edit.text:''}));
    }
    for(const entry of entries){
        let value=entry.source;
        for(const edit of changes.get(entry).reverse())value=value.slice(0,edit.start)+edit.text+value.slice(edit.end);
        if(entry.node.data!==value){entry.node.data=value;changed++;}
        records.set(entry.node,{source:entry.source,output:value});
    }
    return {changed,hits:result.hits};
}
