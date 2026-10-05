// 从业务数据提取可检索文档：流程、流程版本、运行实例，并派生权限与内容指纹。
import type {Instance,Workflow} from '../types';
import {fingerprint,type SourceRecord} from './engine';

const statusText:Record<string,string>={published:'已发布',draft:'草稿',archived:'已归档',abnormal:'异常',timeout:'超时',running:'进行中',completed:'已完成'};
const configText=(cfg:Record<string,any>):string=>Object.values(cfg).map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join(' ');
const fp=(parts:unknown[])=>fingerprint(JSON.stringify(parts));

export function workflowDoc(w:Workflow):SourceRecord{
  const body=[w.name,w.domain,w.editor,statusText[w.status],...w.nodes.flatMap(n=>[n.data.label,configText(n.data.config)])].join(' ');
  return{id:`wf:${w.id}`,kind:'workflow',title:w.name,subtitle:`${w.domain} · ${statusText[w.status]} · v${w.version} · ${w.editor}`,body,acl:w.acl??null,route:`/workflows/${w.id}`,fingerprint:fp([w.name,w.domain,w.status,w.version,w.editor,w.acl??null,body])};
}
export function versionDoc(w:Workflow,v:Workflow['versions'][number]):SourceRecord{
  const body=[w.name,`v${v.version}`,v.note,...v.nodes.map(n=>n.data.label)].join(' ');
  return{id:`ver:${w.id}:${v.version}`,kind:'version',title:`${w.name} · v${v.version}`,subtitle:`${v.createdAt} · ${v.note}`,body,acl:w.acl??null,route:`/workflows/${w.id}/versions`,fingerprint:fp([w.name,v.version,v.note,w.acl??null,v.nodes.length])};
}
export function instanceDoc(i:Instance,w?:Workflow):SourceRecord{
  // 实例权限跟随所属流程；申请人始终可见自己的实例。
  const acl=w?.acl?[...new Set([...w.acl,i.applicant])]:null;
  const body=[i.id,i.applicant,i.domain,i.currentNode,statusText[i.status],w?.name??''].join(' ');
  return{id:`ins:${i.id}`,kind:'instance',title:i.id,subtitle:`${i.applicant} · ${i.domain} · ${statusText[i.status]}`,body,acl,route:`/monitor?instance=${i.id}`,fingerprint:fp([i.applicant,i.domain,i.currentNode,i.status,acl,w?.name??''])};
}

export function extractAll(workflows:Workflow[],instances:Instance[]):SourceRecord[]{
  const out:SourceRecord[]=[];
  for(const w of workflows){out.push(workflowDoc(w));for(const v of w.versions)out.push(versionDoc(w,v))}
  for(const i of instances)out.push(instanceDoc(i,workflows.find(w=>w.id===i.workflowId)));
  return out.sort((a,b)=>a.id.localeCompare(b.id));
}
export function extractOne(id:string,workflows:Workflow[],instances:Instance[]):SourceRecord|null{
  const [kind,a,b]=id.split(':');
  if(kind==='wf'){const w=workflows.find(x=>x.id===a);return w?workflowDoc(w):null}
  if(kind==='ver'){const w=workflows.find(x=>x.id===a);const v=w?.versions.find(x=>x.version===Number(b));return w&&v?versionDoc(w,v):null}
  if(kind==='ins'){const i=instances.find(x=>x.id===a);return i?instanceDoc(i,workflows.find(w=>w.id===i.workflowId)):null}
  return null;
}
// 流程变更时需要一起失效的派生文档：流程本身、全部版本、该流程下的实例。
export function derivedDocIds(workflowId:string,w:Workflow|undefined,instances:Instance[]):string[]{
  const ids=[`wf:${workflowId}`];
  for(const v of w?.versions??[])ids.push(`ver:${workflowId}:${v.version}`);
  for(const i of instances)if(i.workflowId===workflowId)ids.push(`ins:${i.id}`);
  return ids;
}
