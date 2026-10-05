import type {Instance,Workflow} from '../types';

export interface Person {name:string;role:string}

/** 8 个用户的角色分配：管理员一人，其余按业务域授权 */
export const PEOPLE:Person[]=[
  {name:'林秋',role:'系统管理员'},
  {name:'陈默',role:'采购专员'},
  {name:'方可',role:'采购专员'},
  {name:'周礼',role:'部门负责人'},
  {name:'赵安',role:'财务审批人'},
  {name:'王宁',role:'HRBP'},
  {name:'苏菲',role:'法务经理'},
  {name:'陆远',role:'部门负责人'},
];

/** 角色可访问的业务域；系统管理员在解析时直接放行 */
const ROLE_DOMAINS:Record<string,string[]>={
  系统管理员:['财务','采购','人力资源','IT服务','IT 服务','法务'],
  采购专员:['采购'],
  部门负责人:['财务','IT服务','IT 服务'],
  财务审批人:['财务'],
  HRBP:['人力资源'],
  法务经理:['法务'],
};

export const DEFAULT_USER='林秋';

export function getPerson(name:string):Person{
  return PEOPLE.find(p=>p.name===name)??{name,role:'未分配角色'};
}
export function isAdmin(p:Person):boolean{return p.role==='系统管理员';}
export function roleDomains(role:string):string[]{return ROLE_DOMAINS[role]??[];}

export type Access='allow'|'deny'|'unknown';

/** 流程可见性：管理员 / 编辑人 / 业务域命中 */
export function workflowAccess(p:Person,w:Workflow):Access{
  if(isAdmin(p))return 'allow';
  if(w.editor===p.name)return 'allow';
  if(roleDomains(p.role).includes(w.domain))return 'allow';
  return 'deny';
}

/** 实例可见性：申请人本人；否则跟随所属流程。找不到流程则无法判断 */
export function instanceAccess(p:Person,i:Instance,w?:Workflow):Access{
  if(isAdmin(p))return 'allow';
  if(i.applicant===p.name)return 'allow';
  if(!w)return 'unknown';
  return workflowAccess(p,w);
}
