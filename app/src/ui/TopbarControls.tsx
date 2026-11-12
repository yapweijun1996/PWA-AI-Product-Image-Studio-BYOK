import {Icon} from './Icon';
import {useEffect,useRef,useState} from 'react';
import {Button} from './components';
import {languages,setLanguage,t,useLanguage} from './i18n';
export function TopbarControls({dark,toggleTheme}:{dark:boolean;toggleTheme:()=>void}){
 const language=useLanguage(),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[open]);
 return <div className="topbar-controls"><div className="language-control" ref={root} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}}}>
 <Button ref={trigger} className="icon-button" type="button" title={t('Language')} aria-label={t('Language')} aria-expanded={open} aria-controls="language-options" onClick={()=>setOpen(!open)}><Icon name="language"/></Button>
 {open&&<div id="language-options" className="language-options" role="group" aria-label={t('Language')}>{languages.map(item=><Button type="button" className="language-option" key={item.id} lang={item.id} aria-pressed={language===item.id} onClick={()=>{setLanguage(item.id);setOpen(false);trigger.current?.focus()}}>{item.name}</Button>)}</div>}</div>
 <Button type="button" className="icon-button" title={t(dark?'Switch to light mode':'Switch to dark mode')} aria-label={t(dark?'Switch to light mode':'Switch to dark mode')} onClick={toggleTheme}><Icon name={dark?'sun':'moon'}/ ></Button>
 </div>
}
