// 模拟旧版本（schema v1）遗留的索引快照：首次启动且本地无 v2 快照时作为“升级前数据”参与迁移。
// 覆盖四种迁移路径：可保留、内容过期需重建、源记录已删除、缺少权限信息需隔离。
export const legacySnapshotV1={
  schemaVersion:1,
  updatedAt:'2026-07-09T18:00:00.000Z',
  docs:[
    {id:'wf:wf-1',kind:'workflow',title:'差旅费用审批',subtitle:'财务 · 已发布',body:'差旅费用审批 财务',acl:null,route:'/workflows/wf-1',revision:1,indexedAt:'2026-07-09T18:00:00.000Z'},
    {id:'wf:wf-2',kind:'workflow',title:'采购合同审批',subtitle:'采购',body:'采购合同审批 采购',acl:null,route:'/workflows/wf-2',revision:0,indexedAt:'2026-07-09T18:00:00.000Z'},
    {id:'wf:wf-99',kind:'workflow',title:'已下线的旧流程',subtitle:'财务',body:'已下线的旧流程',acl:null,route:'/workflows/wf-99',revision:1,indexedAt:'2026-07-09T18:00:00.000Z'},
    {id:'ins:INS-2026-0080',kind:'instance',title:'INS-2026-0080',subtitle:'历史实例',body:'INS-2026-0080',route:'/monitor?instance=INS-2026-0080',revision:1,indexedAt:'2026-07-09T18:00:00.000Z'},
  ],
  revisions:{'wf:wf-1':1,'wf:wf-2':0,'wf:wf-99':1,'ins:INS-2026-0080':1},
  quarantine:[],
  checkpoint:null,
};
