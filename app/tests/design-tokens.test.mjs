import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const themes=JSON.parse(readFileSync(new URL('../src/ui/tokens/semantics.json',import.meta.url)));
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
for(const name of ['light','dark'])test(`${name} semantic text, control boundaries and focus have accessible contrast`,()=>{
 const t={...themes.light,...(name==='dark'?themes.dark:{})};
 for(const text of ['--ink','--muted','--accent','--danger-text','--success-text','--warning-text'])for(const surface of ['--page','--surface'])assert.ok(contrast(t[text],t[surface])>=4.5,`${name} ${text}/${surface}`);
 assert.ok(contrast(t['--action'],t['--on-action'])>=4.5);
 for(const control of ['--control-border','--focus'])for(const surface of ['--surface','--page'])assert.ok(contrast(t[control],t[surface])>=3,`${name} ${control}/${surface}`);
});
