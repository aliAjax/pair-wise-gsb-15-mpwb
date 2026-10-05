import {useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Clock3,FileClock,GitBranch,Loader2,Search,ShieldAlert,Workflow as WorkflowIcon} from 'lucide-react';
import {engine,type SearchHit} from '../search/engine';
import {formatTime,useEngineState} from '../search/useEngineState';
import {useAppStore} from '../store/useAppStore';
import {IndexPanel} from './IndexPanel';

const typeMeta={
  workflow:{label:'流程',icon:WorkflowIcon},
  instance:{label:'实例',icon:GitBranch},
  version:{label:'版本',icon:FileClock},
} as const;

export function GlobalSearch(){
  const idx=useEngineState();
  const currentUser=useAppStore(s=>s.currentUser);
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState('');
  const [panel,setPanel]=useState(false);
  const [active,setActive]=useState(0);
  const nav=useNavigate();
  const boxRef=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLInputElement>(null);

  const {hits,total}=useMemo(()=>engine.query(q),[q,idx,currentUser]);
  const shown=hits.slice(0,12);
  const building=idx.building;
  const progress=building?Math.round(building.done.length/Math.max(1,building.total)*100):0;

  useEffect(()=>{
    const onDoc=(e:MouseEvent)=>{if(boxRef.current&&!boxRef.current.contains(e.target as Node))setOpen(false);};
    const onKey=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();setOpen(true);setTimeout(()=>inputRef.current?.focus(),0);}if(e.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',onDoc);document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('mousedown',onDoc);document.removeEventListener('keydown',onKey);};
  },[]);
  useEffect(()=>setActive(0),[q,open]);

  const openHit=(h:SearchHit)=>{
    if(h.type==='instance'){setOpen(false);setQ('');nav(h.url);return;}
    if(h.type==='version'){setOpen(false);setQ('');useAppStore.getState().setCurrent(h.workflowId);nav(h.url);return;}
    setOpen(false);setQ('');useAppStore.getState().setCurrent(h.workflowId);nav(h.url);
  };
  const onKeyDown=(e:React.KeyboardEvent)=>{
    if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(a+1,shown.length-1));}
    if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}
    if(e.key==='Enter'&&shown[active])openHit(shown[active]);
  };

  return <><div className="global-search" ref={boxRef}>
    <button className={`gs-trigger${open?' open':''}`} onClick={()=>{setOpen(o=>!o);setTimeout(()=>inputRef.current?.focus(),0);}}>
      <Search/><span>{q||'搜索流程、实例或申请人'}</span><kbd>⌘K</kbd>
    </button>
    {open&&<div className="gs-panel" data-testid="global-search-panel">
      <div className="gs-input"><Search/><input ref={inputRef} aria-label="全局检索" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="输入流程名、实例编号、申请人或版本说明"/><Loader2 className={building||idx.stale.length?'spin':'hide'}/></div>
      <div className="gs-results">
        {shown.length?shown.map((h,i)=>{const M=typeMeta[h.type];return <button key={h.key} className={`gs-row${i===active?' active':''}`} onMouseEnter={()=>setActive(i)} onClick={()=>openHit(h)}>
          <span className={`gs-type ${h.type}`}><M.icon/></span>
          <span className="gs-grow"><b>{h.title}</b><small>{h.subtitle}</small></span>
          <em>{M.label}</em>
        </button>;}):<div className="gs-empty"><b>没有匹配的结果</b><p>换个关键词试试，或等待索引重建完成。</p></div>}
      </div>
      <div className="gs-foot">
        <span data-testid="gs-hit-count">{q?`命中 ${hits.length} 条`:`可检索 ${total} 条`}</span>
        {building&&<span className="gs-building">重建 {progress}%（{building.done.length}/{building.total}）</span>}
        {!!idx.stale.length&&!building&&<span className="gs-pending">{idx.stale.length} 条待重建</span>}
        <span className="spacer"/>
        <span className="gs-time"><Clock3/>更新于 {formatTime(idx.indexedAt)}</span>
        <button className="gs-manage" onClick={()=>{setOpen(false);setPanel(true);}}>索引状态</button>
      </div>
      {idx.lastError&&<div className="gs-error" data-testid="gs-build-error">⚠ {idx.lastError}</div>}
      {idx.quarantined.length>0&&currentUser==='林秋'&&<div className="gs-quarantine-hint"><ShieldAlert/>{idx.quarantined.length} 条记录权限待核，已从检索结果隔离</div>}
    </div>}
  </div>{panel&&<IndexPanel onClose={()=>setPanel(false)}/>}</>;
}
