import type { ComponentPropsWithRef, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
export function Button({variant,pending=false,children,disabled,...props}:ComponentPropsWithRef<'button'>&{variant?:'primary'|'secondary';pending?:boolean}) {
  return <button {...props} className={`${variant ? `${variant}-button` : props.className ? '' : 'primary-button'} ${props.className??''}`} disabled={disabled||pending} aria-busy={pending||props['aria-busy']}>{pending&&<span className="update-spinner" aria-hidden="true"/>}{children}</button>;
}
export function GuideStep({number,title,children}:{number:string;title:string;children:ReactNode}) {
  return <section><span className="guide-index">{number}</span><div><h2>{title}</h2>{children}</div></section>;
}
export function PageHeader({eyebrow,title,children}:{eyebrow:string;title:string;children?:ReactNode}) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{children&&<p className="lead">{children}</p>}</div></div>;
}
export function Progress({value,label}:{value:number;label:string}) {
  return <div className="progress-block"><p role="status">{label}</p><progress max={7} value={value} aria-label={label}/></div>;
}
export function ComponentGallery(){return <><PageHeader eyebrow="DESIGN SYSTEM" title="Interface foundations">Shared components and states used throughout Image Studio.</PageHeader><section className="surface-card"><h2>Actions</h2><div className="form-actions"><Button>Primary action</Button><Button variant="secondary">Secondary action</Button><Button disabled>Unavailable</Button><Button pending>Preparing…</Button></div></section><section className="surface-card"><h2>Processing</h2><Progress value={3} label="3 of 7 images ready"/></section><div className="guide-list"><GuideStep number="01" title="A readable step"><p>One shared structure keeps the index and content in their intended columns.</p></GuideStep></div></>}

export function Input(props:InputHTMLAttributes<HTMLInputElement>){return <input {...props}/>}
export function Select(props:SelectHTMLAttributes<HTMLSelectElement>){return <select {...props}/>}
export function Textarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>){return <textarea {...props}/>}
