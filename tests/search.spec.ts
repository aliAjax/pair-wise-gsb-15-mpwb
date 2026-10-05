import {test,expect,type Page} from '@playwright/test';

const ready=(page:Page)=>page.waitForFunction(()=>(window as any).__search?.status().ready);
const status=(page:Page)=>page.evaluate(()=>(window as any).__search.status());

test.describe.serial('全局检索',()=>{
 test('搜索流程显示命中数与更新时间，选中直接打开编辑器',async({page})=>{
  await page.goto('/');await ready(page);
  await page.getByTestId('global-search-input').fill('差旅费用审批');
  await expect(page.getByTestId('search-hit-count')).toContainText('命中');
  await expect(page.getByTestId('search-updated-at')).toContainText('索引更新于');
  await expect(page.getByTestId('search-index-status')).toContainText('索引');
  await page.locator('[data-kind="workflow"]').first().click();
  await expect(page).toHaveURL(/\/workflows\/wf-1$/);
  await expect(page.getByTestId('flow-canvas')).toBeVisible();
 });
 test('搜索实例并直接打开监控详情',async({page})=>{
  await page.goto('/');await ready(page);
  await page.getByTestId('global-search-input').fill('INS-2026-0001');
  await page.locator('[data-kind="instance"]').first().click();
  await expect(page).toHaveURL(/instance=INS-2026-0001/);
  await expect(page.getByTestId('instance-detail')).toBeVisible();
  await expect(page.getByTestId('execution-timeline')).toContainText('提交申请');
 });
 test('搜索版本说明并直接打开版本历史',async({page})=>{
  await page.goto('/');await ready(page);
  await page.getByTestId('global-search-input').fill('增加金额分支与通知节点');
  await page.locator('[data-kind="version"]').first().click();
  await expect(page).toHaveURL(/\/workflows\/wf-\d+\/versions/);
  await expect(page.getByTestId('version-compare')).toBeVisible();
 });
 test('流程更新后索引立即失效并按新内容重算',async({page})=>{
  await page.goto('/');await ready(page);
  await page.getByTestId('global-search-input').fill('固定角色');
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 0 条');
  await page.goto('/workflows/wf-1');
  await page.getByTestId('canvas-node-approval').click();
  await page.getByLabel('审批人来源').selectOption({label:'固定角色'});
  await page.getByTestId('save-node-config').click();
  await page.getByRole('button',{name:'保存草稿'}).click();
  await page.getByTestId('global-search-input').fill('固定角色');
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 1 条');
  await expect(page.locator('[data-kind="workflow"]')).toContainText('差旅费用审批');
 });
 test('发布产生的新版本立即进入索引',async({page})=>{
  await page.goto('/workflows/wf-2');await ready(page);
  await page.getByTestId('publish-button').click();
  await expect(page.getByRole('status')).toContainText('发布成功');
  await page.getByTestId('global-search-input').fill('发布最新审批配置');
  await expect(page.locator('[data-kind="version"]')).toHaveCount(1);
  await expect(page.locator('[data-kind="version"]')).toContainText('v3');
 });
 test('陈默看不到自己无权访问的流程和实例',async({page})=>{
  await page.goto('/');await ready(page);
  await page.getByTestId('global-search-input').fill('法务审查');
  await expect(page.locator('[data-kind="workflow"]')).toHaveCount(1);
  await page.getByLabel('当前身份').selectOption('陈默');
  await page.getByTestId('global-search-input').click();
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 0 条');
  await page.getByTestId('global-search-input').fill('INS-2026-0009');
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 0 条');
  await page.getByTestId('global-search-input').fill('差旅费用审批');
  await expect(page.getByTestId('search-hit-count')).not.toContainText('命中 0 条');
 });
 test('只接收最新修订号的索引写入，后到的旧结果进入待重建',async({page})=>{
  await page.goto('/');await ready(page);
  const before=await status(page);
  const r=await page.evaluate(()=>(window as any).__search.applyStaleWrite('wf:wf-1','过期标题XYZ'));
  expect(r).toBe('stale');
  const mid=await status(page);
  expect(mid.pending).toBe(before.pending+1);
  await page.getByTestId('global-search-input').fill('过期标题XYZ');
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 0 条');
  await page.getByTestId('global-search-input').fill('差旅费用审批');
  await expect(page.locator('[data-kind="workflow"]')).toHaveCount(1);
  await page.evaluate(()=>(window as any).__search.drain());
  const after=await status(page);
  expect(after.pending).toBe(0);
  expect(after.docCount).toBe(mid.docCount);
 });
 test('构建中断后从检查点恢复，重复扫描不产生重复条目',async({page})=>{
  await page.goto('/');await ready(page);
  const s0=await status(page);
  const expected=s0.sourceCount-s0.quarantined;
  await page.evaluate(()=>{(window as any).__search.failNextBuildAt(60);return (window as any).__search.rebuildAll(true)});
  const mid=await status(page);
  expect(mid.checkpoint).toBeTruthy();
  expect(mid.checkpoint.cursor).toBe(50); // 批次 25：失败于 60，检查点停留在上一完成批次
  expect(mid.docCount).toBe(60);
  await page.reload();await ready(page);
  const done=await status(page);
  expect(done.resumedFrom).toBe(50);
  expect(done.checkpoint).toBeNull();
  expect(done.docCount).toBe(expected);
  await page.evaluate(()=>(window as any).__search.rebuildAll(false));
  const again=await status(page);
  expect(again.docCount).toBe(expected);
 });
 test('旧数据升级保留可用索引，无法判断权限的记录隔离待核',async({page})=>{
  await page.goto('/');await ready(page);
  const s=await status(page);
  expect(s.migration).toBeTruthy();
  expect(s.migration.kept).toBeGreaterThan(0);
  expect(s.migration.quarantined).toBeGreaterThan(0);
  expect(s.migration.dropped).toBeGreaterThan(0);
  await page.getByTestId('global-search-input').fill('INS-2026-0080');
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 0 条');
  await expect(page.getByTestId('search-results')).toContainText('已升级旧索引');
  await expect(page.getByTestId('quarantine-review')).toContainText('隔离待核 1');
  await page.getByTestId('quarantine-review').click();
  await expect(page.getByTestId('search-hit-count')).toContainText('命中 1 条');
  await page.locator('[data-kind="instance"]').first().click();
  await expect(page).toHaveURL(/instance=INS-2026-0080/);
  await expect(page.getByTestId('instance-detail')).toBeVisible();
 });
});
