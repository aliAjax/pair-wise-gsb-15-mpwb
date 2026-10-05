import {useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {useNavigate} from 'react-router-dom';
import {FileClock,FileSearch,Search,ShieldQuestion,Workflow as WorkflowIcon,Activity} from 'lucide-react';
import {useSearchStore} from '../store/searchStore';
import type {SearchHit} from '../search/engine';

const groups:[SearchHit['entry']['kind'],string,typeof WorkflowIcon][]=[['workflow','流程',WorkflowIcon],['instance','实例',Activity],['version','版本',FileClock]];
const PER_GROUP=6;
const time=(iso:string)=>iso?new Date(iso).toLocaleTimeString('zh-CN',{hour12:false}):'—';

export function GlobalSearch(){
  const nav=useNavigate();
  const{query,hits,total,status,setQuery,reviewQuarantine}=useSearchStore();
  const[open,setOpen]=useState(false);
  const[active,setActive]=useState(0);
  const wrap=useRef<HTMLDivElement>(null);
  const grouped=useMemo(()=>groups.map(([kind,label,Icon])=>({kind,label,Icon,items:hits.filter(h=>h.entry.kind===kind).slice(0,PER_GROUP)})).filter(g=>g.items.length>0),[hits]);
  const flat=useMemo(()=>grouped.flatMap(g=>g.items),[grouped]);
  const openDoc=(h:SearchHit)=>{setOpen(false);setQuery('');nav(h.entry.route)};
  const onKey=(e:KeyboardEvent)=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(a=>(a+(e.key==='ArrowDown'?1:-1)+flat.length)%Math.max(flat.length,1))}
    else if(e.key==='Enter'&&flat[active])openDoc(flat[active]);
    else if(e.key==='Escape')setOpen(false);
  };
  let row=-1;
  return <div className="gs-wrap" ref={wrap} onBlur={e=>{if(!wrap.current?.contains(e.relatedTarget as Node))setOpen(false)}}>
    <div className="gs-input"><Search/><input data-testid="global-search-input" aria-label="全局搜索" placeholder="搜索流程、实例或申请人" value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setActive(0);setOpen(true)}} onKeyDown={onKey}/></div>
    {open&&<div className="gs-panel" data-testid="search-results">
      <div className="gs-head">
        <span data-testid="search-hit-count">{query.trim()?`命中 ${total} 条`:'输入关键词开始检索'}</span>
        <span data-testid="search-updated-at">索引更新于 {time(status.updatedAt)}</span>
      </div>
      {query.trim()&&!flat.length&&<div className="gs-empty"><FileSearch/><p>未找到匹配「{query}」的内容</p></div>}
      {grouped.map(g=><div className="gs-group" key={g.kind}>
        <h4>{g.label} · {hits.filter(h=>h.entry.kind===g.kind).length}</h4>
        {g.items.map(h=>{row++;const idx=row;return<button key={h.entry.id} data-testid="search-result-item" data-kind={h.entry.kind} className={'gs-item'+(idx===active?' active':'')} onMouseEnter={()=>setActive(idx)} onClick={()=>openDoc(h)}>
          <g.Icon/><span className="gs-item-main"><b>{h.entry.title}</b><small>{h.entry.subtitle}</small></span><em>{g.label}</em>
        </button>})}
      </div>)}
      {status.migration&&<div className="gs-migration">已升级旧索引：保留 {status.migration.kept} 条 · 隔离待核 {status.migration.quarantined} 条 · 重建 {status.migration.dropped} 条</div>}
      <div className="gs-foot" data-testid="search-index-status">
        <span>索引 {status.docCount} 条{status.building&&' · 构建中…'}{status.pending>0&&` · 待重建 ${status.pending}`}</span>
        {status.quarantined>0?<button className="gs-review" data-testid="quarantine-review" onClick={reviewQuarantine}><ShieldQuestion/>隔离待核 {status.quarantined} · 重新扫描</button>:<span>权限过滤已启用</span>}
      </div>
    </div>}
  </div>;
}
