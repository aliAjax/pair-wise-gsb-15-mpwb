import {useSyncExternalStore} from 'react';
import {engine} from './engine';
import type {IndexState} from './types';

export function useEngineState():IndexState{
  return useSyncExternalStore(engine.subscribe,()=>engine.state,()=>engine.state);
}

export function formatTime(t:number|null):string{
  if(!t)return '尚未构建';
  const d=new Date(t),p=(x:number)=>String(x).padStart(2,'0');
  return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
