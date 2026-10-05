// 全局检索状态：订阅业务数据变更驱动索引失效与重算，负责断点续建、持久化与权限化查询。
import {create} from 'zustand';
import {useAppStore} from './useAppStore';
import {SearchEngine,SCHEMA_VERSION,now,type Checkpoint,type MigrationReport,type SearchHit,type Snapshot} from '../search/engine';
import {derivedDocIds,extractAll,extractOne} from '../search/source';
import {legacySnapshotV1} from '../search/legacy';

const STORAGE_KEY='flowdesk.search.v2';
const BATCH=25;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

const engine=new SearchEngine();
let building=false,ready=false,failAt:number|null=null;

export interface SearchStatus{ready:boolean;building:boolean;docCount:number;sourceCount:number;pending:number;quarantined:number;updatedAt:string;migration:MigrationReport|null;resumedFrom:number;checkpoint:Checkpoint|null}
interface SearchState{query:string;hits:SearchHit[];total:number;status:SearchStatus;setQuery:(q:string)=>void;reviewQuarantine:()=>void}

const appState=()=>useAppStore.getState();
const source=()=>extractAll(appState().workflows,appState().instances);
const extract=(id:string)=>extractOne(id,appState().workflows,appState().instances);

function collectStatus():SearchStatus{
  return{ready,building,docCount:engine.docs.size,sourceCount:source().length,pending:engine.pending.size,quarantined:engine.quarantine.size,updatedAt:engine.updatedAt,migration:engine.lastMigration,resumedFrom:engine.resumedFrom,checkpoint:engine.checkpoint};
}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(engine.serialize()))}catch{/* 存储不可用时保持内存索引 */}}
function loadSnapshot():Snapshot|null{
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw)return JSON.parse(raw);
    const legacyRaw=localStorage.getItem('flowdesk.search.v1');
    if(legacyRaw)return JSON.parse(legacyRaw);
  }catch{/* 快照损坏时按首次启动处理 */}
  return legacySnapshotV1 as unknown as Snapshot; // 模拟旧版本数据升级
}

function refresh(){
  const{query}=useSearchStore.getState();
  const{hits,total}=engine.search(query,appState().user);
  useSearchStore.setState({hits,total,status:collectStatus()});
}

// 全量构建：按批处理并落检查点；失败时保留检查点，下次从断点继续；upsert 保证重复扫描不产生重复条目。
async function runFullBuild(){
  const records=source().filter(r=>!engine.quarantine.has(r.id));
  const start=engine.checkpoint?.cursor??0;
  building=true;refresh();
  try{
    for(let i=start;i<records.length;i+=BATCH){
      const batch=records.slice(i,i+BATCH);
      for(let j=0;j<batch.length;j++){
        if(failAt!==null&&i+j===failAt){failAt=null;throw new Error(`索引构建在记录 ${i+j} 处失败`)}
        engine.applyWrite({...batch[j],revision:engine.currentRev(batch[j].id),indexedAt:now()});
      }
      engine.checkpoint={cursor:Math.min(i+BATCH,records.length),total:records.length,savedAt:now()};
      persist();refresh();
      await sleep(15);
    }
    engine.checkpoint=null;
  }finally{
    building=false;persist();refresh();
  }
}

// 增量同步：源记录与索引指纹不一致或缺失时重算；隔离记录跳过。
function syncIncremental(){
  const stale=source().filter(r=>!engine.quarantine.has(r.id)&&engine.docs.get(r.id)?.fingerprint!==r.fingerprint).map(r=>r.id);
  const removed=[...engine.docs.keys()].filter(id=>!extract(id));
  if(removed.length)engine.drop(removed);
  if(stale.length){engine.invalidate(stale);scheduleIndex(stale)}
}

// 增量索引队列：调度时捕获修订号，异步应用时由引擎做最新修订号守卫。
const queue=new Set<string>();
let timer:ReturnType<typeof setTimeout>|null=null;
function scheduleIndex(ids:string[]){ids.forEach(id=>queue.add(id));if(timer)clearTimeout(timer);timer=setTimeout(flush,120)}
async function flush(){
  const jobs=[...queue].map(id=>({id,rev:engine.currentRev(id)}));
  queue.clear();
  building=true;refresh();
  await sleep(0);
  for(const job of jobs){
    const rec=extract(job.id);
    if(rec)engine.applyWrite({...rec,revision:job.rev,indexedAt:now()});
  }
  engine.drainPending(extract);
  building=false;persist();refresh();
}

function reviewQuarantine(){
  engine.reviewQuarantine(extract);
  persist();refresh();
}

// 启动：恢复或迁移快照，随后断点续建或增量同步。
async function boot(){
  const snapshot=loadSnapshot();
  if(snapshot){
    if(snapshot.schemaVersion===SCHEMA_VERSION)engine.restore(snapshot);
    else engine.migrate(snapshot as any,new Map(source().map(r=>[r.id,r])));
  }
  for(const r of source())if(!engine.revisions.has(r.id))engine.revisions.set(r.id,1);
  if(engine.checkpoint){engine.resumedFrom=engine.checkpoint.cursor;await runFullBuild()}
  else syncIncremental();
  // 等待增量队列落定后再标记就绪。
  await new Promise<void>(resolve=>{const t=setInterval(()=>{if(!building&&queue.size===0){clearInterval(t);resolve()}},30)});
  ready=true;persist();refresh();
}

// 订阅业务数据：变更的记录立即失效并按新内容异步重算。
useAppStore.subscribe((state,prev)=>{
  if(state.user!==prev.user){refresh();return}
  const prevWf=new Map(prev.workflows.map(w=>[w.id,w]));
  const changedWf=state.workflows.filter(w=>prevWf.get(w.id)!==w).map(w=>w.id);
  const prevIns=new Map(prev.instances.map(i=>[i.id,i]));
  const changedIns=state.instances.filter(i=>prevIns.get(i.id)!==i).map(i=>i.id);
  const removedWf=prev.workflows.filter(w=>!state.workflows.some(x=>x.id===w.id)).map(w=>w.id);
  if(!changedWf.length&&!changedIns.length&&!removedWf.length)return;
  const affected=new Set<string>();
  for(const id of changedWf)for(const d of derivedDocIds(id,state.workflows.find(w=>w.id===id),state.instances))affected.add(d);
  for(const id of changedIns)affected.add(`ins:${id}`);
  for(const id of removedWf){const w=prevWf.get(id)!;engine.drop(derivedDocIds(id,w,prev.instances))}
  const ids=[...affected].filter(id=>extract(id));
  if(ids.length){engine.invalidate(ids);scheduleIndex(ids)}
  refresh();
});

export const useSearchStore=create<SearchState>(()=>({query:'',hits:[],total:0,status:collectStatus(),setQuery:q=>{useSearchStore.setState({query:q});refresh()},reviewQuarantine}));

// 测试与调试钩子：驱动并发守卫、断点续建等难以通过界面确定性触发的路径。
if(typeof window!=='undefined'){
  (window as any).__search={
    status:collectStatus,
    applyStaleWrite:(id:string,title:string)=>{const rec=extract(id);if(!rec)return 'missing';const r=engine.applyWrite({...rec,title,revision:engine.currentRev(id)-1,indexedAt:now()});persist();refresh();return r},
    drain:()=>{engine.drainPending(extract);persist();refresh()},
    rebuildAll:(reset=false)=>{if(reset){engine.docs.clear();engine.revisions.clear();engine.checkpoint=null}return runFullBuild().catch(()=>{})},
    failNextBuildAt:(n:number)=>{failAt=n},
    review:reviewQuarantine,
  };
}

boot().catch(err=>console.warn('搜索索引初始化失败',err));
