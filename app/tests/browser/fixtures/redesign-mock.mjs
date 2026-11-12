import { BOARD } from "./redesign-fixture.mjs";
const norm = (b) => ({
  x: b.x / BOARD.width,
  y: b.y / BOARD.height,
  width: b.width / BOARD.width,
  height: b.height / BOARD.height,
});
export const normalAnalysis = {
  classification: "reference-board",
  confidence: 0.98,
  primaryId: "s1",
  subjects: [
    {
      id: "s1",
      group: "g1",
      imageIndex: 0,
      box: norm(BOARD.primary),
      confidence: 0.98,
      category: "cosmetic",
      camera: "front",
      detailBox: norm(BOARD.detailRoi),
      views: [
        {
          imageIndex: 0,
          box: norm(BOARD.auxiliary),
          camera: "side",
          confidence: 0.97,
        },
      ],
    },
  ],
  textRegions: BOARD.textRegions.map((box) => ({
    imageIndex: 0,
    box: norm(box),
  })),
};
export const ambiguousAnalysis = {
  ...normalAnalysis,
  classification: "multiple-products",
  primaryId: null,
  subjects: [
    { ...normalAnalysis.subjects[0], views: [] },
    {
      id: "s2",
      group: "g2",
      imageIndex: 0,
      box: norm(BOARD.auxiliary),
      confidence: 0.97,
      category: "cosmetic",
      camera: "front",
      detailBox: {
        x: 900 / 1200,
        y: 350 / 800,
        width: 120 / 1200,
        height: 120 / 800,
      },
      views: [],
    },
  ],
};
export function makeRedesignMock() {
  return `(()=>{
window.__qaScenario='board';window.__qaRequests=[];window.__qaCapturedImages=[];window.__qaExternal=[];window.__qaOriginalFetch=window.fetch;
const normal=${JSON.stringify(normalAnalysis)},ambiguous=${JSON.stringify(ambiguousAnalysis)};
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const imageInfo=async(blob,label)=>{let bytes=new Uint8Array(await blob.arrayBuffer()),bmp=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;let x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bmp,0,0);bmp.close();let d=x.getImageData(0,0,c.width,c.height).data,magenta=0,red=0,blue=0;for(let i=0;i<d.length;i+=4){if(d[i]>180&&d[i+1]<30&&d[i+2]>180)magenta++;if(Math.abs(d[i]-185)<10&&Math.abs(d[i+1]-45)<10&&Math.abs(d[i+2]-35)<10)red++;if(Math.abs(d[i]-25)<10&&Math.abs(d[i+1]-75)<10&&Math.abs(d[i+2]-220)<10)blue++}let chunks=[];for(let at=8;at+12<=bytes.length;){let len=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at),name=String.fromCharCode(...bytes.slice(at+4,at+8));chunks.push(name);at+=len+12;if(name==='IEND')break}let result={label,width:c.width,height:c.height,bytes:bytes.length,sha256:await hash(bytes),magenta,red,blue,chunks};window.__qaCapturedImages.push({blob,...result});return result};
const fromData=async(url,label)=>{let raw=atob(url.split(',')[1]),b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return imageInfo(new Blob([b],{type:'image/png'}),label)};
window.fetch=async(url,options={})=>{let endpoint=String(url);if(endpoint.startsWith('https://api.openai.com/')){
 if(!['https://api.openai.com/v1/responses','https://api.openai.com/v1/images/edits','https://api.openai.com/v1/images/generations'].includes(endpoint))throw Error('Unexpected external endpoint');
 let record={endpoint,scenario:window.__qaScenario,images:[]},prompt='';
 if(endpoint.endsWith('/responses')){let body=JSON.parse(options.body),texts=[];for(let input of body.input??[])for(let part of input.content??[]){if(part.type==='input_text')texts.push(part.text);if(part.type==='input_image')record.images.push(await fromData(part.image_url,'responses-input'))}prompt=texts.join('\\n');record.purpose=prompt.includes('exact style order')?'output-review':'source-analysis';record.model=body.model;record.store=body.store;record.maxOutputTokens=body.max_output_tokens;record.tools=body.tools;record.format=body.text?.format?.type;record.prompt=prompt;window.__qaRequests.push(record);
 if(window.__qaFailPurpose===record.purpose){window.__qaFailPurpose=null;throw Error('Synthetic unreadable auxiliary request')}
 if(window.__qaRejectReview&&record.purpose==='output-review')return Response.json({error:{message:'Synthetic review unavailable'}},{status:400});
 let payload;if(record.purpose==='source-analysis'){payload=structuredClone(window.__qaScenario==='ambiguous'?ambiguous:normal);if(window.__qaScenario==='no-detail')payload.subjects[0].detailBox=null;if(window.__qaScenario==='low-resolution')payload.subjects[0].detailBox={x:.15,y:.4,width:.02,height:.03};if(window.__qaScenario==='sliver')payload.textRegions.push({imageIndex:0,box:{x:normal.subjects[0].box.x+normal.subjects[0].box.width-.001,y:normal.subjects[0].box.y,width:.01,height:normal.subjects[0].box.height}});if(window.__qaScenario==='unusable')payload={classification:'unusable',confidence:.99,primaryId:null,subjects:[],textRegions:normal.textRegions};if(window.__qaAnalysisOverride)payload=window.__qaAnalysisOverride}
 else{let match=prompt.match(/exact style order:\\s*(\\[[^\\]]+\\])/),styles=match?JSON.parse(match[1]):['studio','hero','lifestyle','flat_lay','ugc','billboard'];payload={findings:styles.map(styleId=>({styleId,identity:styleId==='hero'?'conflict':'consistent',composition:'usable',confidence:.99,reasons:styleId==='hero'?['identity_conflict']:[]}))};if(window.__qaReviewOverride)payload=window.__qaReviewOverride}
 return Response.json({id:'resp_synthetic_'+window.__qaRequests.length,object:'response',created_at:1,status:'completed',model:body.model,output:[{id:'msg_synthetic',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(payload),annotations:[]}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
 }
 if(options.body instanceof FormData){record.fields=[];for(let[k,v]of options.body){if(v instanceof Blob)record.images.push(await imageInfo(v,'edits-'+k));else{record.fields.push({key:k,value:v});if(k==='prompt')prompt=v}}}else{let body=JSON.parse(options.body);prompt=body.prompt;record.fields=Object.keys(body);record.model=body.model}
 record.style=prompt.includes('source-angle tabletop')?'flat_lay':prompt.match(/Style: ([a-z_]+)/)?.[1]??'unknown';record.prompt=prompt;window.__qaRequests.push(record);if(window.__qaFailPurpose==='image'){window.__qaFailPurpose=null;throw Error('Synthetic unreadable image request')}
 if(window.__qaPauseImage){window.__qaPauseImage=false;await new Promise(r=>window.__qaReleaseImage=r)}
 let style=record.style,ids=['studio','hero','lifestyle','flat_lay','ugc','billboard'],idx=ids.indexOf(style),c=document.createElement('canvas');c.width=c.height=1024;let x=c.getContext('2d');let colors=['#e4eeea','#c8d3ce','#d5dfca','#d9d2c2','#d4dfeb','#bad2c8'];x.fillStyle=colors[Math.max(0,idx)];x.fillRect(0,0,1024,1024);x.fillStyle=['#c9d9d1','#7d8d86','#a8b694','#b2a994','#9aacbf','#84b39c'][Math.max(0,idx)];x.fillRect(0,780,1024,244);if(idx>1){x.fillStyle='rgba(255,255,255,.30)';x.fillRect(40+idx*40,80,100+idx*20,350)}
 if(endpoint.endsWith('/edits')){let scale=[.8,1.0,.55,.7,.5,.75][Math.max(0,idx)],cx=[512,610,300,420,740,650][Math.max(0,idx)],bottom=860,w=320*scale,h=500*scale;x.fillStyle='rgba(0,0,0,.15)';x.beginPath();x.ellipse(cx,bottom+5,w*.65,15,0,0,Math.PI*2);x.fill();x.fillStyle='#b92d23';x.fillRect(cx-w/2,bottom-h,w,h);x.fillRect(cx-w*.32,bottom-h-80*scale,w*.64,90*scale);x.fillStyle='#333';x.fillRect(cx-w*.32,bottom-h-130*scale,w*.64,55*scale);x.fillStyle='#25bb55';x.fillRect(cx-w*.36,bottom-h*.75,w*.72,h*.40);x.fillStyle='#fff';x.font='bold '+Math.round(28*scale)+'px sans-serif';x.fillText('QA-01',cx-w*.27,bottom-h*.5)}
 // Regenerated bytes get a small deterministic geometric signature, never text.
 let sequence=window.__qaRequests.filter(r=>r.endpoint.includes('/images/')).length;if(sequence>6){x.fillStyle='#637d72';x.fillRect(25,25,sequence,sequence)}
 let b64=c.toDataURL('image/png').split(',')[1];record.outputSha256=await hash(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)));return Response.json({data:[{b64_json:b64}]});
 }
 if(/^https?:/.test(endpoint)&&!endpoint.startsWith(location.origin)){window.__qaExternal.push(endpoint);throw Error('QA blocks all unmocked external network')}return window.__qaOriginalFetch(url,options)
};
})()`;
}
