export type EntryType='workflow'|'instance'|'version';

/** 一条可检索索引条目（只保留检索所需的扁平信息，不冗余节点图） */
export interface SearchEntry {
  key:string;              // wf:<id> / ins:<id> / ver:<wfId>:<version>
  type:EntryType;
  refId:string;            // 实例 id / 流程 id
  workflowId:string;
  version?:number;
  title:string;
  subtitle:string;
  keywords:string;         // 已归一化的检索原文
  url:string;              // 选中后打开的原对象地址
  updatedAt:string;        // 业务内容更新时间
  indexedAt:number;        // 索引写入时间（epoch ms）
  rev:number;              // 构建该条目时的修订号
  salt:number;             // 同修订号写入时的决胜序号（跨窗口并发）
  origin:string;           // 写入该条目的窗口标识
}

export interface QuarantinedItem {
  key:string;
  type:EntryType;
  title:string;
  reason:'acl-unknown';    // 无法判断权限
  source:'legacy'|'runtime';
  at:number;
}

export interface BuildCheckpoint {
  buildId:string;
  phase:'full'|'rebuild';
  prune:boolean;           // 全量完成后是否清理不在本轮清单内的旧条目
  total:number;
  list:string[];           // 本轮待处理键
  done:string[];           // 已完成键（检查点）
  at:number;
}

export interface IndexState {
  entries:Record<string,SearchEntry>;
  indexedAt:number|null;   // 索引最近更新时间
  stale:string[];          // 待重建队列
  building:BuildCheckpoint|null;
  quarantined:QuarantinedItem[];
  upgradedFrom?:string;
  lastError?:string;
  remoteProgress?:BuildCheckpoint|null;
}
