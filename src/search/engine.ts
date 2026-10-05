// 全局检索索引引擎：纯 TypeScript 实现，不依赖 React。
// 负责文档存储、修订号并发守卫、待重建队列、断点检查点、旧版本快照迁移与权限过滤。

export const SCHEMA_VERSION=2;
export const ADMIN_USER='林秋';

export type DocKind='workflow'|'version'|'instance';
export interface SourceRecord{id:string;kind:DocKind;title:string;subtitle:string;body:string;acl:string[]|null;route:string;fingerprint:string}
export interface IndexEntry extends SourceRecord{revision:number;indexedAt:string}
export interface Checkpoint{cursor:number;total:number;savedAt:string}
export interface QuarantinedEntry{id:string;kind:DocKind;title:string;reason:string}
export interface MigrationReport{kept:number;quarantined:number;dropped:number}
export interface Snapshot{schemaVersion:number;docs:IndexEntry[];revisions:Record<string,number>;quarantine:QuarantinedEntry[];checkpoint:Checkpoint|null;updatedAt:string}
export interface SearchHit{entry:IndexEntry;score:number}
export interface LegacyEntry{id:string;kind?:DocKind;title?:string;revision?:number;indexedAt?:string;acl?:string[]|null}

export const now=()=>new Date().toISOString();
// 简单稳定的内容指纹（djb2），用于跨会话判断源记录内容是否变化。
export function fingerprint(text:string):string{let h=5381;for(let i=0;i<text.length;i++)h=((h<<5)+h+text.charCodeAt(i))>>>0;return h.toString(36)}
export function canAccess(user:string,acl:string[]|null):boolean{return acl===null||acl.includes(user)||user===ADMIN_USER}

export class SearchEngine{
  docs=new Map<string,IndexEntry>();
  revisions=new Map<string,number>();
  pending=new Map<string,number>();        // 待重建：记录 id -> 需要的修订号
  quarantine=new Map<string,QuarantinedEntry>();
  checkpoint:Checkpoint|null=null;
  updatedAt='';
  lastMigration:MigrationReport|null=null;
  resumedFrom=0;

  currentRev(id:string):number{return this.revisions.get(id)??1}
  bumpRev(id:string):number{const r=this.currentRev(id)+1;this.revisions.set(id,r);return r}

  // 源记录变更时同步调用：立即从索引中移除，保证旧内容不会被搜到。
  invalidate(ids:string[]):void{for(const id of ids){this.docs.delete(id);this.bumpRev(id)}this.updatedAt=now()}
  drop(ids:string[]):void{for(const id of ids){this.docs.delete(id);this.revisions.delete(id);this.pending.delete(id)}}

  // 并发守卫：只接收带最新修订号的写入；后到的旧结果转入待重建。
  applyWrite(entry:IndexEntry):'accepted'|'stale'|'quarantined'{
    if(this.quarantine.has(entry.id))return 'quarantined';
    const sourceRev=this.currentRev(entry.id);
    const indexedRev=this.docs.get(entry.id)?.revision??0;
    if(entry.revision<sourceRev||entry.revision<indexedRev){
      this.pending.set(entry.id,Math.max(sourceRev,indexedRev));
      return 'stale';
    }
    this.docs.set(entry.id,entry);
    this.revisions.set(entry.id,entry.revision);
    this.updatedAt=entry.indexedAt;
    return 'accepted';
  }

  // 对待重建队列按当前源内容重算；upsert 语义保证重复扫描不产生重复条目。
  drainPending(extract:(id:string)=>SourceRecord|null):number{
    const ids=[...this.pending.keys()];
    let drained=0;
    for(const id of ids){
      this.pending.delete(id);
      const rec=extract(id);
      if(rec){const r=this.applyWrite({...rec,revision:this.currentRev(id),indexedAt:now()});if(r==='accepted')drained++}
    }
    return drained;
  }

  search(query:string,user:string):{hits:SearchHit[];total:number}{
    const tokens=query.toLowerCase().split(/\s+/).filter(Boolean);
    if(!tokens.length)return{hits:[],total:0};
    const hits:SearchHit[]=[];
    for(const entry of this.docs.values()){
      if(!canAccess(user,entry.acl))continue;
      const title=entry.title.toLowerCase(),hay=(entry.title+' '+entry.subtitle+' '+entry.body+' '+entry.id).toLowerCase();
      if(!tokens.every(t=>hay.includes(t)))continue;
      let score=0;
      const q=tokens.join(' ');
      if(title===q)score+=100;
      for(const t of tokens){if(title.includes(t))score+=10;if(entry.id.toLowerCase().includes(t))score+=5;score+=1}
      hits.push({entry,score});
    }
    hits.sort((a,b)=>b.score-a.score||a.entry.id.localeCompare(b.entry.id));
    return{hits,total:hits.length};
  }

  // 旧数据升级：保留仍可用的索引；无法判断权限的记录隔离待核；源已删除或内容过期的条目丢弃后由增量同步重建。
  migrate(old:{docs:LegacyEntry[]},source:Map<string,SourceRecord>):MigrationReport{
    const report:MigrationReport={kept:0,quarantined:0,dropped:0};
    for(const e of old.docs){
      const src=source.get(e.id);
      if(e.acl===undefined){
        this.quarantine.set(e.id,{id:e.id,kind:e.kind??'workflow',title:e.title??e.id,reason:'旧数据缺少权限信息，无法判断可见范围'});
        report.quarantined++;continue;
      }
      if(!src){report.dropped++;continue}
      if((e.revision??0)<1){report.dropped++;continue}
      this.docs.set(e.id,{...src,revision:e.revision!,indexedAt:e.indexedAt??now()});
      this.revisions.set(e.id,e.revision!);
      report.kept++;
    }
    this.lastMigration=report;
    this.updatedAt=now();
    return report;
  }

  // 隔离复核：源记录存在则按当前内容重建并解除隔离，否则继续隔离。
  reviewQuarantine(extract:(id:string)=>SourceRecord|null):{restored:number;kept:number}{
    let restored=0,kept=0;
    for(const id of[...this.quarantine.keys()]){
      const rec=extract(id);
      if(rec){this.quarantine.delete(id);this.applyWrite({...rec,revision:this.currentRev(id),indexedAt:now()});restored++}
      else kept++;
    }
    return{restored,kept};
  }

  serialize():Snapshot{return{schemaVersion:SCHEMA_VERSION,docs:[...this.docs.values()],revisions:Object.fromEntries(this.revisions),quarantine:[...this.quarantine.values()],checkpoint:this.checkpoint,updatedAt:this.updatedAt}}
  restore(s:Snapshot):void{
    this.docs=new Map(s.docs.map(d=>[d.id,d]));
    this.revisions=new Map(Object.entries(s.revisions||{}));
    this.quarantine=new Map((s.quarantine||[]).map(q=>[q.id,q]));
    this.checkpoint=s.checkpoint||null;
    this.updatedAt=s.updatedAt||'';
  }
}
