// Diagnostics keep their own provenance, including text produced by earlier rules.
// Positions always refer to the input supplied to run(), never to a later stage.
export class ExplanationTrace {
    constructor(source,limit=1000){
        this.origins=Array.from({length:source.length},(_,i)=>({start:i,end:i+1}));
        this.events=[];this.limit=limit;this.truncated=false;
    }
    ranges(start,end){
        const ranges=[];
        for(let i=Math.max(0,start);i<Math.min(end,this.origins.length);i++){
            const p=this.origins[i],last=ranges.at(-1);
            if(last&&p.start<=last.end)last.end=Math.max(last.end,p.end);else ranges.push({...p});
        }
        return ranges;
    }
    record(event){
        if(this.events.length>=this.limit){this.truncated=true;return;}
        const {start,end,...data}=event;
        this.events.push({...data,id:`event-${this.events.length}`,ranges:this.ranges(start,end)});
    }
    apply(edits){
        const chunks=[];let pos=0;
        for(const edit of edits){
            const ranges=this.ranges(edit.start,edit.end),origin={start:ranges[0]?.start??0,end:ranges.at(-1)?.end??0};
            chunks.push(this.origins.slice(pos,edit.start),Array.from({length:edit.text.length},()=>({...origin})));pos=edit.end;
        }
        chunks.push(this.origins.slice(pos));this.origins=chunks.flat();
    }

}

export const EVENT_LABELS={delete:'删除',replace:'替换',protect:'保护',skip:'条件未满足',overridden:'优先级覆盖'};
