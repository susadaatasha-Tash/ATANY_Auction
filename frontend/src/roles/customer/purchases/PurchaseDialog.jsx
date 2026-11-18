import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './order-dialog.css';

const stack=[];
let originalOverflow='';
let background=[];
const tabbable='button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]';
export function PurchaseDialog({title,description,onClose,children,header,footer,className='',busy=false}) {
  const box=useRef(null), closeRef=useRef(onClose),busyRef=useRef(busy),label=useId(),hint=useId();
  closeRef.current=onClose;busyRef.current=busy;
  useEffect(()=>{
    const el=box.current,previous=document.activeElement;
    if(!stack.length) {
      originalOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
      background=[...document.body.children].filter(e=>!e.classList.contains('od-overlay')).map(e=>({el:e,inert:e.inert}));
      background.forEach(({el})=>{el.inert=true;});
    }
    const lower=stack.at(-1);
    if(lower){lower.inert=true;lower.setAttribute('aria-hidden','true');lower.setAttribute('aria-modal','false');lower.closest('.od-overlay').inert=true;}
    stack.push(el);el.focus();
    const key=e=>{
      if(stack.at(-1)!==el)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!busyRef.current)closeRef.current?.();}
      if(e.key==='Tab') {
        const items=[...el.querySelectorAll(tabbable)].filter(e=>!e.closest('[hidden]'));
        const first=items[0],last=items.at(-1);
        if(!first){e.preventDefault();el.focus();}
        else if(e.shiftKey && (document.activeElement===first || document.activeElement===el)){e.preventDefault();last.focus();}
        else if(!e.shiftKey && (document.activeElement===last || document.activeElement===el)){e.preventDefault();first.focus();}
      }
    };
    const focus=e=>{if(stack.at(-1)===el && !el.contains(e.target))el.focus();};
    document.addEventListener('keydown',key);document.addEventListener('focusin',focus);
    return ()=>{
      stack.splice(stack.indexOf(el),1);document.removeEventListener('keydown',key);document.removeEventListener('focusin',focus);
      const top=stack.at(-1);
      if(top){top.inert=false;top.removeAttribute('aria-hidden');top.setAttribute('aria-modal','true');top.closest('.od-overlay').inert=false;}
      if(!stack.length){document.body.style.overflow=originalOverflow;background.forEach(({el,inert})=>{el.inert=inert;});background=[];}
      if(previous?.isConnected)previous.focus();else stack.at(-1)?.focus();
    };
  },[]);
  return createPortal(<div className={`od-overlay ${className.includes('od-confirm')?'od-overlay-confirm':''}`} onMouseDown={e=>{if(e.target===e.currentTarget && !busy)onClose?.();}}>
    <section ref={box} className={`od-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={label} aria-describedby={description?hint:undefined} tabIndex={-1}>
      <header className="od-header">{header}<div className="od-heading"><h1 id={label}>{title}</h1>{description&&<p id={hint}>{description}</p>}</div><button className="od-close" aria-label={`Close ${title}`} onClick={onClose} disabled={busy}><X size={21}/></button></header>
      <div className="od-scroll">{children}</div>{footer&&<footer className="od-footer">{footer}</footer>}
    </section>
  </div>,document.body);
}
