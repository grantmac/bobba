import './room-extras.css';
import {makeDraggable} from './draggable.js';
export function roomExtraPanel(title){
  const toggle=document.createElement('button');toggle.type='button';toggle.className='bar-icon';toggle.textContent=title;toggle.setAttribute('aria-label',title);toggle.setAttribute('aria-haspopup','dialog');
  document.querySelector('.bar-icons')?.append(toggle);
  const dialog=document.createElement('dialog');dialog.className='appearance-dialog agent-dialog room-extra-dialog';dialog.setAttribute('aria-label',title);dialog.tabIndex=-1;
  const header=document.createElement('header'),heading=document.createElement('h1'),close=document.createElement('button');heading.textContent=title;close.textContent='×';close.className='appearance-close';close.setAttribute('aria-label','Close '+title);
  const body=document.createElement('div');body.className='agent-body room-extra-body';header.append(heading,close);dialog.append(header,body);document.body.append(dialog);makeDraggable(dialog,header);
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>toggle.focus());
  return {toggle,dialog,body};
}
export function button(text,action){const b=document.createElement('button');b.type='button';b.className='agent-small';b.textContent=text;b.onclick=()=>action(b);return b;}
export function element(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
