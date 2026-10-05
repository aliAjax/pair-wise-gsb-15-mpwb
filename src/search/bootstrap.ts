import {workflows as seedWorkflows} from '../../mock-data/workflows';
import {instances as seedInstances} from '../../mock-data/instances';
import type {SearchEntry} from './types';
import {wfDepKeys} from './engine';

const BOOT_KEY='flowdesk:boot:v2';
export const LEGACY_KEY='flowdesk:index:v1';
export const STORE_STATE_KEY='flowdesk:store:v2';
const INDEX_KEY='flowdesk:index:v2';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));

const legacyEntry=(e:Partial<SearchEntry>&Pick<SearchEntry,'key'|'type'|'title'>):SearchEntry=>({
  refId:e.key!.split(':')[1]??'',workflowId:'wf-1',subtitle:'',keywords:'',url:'/',updatedAt:'2017-09-01 09:00',
  indexedAt:1504245600000,rev:1,salt:0,origin:'legacy',...e,
});

/** v1 旧版索引快照：三条可用记录 + 两条无法判断权限的残留 */
function legacyFixture():string{
  const entries=[
    legacyEntry({key:'wf:wf-1',type:'workflow',refId:'wf-1',workflowId:'wf-1',title:'差旅费用审批',
      subtitle:'流程 · 财务 · 林秋 · v1',keywords:'差旅费用审批 财务 林秋 v1',url:'/workflows/wf-1',updatedAt:'2026-06-12 10:00',rev:1}),
    legacyEntry({key:'ins:INS-2026-0001',type:'instance',refId:'INS-2026-0001',workflowId:'wf-1',title:'INS-2026-0001',
      subtitle:'实例 · 林秋 · 差旅费用审批 · abnormal',keywords:'ins-2026-0001 林秋 差旅费用审批 财务 异常',url:'/monitor?instance=INS-2026-0001',updatedAt:'2026-07-10 08:10',rev:1}),
    // 修订号落后于当前数据：升级后保留展示，并入待重建
    legacyEntry({key:'ver:wf-1:1',type:'version',refId:'wf-1',workflowId:'wf-1',version:1,title:'差旅费用审批 · v1',
      subtitle:'版本 · 初始化流程结构 · 2026-06-12 10:00',keywords:'差旅费用审批 v1 初始化流程结构',url:'/workflows/wf-1/versions',rev:0}),
    // 源记录已随旧库删除：权限无法判断 → 隔离待核
    legacyEntry({key:'wf:wf-legacy-2015',type:'workflow',refId:'wf-legacy-2015',workflowId:'wf-legacy-2015',
      title:'2015 离线报销流程（旧版残留）',subtitle:'流程 · 来源不明',keywords:'2015 离线报销 旧版',updatedAt:'2015-11-03 14:00',rev:0}),
    legacyEntry({key:'ins:INS-2017-0042',type:'instance',refId:'INS-2017-0042',workflowId:'wf-legacy-2015',
      title:'历史挂起实例 INS-2017-0042',subtitle:'实例 · 归属流程已不存在',keywords:'ins-2017-0042 历史 挂起',updatedAt:'2017-09-01 09:00',rev:0}),
  ];
  return JSON.stringify({version:'1.4.0',exportedAt:'2025-12-18',entries});
}

function seedRevs():Record<string,number>{
  const revs:Record<string,number>={};
  for(const w of seedWorkflows)for(const k of wfDepKeys(w,seedInstances))revs[k]=1;
  return revs;
}

/** 首次启动：写入与旧版共存的业务数据快照和 v1 索引，供升级流程演示 */
export function seedFirstBoot(){
  if(localStorage.getItem(BOOT_KEY))return;
  if(!localStorage.getItem(STORE_STATE_KEY))
    localStorage.setItem(STORE_STATE_KEY,JSON.stringify({workflows:clone(seedWorkflows),instances:seedInstances,revs:seedRevs()}));
  localStorage.setItem(LEGACY_KEY,legacyFixture());
  localStorage.setItem(BOOT_KEY,'1');
}

/** 演示/测试：回到“旧版待升级”状态，刷新后重新执行迁移 */
export function resetForLegacyUpgrade(){
  localStorage.removeItem(INDEX_KEY);
  localStorage.removeItem(BOOT_KEY);
}
