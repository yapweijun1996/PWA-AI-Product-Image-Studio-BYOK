import {readFileSync} from 'node:fs';
const css=['components.css','layout.css'].map(file=>readFileSync(new URL('../src/ui/'+file,import.meta.url),'utf8')).join('\n').replace(/@media\s*\([^{}]+\)/g,'');
if(/#[0-9a-fA-F]{3,8}\b|(?<![\w.-])(?:\d*\.)?\d+(?:px|rem)\b/.test(css))throw Error('Visual values belong in ui/tokens.css. Media breakpoints are the documented exception.');
console.log('UI token boundary passed.');
const {readdirSync}=await import('node:fs');
for(const file of readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.tsx'))){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 if(/<(button|input|select|textarea|details|summary|svg)(?:\s|>)/.test(source))throw Error(`${file}: use shared UI controls.`);
}
console.log('Shared control boundary passed.');
// Pages must import icons through the one allowlisted owner.
for(const file of readdirSync(new URL('../src/',import.meta.url)).filter(f=>f.endsWith('.tsx'))){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 if(source.includes('lucide-react'))throw Error(`${file}: import the shared Icon owner.`);
}
console.log('Disclosure and icon ownership passed.');
