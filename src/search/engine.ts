import type {Instance,Workflow} from '../types';
import {DEFAULT_USER,PEOPLE,instanceAccess,workflowAccess} from './acl';
import type {BuildCheckpoint,EntryType,IndexState,QuarantinedItem,SearchEntry} from './types';

const STORE_KEY='flowdesk:index:v2';
const LEGACY_KEY='flowdesk:index:v1';
const BOOT_KEY='flowdesk:boot:v2';
const CHANNEL='flowdesk-search-v2';
const CHUNK_SIZE=8;

export interface IndexDeps {
  workflows:Workflow[];
  instances:Instance[];
  revs:Record<string,number>;
  currentUser:string;
}

export const wfKey=(id:string)=>`wf:${id}`;
export const insKey=(id:string)=>`ins:${id}`;
export const verKey=(id:string,v:number)=>`ver:${id}:${v}`;
export const wfDepKeys=(w:Workflow,ins:Instance[])=>[wfKey(w.id),...w.versions.map(v=>verKey(w.id,v.version)),...ins.filter(i=>i.workflowId===w.id).map(i=>insKey(i.id))];

const norm=(s:string)=>s.toLowerCase().replace(/\s+/g,'');
const tabId=Math.random().toString(36).slice(2,8);
const now=()=>Date.now();
const empty=():IndexState=>({entries:{},indexedAt:null,stale:[],building:null,quarantined:[]});
const keyType=(key:string):EntryType=>key.startsWith('wf:')?'workflow':key.startsWith('ver:')?'version':'instance';

/** 从业务对象构建单条索引条目；记录缺失返回 null（调用方负责隔离） */
export function buildEntry(key:string,d:IndexDeps):SearchEntry|null{
  const kind=key.split(':')[0];
  if(kind==='wf'){
    const w=d.workflows.find(x=>x.id===key.slice(3)); if(!w)return null;
    return {key,type:'workflow',refId:w.id,workflowId:w.id,title:w.name,
      subtitle:`流程 · ${w.domain} · ${w.editor} · v${w.version}`,
      keywords:norm([w.name,w.domain,w.editor,`v${w.version}`].join(' ')),
      url:`/workflows/${w.id}`,updatedAt:w.updatedAt,indexedAt:now(),rev:d.revs[key]??0,salt:0,origin:tabId};
  }
  if(kind==='ver'){
    const [,id,vs]=key.split(':'); const v=Number(vs);
    const w=d.workflows.find(x=>x.id===id); if(!w)return null;
    const ver=w.versions.find(x=>x.version===v); if(!ver)return null;
    return {key,type:'version',refId:w.id,workflowId:w.id,version:v,title:`${w.name} · v${v}`,
      subtitle:`版本 · ${ver.note} · ${ver.createdAt}`,
      keywords:norm([w.name,`v${v}`,ver.note].join(' ')),
      url:`/workflows/${w.id}/versions`,updatedAt:ver.createdAt,indexedAt:now(),rev:d.revs[key]??0,salt:0,origin:tabId};
  }
  const i=d.instances.find(x=>x.id===key.slice(4)); if(!i)return null;
  const w=d.workflows.find(x=>x.id===i.workflowId);
  return {key,type:'instance',refId:i.id,workflowId:i.workflowId,title:i.id,
    subtitle:`实例 · ${i.applicant} · ${w?.name??i.workflowId} · ${i.status}`,
    keywords:norm([i.id,i.applicant,w?.name??'',i.domain,i.currentNode,i.status].join(' ')),
    url:`/monitor?instance=${i.id}`,updatedAt:i.submittedAt,indexedAt:now(),rev:d.revs[key]??0,salt:0,origin:tabId};
}

const newer=(a:SearchEntry,b:SearchEntry)=>a.rev>b.rev||(a.rev===b.rev&&a.salt>=b.salt);
const roleOf=(name:string)=>PEOPLE.find(p=>p.name===name)?.role??'未分配角色';

export interface SearchHit extends SearchEntry {matchType:EntryType}

class SearchEngine {
  state:IndexState=empty();
  private deps:IndexDeps={workflows:[],instances:[],revs:{},currentUser:DEFAULT_USER};
  private ch?:BroadcastChannel;
  private timer?:ReturnType<typeof setTimeout>;
  private running=false;
  private failAt:number|null=null;
  private listeners=new Set<()=>void>();
  private idleWaiters=new Set<()=>void>();
  private readonly persisted:boolean;

  constructor(){
    this.persisted=typeof localStorage!=='undefined';
    this.state=this.load()??empty();
    if(this.persisted){
      const ch=new BroadcastChannel(CHANNEL); this.ch=ch;
      ch.onmessage=e=>this.onRemote(e.data);
    }
  }

  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private emit(){this.listeners.forEach(f=>f());}

  bind(d:IndexDeps){this.deps=d;}
  get whenIdle():Promise<void>{
    if(!this.running&&!this.timer)return Promise.resolve();
    return new Promise(res=>this.idleWaiters.add(res));
  }
  private settleIdle(){if(!this.running&&!this.timer){this.idleWaiters.forEach(f=>f());this.idleWaiters.clear();}}

  private load():IndexState|null{
    if(!this.persisted)return null;
    try{
      if(localStorage.getItem(LEGACY_KEY)&&!localStorage.getItem(BOOT_KEY))return null; // 首次启动：先迁移旧版
      const s=localStorage.getItem(STORE_KEY); if(!s)return null;
      const p=JSON.parse(s);
      return {entries:p.entries??{},indexedAt:p.indexedAt??null,stale:p.stale??[],building:p.building??null,quarantined:p.quarantined??[],upgradedFrom:p.upgradedFrom,lastError:p.lastError,remoteProgress:p.remoteProgress??null};
    }catch{return null;}
  }
  private save=()=>{
    if(!this.persisted)return;
    const {entries,indexedAt,stale,building,quarantined,upgradedFrom,lastError,remoteProgress}=this.state;
    localStorage.setItem(STORE_KEY,JSON.stringify({entries,indexedAt,stale,building,quarantined,upgradedFrom,lastError,remoteProgress}));
  }
  private set(patch:Partial<IndexState>,persist=true){
    this.state={...this.state,...patch};
    if(persist)this.save();
    this.emit();
  }

  // —— 权限检索 ——
  query(raw:string){
    const user=this.deps.currentUser;
    const visible=(e:SearchEntry):boolean=>{
      if(user==='林秋')return true;
      const p={name:user,role:roleOf(user)};
      const w=this.deps.workflows.find(x=>x.id===e.workflowId);
      if(e.type==='workflow')return w?workflowAccess(p,w)==='allow':false;
      if(e.type==='version')return w?workflowAccess(p,w)==='allow':false;
      const i=this.deps.instances.find(x=>x.id===e.refId);
      if(!i)return false;
      return instanceAccess(p,i,this.deps.workflows.find(x=>x.id===i.workflowId))==='allow';
    };
    const list=Object.values(this.state.entries).filter(visible);
    const q=norm(raw.trim());
    const hits:SearchHit[]=(q?list.filter(e=>e.keywords.includes(q)):list)
      .sort((a,b)=>b.indexedAt-a.indexedAt)
      .map(e=>({...e,matchType:e.type}));
    return {hits,total:list.length};
  }

  // —— 失效：内容变更后对应键立即移出可用索引并入待重建 ——
  invalidateRevs(keys:string[]){
    const entries={...this.state.entries};
    const quarantine:QuarantinedItem[]=[];
    const staleKeys:string[]=[];
    for(const k of keys){
      if(entries[k])delete entries[k];
      if(buildEntry(k,this.deps))staleKeys.push(k);
      else if(!this.state.quarantined.some(q=>q.key===k))quarantine.push({key:k,type:keyType(k),title:k,reason:'acl-unknown',source:'runtime',at:now()});
    }
    // 全量构建进行中：并入检查点清单（已完成的重新入列，恢复/续跑均不重复产出）
    const cp=this.state.building;
    if(cp){
      const add=staleKeys.filter(k=>!cp.list.includes(k));
      const redo=staleKeys.filter(k=>cp.done.includes(k));
      const nextCp:BuildCheckpoint={...cp,list:[...cp.list,...add],total:cp.total+add.length,done:cp.done.filter(k=>!redo.includes(k))};
      this.set({entries,building:nextCp,quarantined:[...this.state.quarantined,...quarantine]});
      if(!this.running)this.run();
      return;
    }
    const stale=[...new Set([...this.state.stale,...staleKeys])];
    this.set({entries,stale,quarantined:[...this.state.quarantined,...quarantine]});
    this.schedule();
  }

  // —— 检查点构建：失败后从上次检查点继续，重复扫描不产生重复条目 ——
  startFullBuild(){
    if(this.state.building)return;
    const list=[...new Set(this.deps.workflows.flatMap(w=>wfDepKeys(w,this.deps.instances)))];
    const cp:BuildCheckpoint={buildId:'b'+now(),phase:'full',prune:true,total:list.length,list,done:[],at:now()};
    this.set({building:cp,stale:[],lastError:undefined,remoteProgress:undefined});
    this.run();
  }
  resume(){this.failAt=null;this.set({lastError:undefined});this.run();}

  private schedule(){
    if(this.timer)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=undefined;this.run();},120);
  }

  private run(){
    if(this.running)return;
    if(!this.state.building&&!this.state.stale.length){this.settleIdle();return;}
    this.running=true;
    const step=()=>{
      let cur=this.state.building;
      if(!cur&&this.state.stale.length){
        const list=[...new Set(this.state.stale)];
        cur={buildId:'r'+now(),phase:'rebuild',prune:false,total:list.length,list,done:[],at:now()};
        this.set({stale:[],building:cur},false);
      }
      if(!cur){this.running=false;this.save();this.emit();this.settleIdle();return;}
      const pending=cur.list.filter(k=>!cur!.done.includes(k));
      if(!pending.length){
        const patch:Partial<IndexState>={building:null,indexedAt:now()};
        if(cur.prune){const keep=new Set([...cur.list,...cur.done]);patch.entries=Object.fromEntries(Object.entries(this.state.entries).filter(([k])=>keep.has(k)));}
        this.set(patch);
        this.postProgress(null);
        this.running=false;
        if(this.state.stale.length)this.schedule();else this.settleIdle();
        return;
      }
      const batch=pending.slice(0,CHUNK_SIZE);
      const stopAfter=this.failAt!==null&&cur.done.length+batch.length>=this.failAt;
      const batch2=stopAfter?pending.slice(0,Math.max(1,this.failAt!-cur.done.length)):batch;
      const nextDone=[...cur.done];
      const entries={...this.state.entries};
      const q=[...this.state.quarantined];
      for(const k of batch2){
        const e=buildEntry(k,this.deps);
        if(e){e.salt=Math.floor(Math.random()*999);entries[k]=e;}
        else if(!q.some(x=>x.key===k))q.push({key:k,type:keyType(k),title:k,reason:'acl-unknown',source:'runtime',at:now()});
        nextDone.push(k); // 检查点先于重活落盘：恢复后不会重复产出
      }
      const next:BuildCheckpoint={...cur,done:nextDone,at:now()};
      if(stopAfter){
        const err=`构建在第 ${nextDone.length}/${cur.total} 项后中断，已保存检查点，恢复时将继续`;
        this.failAt=null;
        this.running=false;
        this.set({entries,building:next,quarantined:q,lastError:err});
        this.postProgress(next);
        return;
      }
      this.state={...this.state,entries,building:next,quarantined:q};
      this.save();
      this.postProgress(next);
      this.emit();
      setTimeout(step,18);
    };
    setTimeout(step,18);
  }

  private postProgress(cp:BuildCheckpoint|null){this.ch?.postMessage({kind:'progress',tab:tabId,cp});}

  /** CAS 写入：只接收修订号不早于现有条目的索引；后到的旧结果进入待重建 */
  commit(entry:SearchEntry,fromRemote=false):'applied'|'stale'|'quarantined'{
    const exists=this.state.entries[entry.key];
    if(exists&&!newer(entry,exists)){
      if(buildEntry(entry.key,this.deps)&&!this.state.stale.includes(entry.key))
        this.set({stale:[...this.state.stale,entry.key]});
      if(!fromRemote)this.schedule();
      return 'stale';
    }
    if(!buildEntry(entry.key,this.deps)){
      if(!this.state.quarantined.some(q=>q.key===entry.key))
        this.set({quarantined:[...this.state.quarantined,{key:entry.key,type:entry.type,title:entry.title,reason:'acl-unknown',source:'runtime',at:now()}]});
      return 'quarantined';
    }
    const entries={...this.state.entries,[entry.key]:{...entry,origin:fromRemote?entry.origin:tabId}};
    const stale=this.state.stale.filter(k=>k!==entry.key);
    this.set({entries,stale,indexedAt:now()});
    if(!fromRemote)this.ch?.postMessage({kind:'commit',tab:tabId,entry});
    return 'applied';
  }

  /** 窗口间业务数据更新（流程/实例/修订号） */
  recordsChanged(d:Partial<IndexDeps>){
    this.deps={...this.deps,...d};
    if(d.revs)this.invalidateRevs(Object.keys(d.revs));
  }

  private onRemote(msg:any){
    if(!msg||msg.tab===tabId)return;
    if(msg.kind==='commit'){
      const before=this.state.indexedAt;
      const r=this.commit(msg.entry,true);
      if(r==='applied'&&this.state.indexedAt!==before)this.emit();
    }else if(msg.kind==='progress'){
      this.state={...this.state,remoteProgress:msg.cp};
      if(!this.running)this.emit();
    }else if(msg.kind==='quarantine-op'){
      this.set({quarantined:this.state.quarantined.filter(q=>q.key!==msg.key)});
    }
  }

  // —— 旧数据升级：保留可用索引；无法判断权限的隔离待核 ——
  migrateLegacy(rawLegacy:string){
    const parsed=JSON.parse(rawLegacy) as {entries:SearchEntry[];version:string};
    const kept:Record<string,SearchEntry>={}; const stale:string[]=[]; const q:QuarantinedItem[]=[];
    for(const e of parsed.entries){
      const live=buildEntry(e.key,this.deps);
      if(!live){q.push({key:e.key,type:e.type,title:e.title,reason:'acl-unknown',source:'legacy',at:now()});continue;}
      const currentRev=this.deps.revs[e.key]??0;
      kept[e.key]={...live,...e,indexedAt:e.indexedAt||live.indexedAt,rev:currentRev,salt:0,origin:'legacy'};
      if((e.rev??0)<currentRev)stale.push(e.key);
    }
    const all=[...new Set(this.deps.workflows.flatMap(w=>wfDepKeys(w,this.deps.instances)))];
    const missing=all.filter(k=>!kept[k]);
    const list=[...new Set([...stale,...missing])];
    // 检查点：已保留且不需重建的条目计入 done，恢复后不重复扫描
    const done=Object.keys(kept).filter(k=>!stale.includes(k));
    const cp:BuildCheckpoint={buildId:'m'+now(),phase:'full',prune:true,total:all.length,list,done,at:now()};
    this.set({entries:kept,stale:[],quarantined:q,building:cp,indexedAt:now(),upgradedFrom:parsed.version,lastError:undefined});
    this.run();
  }

  // —— 隔离区管理（管理员核验） ——
  releaseQuarantine(key:string){
    if(!this.state.quarantined.some(q=>q.key===key))return;
    this.set({quarantined:this.state.quarantined.filter(q=>q.key!==key),stale:[...new Set([...this.state.stale,key])]});
    this.ch?.postMessage({kind:'quarantine-op',tab:tabId,key});
    this.schedule();
  }
  discardQuarantine(key:string){
    this.set({quarantined:this.state.quarantined.filter(q=>q.key!==key)});
    this.ch?.postMessage({kind:'quarantine-op',tab:tabId,key});
  }

  // —— 演示/测试：在已处理 N 项后注入一次构建失败 ——
  injectFailureAt(n:number){this.failAt=n;}
}

export const engine=new SearchEngine();
