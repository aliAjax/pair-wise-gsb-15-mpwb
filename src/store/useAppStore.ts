import {create} from 'zustand'; import {workflows as seed} from '../../mock-data/workflows'; import {instances as seedInstances} from '../../mock-data/instances'; import type {FlowEdge,FlowNode,ValidationIssue,Workflow,Instance} from '../types';
import {DEFAULT_USER} from '../search/acl';
import {engine,insKey,verKey,wfDepKeys,wfKey} from '../search/engine';
import {STORE_STATE_KEY} from '../search/bootstrap';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const CHANNEL='flowdesk-store-v2';
const tab=Math.random().toString(36).slice(2,8);
const validate=(w:Workflow):ValidationIssue[]=>{const issues:ValidationIssue[]=[]; if(!w.nodes.some(n=>n.type==='end')) issues.push({nodeId:w.nodes[0]?.id||'flow',level:'error',message:'流程缺少结束节点'}); const linked=new Set(w.edges.flatMap(e=>[e.source,e.target])); w.nodes.filter(n=>n.type!=='start'&&n.type!=='end'&&!linked.has(n.id)).forEach(n=>issues.push({nodeId:n.id,level:'error',message:'必经节点不能孤立'})); w.nodes.forEach(n=>{if(n.type==='condition'&&!n.data.config.ruleType)issues.push({nodeId:n.id,level:'error',message:'条件分支规则未配置'}); if(n.type==='approval'&&!n.data.config.approverSource)issues.push({nodeId:n.id,level:'error',message:'审批人不能为空'});}); return issues};
const stamp=()=>{const d=new Date();const p=(x:number)=>String(x).padStart(2,'0');return `2026-07-11 ${p(d.getHours())}:${p(d.getMinutes())}`;};
const bump=(revs:Record<string,number>,keys:string[]):Record<string,number>=>{
  const stored=Math.max(Number(localStorage.getItem('flowdesk:rev-seq')??'1'),...Object.values(revs),1);
  const next=stored+1; localStorage.setItem('flowdesk:rev-seq',String(next));
  const out={...revs}; for(const k of keys)out[k]=next; return out;
};
interface PersistedState{workflows:Workflow[];instances:Instance[];revs:Record<string,number>}
function loadPersisted():PersistedState{
  try{const raw=localStorage.getItem(STORE_STATE_KEY);if(raw){const p=JSON.parse(raw);if(Array.isArray(p.workflows)&&Array.isArray(p.instances))return{workflows:p.workflows,instances:p.instances,revs:p.revs??{}};}}catch{}
  const revs:Record<string,number>={};
  for(const w of seed)for(const k of wfDepKeys(w,seedInstances))revs[k]=1;
  return {workflows:clone(seed),instances:seedInstances,revs};
}
const initial=loadPersisted();
localStorage.setItem(STORE_STATE_KEY,JSON.stringify(initial));
if(!localStorage.getItem('flowdesk:rev-seq'))localStorage.setItem('flowdesk:rev-seq',String(Math.max(1,...Object.values(initial.revs))));

interface State extends PersistedState{currentId:string;currentUser:string;selectedNodeId:string|null;issues:ValidationIssue[];toast:string;setCurrent:(id:string)=>void;setCurrentUser:(name:string)=>void;selectNode:(id:string|null)=>void;updateNodes:(nodes:FlowNode[])=>void;updateEdges:(edges:FlowEdge[])=>void;updateConfig:(id:string,config:Record<string,any>)=>void;runValidation:()=>ValidationIssue[];save:()=>void;publish:()=>void;create:()=>string;copy:(id:string)=>void;archive:(id:string)=>void;restore:(v:number)=>void;clearToast:()=>void;__ingest:(p:{workflows?:Workflow[];instances?:Instance[];revs?:Record<string,number>})=>void}

let bc:BroadcastChannel|undefined;
if(typeof BroadcastChannel!=='undefined')bc=new BroadcastChannel(CHANNEL);

export const useAppStore=create<State>((set,get)=>({...initial,currentId:'wf-1',currentUser:DEFAULT_USER,selectedNodeId:null,issues:[],toast:'',
setCurrent:id=>set({currentId:id,selectedNodeId:null,issues:[]}),
setCurrentUser:name=>{set({currentUser:name});engine.bind({...pickDeps(get())});},
selectNode:id=>set({selectedNodeId:id}),
__ingest:p=>{
  const s=get();
  const revs=p.revs?{...s.revs}:s.revs;
  if(p.revs)for(const [k,v] of Object.entries(p.revs))if((revs[k]??0)<v)revs[k]=v;
  set({workflows:p.workflows??s.workflows,instances:p.instances??s.instances,revs});
  // 仅接收更新的修订号；回声窗口（修订号未更新）不再广播
  const newerRevs=p.revs?Object.fromEntries(Object.entries(p.revs).filter(([k,v])=>(s.revs[k]??0)<v)):{};
  if(p.workflows||p.instances||Object.keys(newerRevs).length){
    engine.bind({...pickDeps(get())});
    engine.recordsChanged({workflows:p.workflows,instances:p.instances,revs:newerRevs});
    persist(get());
  }
},
updateNodes:nodes=>mutate(get,set,s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,nodes}:w)})),
updateEdges:edges=>mutate(get,set,s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,edges}:w)})),
updateConfig:(id,config)=>mutate(get,set,s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,nodes:w.nodes.map(n=>n.id===id?{...n,data:{...n.data,config:{...n.data.config,...config},state:'configuring'}}:n)}:w)})),
runValidation:()=>{const w=get().workflows.find(x=>x.id===get().currentId)!; const issues=validate(w); set(s=>({issues,workflows:s.workflows.map(x=>x.id===w.id?{...x,nodes:x.nodes.map(n=>({...n,data:{...n.data,state:issues.some(i=>i.nodeId===n.id)?'invalid':'valid'}}))}:x),toast:issues.length?`发现 ${issues.length} 个问题`:'校验通过'}));return issues},
save:()=>mutate(get,set,s=>({workflows:s.workflows.map(w=>w.id===s.currentId?{...w,status:'draft',updatedAt:stamp()}:w),toast:'草稿已保存'})),
publish:()=>mutate(get,set,s=>({workflows:s.workflows.map(w=>{if(w.id!==s.currentId)return w;const v=w.version+1;return {...w,status:'published',version:v,publishedAt:stamp(),updatedAt:stamp(),versions:[...w.versions,{version:v,createdAt:stamp(),note:'发布最新审批配置',nodes:clone(w.nodes),edges:clone(w.edges)}]};}),toast:'流程发布成功'})),
create:()=>{const id='wf-'+Date.now();mutate(get,set,s=>({workflows:[{id,name:'未命名流程',domain:'财务',status:'draft',version:0,editor:get().currentUser,updatedAt:stamp(),abnormalCount:0,nodes:[],edges:[],versions:[]},...s.workflows],currentId:id}));return id},
copy:id=>mutate(get,set,s=>{const w=s.workflows.find(x=>x.id===id)!;return{workflows:[{...clone(w),id:'wf-'+Date.now(),name:w.name+'（副本）',status:'draft'},...s.workflows]}}),
archive:id=>mutate(get,set,s=>({workflows:s.workflows.map(w=>w.id===id?{...w,status:'archived',updatedAt:stamp()}:w)})),
restore:v=>mutate(get,set,s=>({workflows:s.workflows.map(w=>{if(w.id!==s.currentId)return w;const old=w.versions.find(x=>x.version===v)!;return{...w,status:'draft',nodes:clone(old.nodes),edges:clone(old.edges),updatedAt:stamp()}}),toast:`已恢复 v${v} 为草稿`})),
clearToast:()=>set({toast:''})}));

/** 变更统一入口：更新业务数据 + 提升相关修订号 + 广播 + 索引失效重算 */
function mutate(get:()=>State,set:(p:Partial<State>)=>void,fn:(s:State)=>Partial<State>){
  const before=get();
  const next=fn(before);
  const revs=bump(before.revs,changedKeys(before,next));
  set({...next,revs});
  const after=get();
  engine.bind({...pickDeps(after)});
  engine.invalidateRevs(changedKeys(before,next));
  persist(after);
  sync({workflows:after.workflows,instances:after.instances,revs});
}
function changedKeys(before:State,next:Partial<State>):string[]{
  if(!next.workflows)return [];
  const keys:string[]=[];
  const nextById=new Map(next.workflows.map(w=>[w.id,w]));
  for(const w of next.workflows){
    const old=before.workflows.find(x=>x.id===w.id);
    if(!old){keys.push(wfKey(w.id),...w.versions.map(v=>verKey(w.id,v.version)));continue;}
    if(JSON.stringify(old)!==JSON.stringify(w))keys.push(...wfDepKeys(w,before.instances));
  }
  for(const w of before.workflows)if(!nextById.has(w.id))keys.push(wfKey(w.id),...w.versions.map(v=>verKey(w.id,v.version)),...before.instances.filter(i=>i.workflowId===w.id).map(i=>insKey(i.id)));
  return [...new Set(keys)];
}
function persist(s:State){localStorage.setItem(STORE_STATE_KEY,JSON.stringify({workflows:s.workflows,instances:s.instances,revs:s.revs}));}
function sync(p:{workflows?:Workflow[];instances?:Instance[];revs?:Record<string,number>}){bc?.postMessage({tab,p});}
const pickDeps=(s:State)=>({workflows:s.workflows,instances:s.instances,revs:s.revs,currentUser:s.currentUser});

bc?.addEventListener('message',(e)=>{
  const msg=e.data as{tab?:string;p?:any};
  if(!msg||msg.tab===tab)return;
  useAppStore.getState().__ingest(msg.p);
});

// 启动时绑定引擎；构建/迁移决策由 main 引导（需先执行旧版数据播种）
engine.bind(pickDeps(useAppStore.getState()));

export {engine};
