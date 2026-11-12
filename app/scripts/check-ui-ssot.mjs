import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8').replace(/@media\s*\([^{}]+\)/g,'');
if(/#[0-9a-fA-F]{3,8}\b|(?<![\w.-])(?:\d*\.)?\d+(?:px|rem)\b/.test(css))throw Error('Visual values belong in ui/tokens.css. Media breakpoints are the documented exception.');
console.log('UI token boundary passed.');
const {readdirSync}=await import('node:fs');
for(const file of readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.tsx'))){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 if(/<(button|input|select|textarea)(?:\s|>)/.test(source))throw Error(`${file}: use shared UI controls.`);
}
console.log('Shared control boundary passed.');
