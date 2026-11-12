import {useEffect,useRef,useState} from 'react';
import {Button} from './components';
import {languages,setLanguage,t,useLanguage} from './i18n';
export function TopbarControls({dark,toggleTheme}:{dark:boolean;toggleTheme:()=>void}){
 const language=useLanguage(),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[open]);
 return <div className="topbar-controls"><div className="language-control" ref={root} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}}}>
 <Button ref={trigger} className="icon-button" type="button" title={t('Language')} aria-label={t('Language')} aria-expanded={open} aria-controls="language-options" onClick={()=>setOpen(!open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h12M9 3v2m4 0c-1 6-4 10-10 13m2-10c1 4 4 7 8 9m1 4 4-12 4 12m-6-4h5"/></svg></Button>
 {open&&<div id="language-options" className="language-options" role="group" aria-label={t('Language')}>{languages.map(item=><Button type="button" className="language-option" key={item.id} lang={item.id} aria-pressed={language===item.id} onClick={()=>{setLanguage(item.id);setOpen(false);trigger.current?.focus()}}>{item.name}</Button>)}</div>}</div>
 <Button type="button" className="icon-button" title={t(dark?'Switch to light mode':'Switch to dark mode')} aria-label={t(dark?'Switch to light mode':'Switch to dark mode')} onClick={toggleTheme}><svg viewBox="0 0 24 24" aria-hidden="true">{dark?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"/>}</svg></Button>
 </div>
}
