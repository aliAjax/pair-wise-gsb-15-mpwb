import {AlertTriangle,CheckCircle2,History,Play,RefreshCw,ShieldAlert,X} from 'lucide-react';
import {engine} from '../search/engine';
import {formatTime,useEngineState} from '../search/useEngineState';
import {resetForLegacyUpgrade} from '../search/bootstrap';
import {useAppStore} from '../store/useAppStore';

export function IndexPanel({onClose}:{onClose:()=>void}){
  const idx=useEngineState();
  const entries=Object.values(idx.entries);
  const count=(t:string)=>entries.filter(e=>e.type===t).length;
  const cp=idx.building;
  const rp=idx.remoteProgress;
  const admin=useAppStore(s=>s.currentUser)==='林秋';
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal index-modal" data-testid="index-panel" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><small>SEARCH INDEX</small><h2>全局检索索引</h2></div><button className="icon-btn" onClick={onClose}><X/></button></div>
      <div className="index-stats">
        <article><small>流程</small><b data-testid="idx-count-wf">{count('workflow')}</b></article>
        <article><small>实例</small><b data-testid="idx-count-ins">{count('instance')}</b></article>
        <article><small>版本</small><b>{count('version')}</b></article>
        <article><small>待重建</small><b className={idx.stale.length?'warn':''} data-testid="idx-stale-count">{idx.stale.length}</b></article>
        {admin&&<article><small>隔离待核</small><b className={idx.quarantined.length?'danger':''} data-testid="idx-quarantine-count">{idx.quarantined.length}</b></article>}
      </div>
      <div className="index-meta">
        <span>最近更新：<b data-testid="idx-updated">{formatTime(idx.indexedAt)}</b></span>
        {idx.upgradedFrom&&<span className="upgraded"><History/>由旧版 {idx.upgradedFrom} 升级，可用索引已保留</span>}
      </div>
      {(cp||rp)&&<div className="index-progress">
        <b>{cp?'索引构建中（本窗口）':'另一窗口正在构建'}</b>
        <div className="bar"><i style={{width:`${Math.round((cp??rp)!.done.length/Math.max(1,(cp??rp)!.total)*100)}%`}}/></div>
        <small>{(cp??rp)!.done.length}/{(cp??rp)!.total} · 检查点 {(cp??rp)!.done.length} 项已落盘</small>
      </div>}
      {idx.lastError&&<div className="index-error" data-testid="idx-error"><AlertTriangle/><span>{idx.lastError}</span><button data-testid="idx-resume" onClick={()=>engine.resume()}><Play/>从检查点继续</button></div>}
      <div className="index-actions">
        <button className="secondary" data-testid="idx-rebuild" onClick={()=>engine.startFullBuild()}><RefreshCw/>全量重建</button>
        <button className="secondary" data-testid="idx-fail" onClick={()=>{engine.startFullBuild();engine.injectFailureAt(20);}}><AlertTriangle/>模拟构建中断</button>
        <button className="secondary" data-testid="idx-legacy" onClick={()=>{resetForLegacyUpgrade();location.reload();}}><History/>模拟旧版升级（刷新）</button>
      </div>
      <h3><ShieldAlert/> 权限隔离区</h3>
      <p className="index-note">无法判断访问权限的记录不参与检索，管理员核验后可释放为待重建或放弃。</p>
      {admin?<div className="quarantine-list">
        {idx.quarantined.length?idx.quarantined.map(q=><div key={q.key} className="quarantine-row" data-testid="quarantine-row">
          <AlertTriangle/>
          <span className="grow"><b>{q.title}</b><small>{q.key} · {q.source==='legacy'?'旧版升级残留':'运行时缺失'} · {new Date(q.at).toLocaleTimeString()}</small></span>
          <button className="secondary mini" data-testid="quarantine-release" onClick={()=>engine.releaseQuarantine(q.key)}><CheckCircle2/>核验通过并重建</button>
          <button className="secondary mini danger" data-testid="quarantine-discard" onClick={()=>engine.discardQuarantine(q.key)}>放弃</button>
        </div>):<div className="q-empty">没有待核记录</div>}
      </div>:<div className="q-empty">仅平台管理员可处理权限待核记录</div>}
    </div>
  </div>;
}
