// Synthetic fixture specification for mechanics only, never a real-model benchmark.
export const BOARD = Object.freeze({
  width: 1200,
  height: 800,
  primary: { x: 60, y: 160, width: 380, height: 480 },
  auxiliary: { x: 840, y: 200, width: 260, height: 400 },
  textRegions: [
    { x: 40, y: 30, width: 1120, height: 90 },
    { x: 480, y: 160, width: 280, height: 480 },
  ],
  detailRoi: { x: 160, y: 340, width: 180, height: 180 },
  productColor: [185, 45, 35],
  externalLayoutColor: [224, 0, 224],
  alternateProductColor: [25, 75, 220],
});
export function boardScript({
  selector = 'input[aria-label="Upload product image"]',
  ambiguous = false,
  scale = 2,
  name = "private-annotated-reference-board.png",
} = {}) {
  return `(async()=>{let c=document.createElement('canvas');c.width=${1200 * scale};c.height=${800 * scale};let x=c.getContext('2d');x.scale(${scale},${scale});x.fillStyle='#fff';x.fillRect(0,0,1200,800);x.fillStyle='rgb(224,0,224)';x.fillRect(40,30,1120,90);x.fillRect(480,160,280,480);x.fillStyle='#111';x.font='bold 32px sans-serif';x.fillText('ANNOTATED REFERENCE BOARD',80,90);x.font='26px sans-serif';for(let[t,y]of [['SPECIFICATION',230],['LAYOUT TEXT',290],['EXCLUDE ME',350],['180 x 220',410],['NOT PRODUCT',470]])x.fillText(t,490,y);x.strokeStyle='#bbb';x.lineWidth=2;x.strokeRect(60,160,380,480);x.fillStyle='rgb(185,45,35)';x.fillRect(100,260,300,380);x.fillRect(150,200,200,70);x.fillStyle='#333';x.fillRect(150,160,200,50);x.fillStyle='#25bb55';x.fillRect(155,340,190,190);x.fillStyle='#fff';x.font='bold 32px sans-serif';x.fillText('QA-01',190,450);x.fillStyle=${JSON.stringify(ambiguous ? "rgb(25,75,220)" : "rgb(185,45,35)")};x.fillRect(860,280,220,320);x.fillRect(900,230,140,60);x.fillStyle='#333';x.fillRect(900,200,140,40);x.fillStyle='#fff';x.font='22px sans-serif';x.fillText(${JSON.stringify(ambiguous ? "QA-02" : "QA-01")},915,440);x.fillStyle='#333';x.font='20px sans-serif';x.fillText('Synthetic test data only; no real brand or model-accuracy claim.',60,740);let blob=await new Promise(r=>c.toBlob(r,'image/png'));window.__qaBoardOriginal=blob;window.__qaBoardSpec=${JSON.stringify(BOARD)};let d=new DataTransfer();d.items.add(new File([blob],${JSON.stringify(name)},{type:'image/png'}));let f=document.querySelector(${JSON.stringify(selector)});if(!f)throw Error('Missing fixture upload input');f.files=d.files;f.dispatchEvent(new Event('change',{bubbles:true}))})()`;
}
