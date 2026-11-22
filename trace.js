// 用途：追踪改字前后的文字位置。
// 跟踪保留字符的原始位置，用于只修改 DOM 文本，不重建 HTML / iframe。
export class TextTrace {
    constructor(source,origins=Array.from({length:source.length},(_,i)=>i)) {
        this.source=source;this.origins=origins;
    }
    slice(start,end){return new TextTrace(this.source,this.origins.slice(start,end));}
    apply(edits){
        const chunks=[];let pos=0;
        for(const edit of edits){
            chunks.push(this.origins.slice(pos,edit.start),Array(edit.text.length).fill(-1));pos=edit.end;
        }
        chunks.push(this.origins.slice(pos));this.origins=chunks.flat();
    }
    replace(text,pattern,replacer){
        const edits=[];
        const output=text.replace(pattern,(...args)=>{
            const value=replacer(...args),from=args[0];
            if(value!==from){
                const offset=args[typeof args.at(-1)==='object'?args.length-3:args.length-2];
                edits.push({start:offset,end:offset+from.length,text:value});
            }
            return value;
        });
        this.apply(edits);return output;
    }
    edits(output,origins=this.origins){
        const edits=[];let pos=0,pending='';
        for(let i=0;i<output.length;i++){
            const at=origins[i];
            if(at<0){pending+=output[i];continue;}
            if(at>pos||pending)edits.push({start:pos,end:at,text:pending});
            pos=at+1;pending='';
        }
        if(pos<this.source.length||pending)edits.push({start:pos,end:this.source.length,text:pending});
        return edits;
    }
}
