import {test,expect,type Page} from '@playwright/test';

async function fresh(page:Page){
  await page.goto('/');
  await page.evaluate(()=>localStorage.clear());
  await page.reload();
}
async function idle(page:Page){
  await page.waitForFunction(async()=>await (window as any).searchEngine.whenIdle,undefined,{timeout:15000});
  await page.waitForTimeout(150);
}
async function openSearch(page:Page){
  await page.getByRole('button',{name:/搜索流程、实例或申请人/}).click();
  await expect(page.getByTestId('global-search-panel')).toBeVisible();
}

test.describe.serial('全局检索',()=>{

  test('旧版升级：保留可用索引、隔离无法判断权限的记录、从检查点补齐',async({page})=>{
    await fresh(page);
    // 首次启动迁移自 v1：保留 3 条可用记录（其中 v1 版本落后待重建），隔离 2 条
    await idle(page);
    await openSearch(page);
    // 保留的可用索引立即可搜
    await page.getByLabel('全局检索').fill('差旅');
    await expect(page.getByTestId('gs-hit-count')).toContainText('命中');
    // 升级标识与隔离数量
    await page.getByRole('button',{name:'索引状态'}).click();
    await expect(page.getByText(/由旧版 1\.4\.0 升级/)).toBeVisible();
    await expect(page.getByTestId('idx-quarantine-count')).toHaveText('2');
    // 全量补齐后：流程 12、实例 80、版本 24
    await expect(page.getByTestId('idx-count-wf')).toHaveText('12');
    await expect(page.getByTestId('idx-count-ins')).toHaveText('80');
    // 核验通过一条隔离记录 → 进入待重建，随后消失
    await page.getByTestId('quarantine-release').first().click();
    await expect(page.getByTestId('idx-quarantine-count')).toHaveText('1');
    await idle(page);
    await page.keyboard.press('Escape');
  });

  test('命中数与更新时间展示，选中结果直接打开原对象',async({page})=>{
    await page.goto('/');await idle(page);
    await openSearch(page);
    const input=page.getByLabel('全局检索');
    await input.fill('INS-2026-0003');
    await expect(page.getByTestId('gs-hit-count')).toContainText('命中 1 条');
    await page.locator('.gs-row').first().click();
    await expect(page).toHaveURL(/\/monitor\?instance=INS-2026-0003$/);
    await expect(page.getByTestId('instance-detail')).toBeVisible();

    await page.goto('/');
    await openSearch(page);
    await page.getByLabel('全局检索').fill('采购合同审批');
    const wfRow=page.locator('.gs-row',{has:page.locator('.gs-type.workflow')}).first();
    await expect(wfRow).toContainText('采购合同审批');
    await wfRow.click();
    await expect(page).toHaveURL(/\/workflows\/wf-2$/);
    await expect(page.getByTestId('flow-canvas')).toBeVisible();
  });

  test('内容更新后索引立即失效并按新内容重算',async({page})=>{
    await page.goto('/');await idle(page);
    // 打开一个结构完整的流程并发布新版本
    await page.goto('/workflows/wf-2');
    await page.getByTestId('publish-button').click();
    await expect(page.getByRole('status')).toContainText('发布成功');
    // 发布后新版本条目可被检索，且新的版本说明在索引中
    await page.getByRole('button',{name:/搜索流程/}).click();
    await page.waitForFunction(()=>!(window as any).searchEngine.state.stale.length);
    await page.getByLabel('全局检索').fill('发布最新审批配置');
    await expect(page.getByTestId('gs-hit-count')).toContainText('命中');
    await page.keyboard.press('Escape');
  });

  test('陈默看不到无权访问的流程和实例',async({page})=>{
    await page.goto('/');await idle(page);
    await page.getByTestId('user-switch').click();
    await page.locator('.user-pop').getByRole('button',{name:/陈默/}).click();
    await openSearch(page);
    // 财务流程 wf-1 对采购专员不可见
    await page.getByLabel('全局检索').fill('差旅费用审批');
    await expect(page.locator('.gs-row')).toHaveCount(0);
    await expect(page.getByText('没有匹配的结果')).toBeVisible();
    // 采购流程可见
    await page.getByLabel('全局检索').fill('采购合同审批');
    expect(await page.locator('.gs-row').count()).toBeGreaterThan(0);
    // 实例：申请人为陈默的可见（INS-2026-0002 申请人 users[1]=陈默）
    await page.getByLabel('全局检索').fill('INS-2026-0002');
    await expect(page.locator('.gs-row')).toHaveCount(1);
    // 财务域他人实例不可见：INS-2026-0001 申请人林秋、流程 wf-1 财务
    await page.getByLabel('全局检索').fill('INS-2026-0001');
    await expect(page.locator('.gs-row')).toHaveCount(0);
  });

  test('构建到一半失败后从检查点继续，不产生重复条目',async({page})=>{
    await page.goto('/');
    await idle(page);
    const before=await page.evaluate(()=>Object.keys((window as any).searchEngine.state.entries).length);
    await openSearch(page);
    // 注入中断：首批落盘前注入，使其在处理 20 项后停下
    await page.evaluate(()=>{(window as any).searchEngine.startFullBuild();(window as any).searchEngine.injectFailureAt(20);});
    await expect(page.getByTestId('gs-build-error')).toBeVisible({timeout:8000});
    await expect.poll(async()=>page.evaluate(()=>(window as any).searchEngine.state.building?.done.length)).toBe(20);
    // 恢复构建
    await page.getByRole('button',{name:'索引状态'}).click();
    await page.getByTestId('idx-resume').click();
    await idle(page);
    const after=await page.evaluate(()=>Object.keys((window as any).searchEngine.state.entries).length);
    expect(after).toBe(before); // 12+80+24=116，无重复
    await expect(page.getByTestId('idx-error'),{}).toHaveCount(0);
    await expect(page.getByTestId('idx-count-wf')).toHaveText('12');
  });

  test('两个窗口同时改同一记录：仅接收最新修订号写入，旧结果进入待重建',async({page,context})=>{
    await fresh(page);
    await idle(page);
    await page.goto('/workflows/wf-2');
    const winB=await context.newPage();
    await winB.goto('/workflows/wf-2');
    await idle(winB);

    // 窗口 A 先真实改一次（修订号更高，先写入）
    await page.getByRole('button',{name:'保存草稿'}).click();
    await page.waitForFunction(()=>!(window as any).searchEngine.state.stale.length);
    await page.waitForTimeout(300); // 等待跨窗口提交广播收敛
    const afterA=await page.evaluate(()=>(window as any).searchEngine.state.entries['wf:wf-2'].rev);

    // 模拟窗口 B 基于旧数据产出的迟到索引写入（低修订号）
    const staleRes=await winB.evaluate(()=>{
      const e=(window as any).searchEngine.state.entries['wf:wf-2'];
      const oldEntry={...e,rev:e.rev-1,salt:0,indexedAt:Date.now()-5000,title:'采购合同审批'};
      return (window as any).searchEngine.commit(oldEntry);
    });
    expect(staleRes).toBe('stale');
    // 旧结果未覆盖，键进入待重建
    await expect.poll(async()=>await winB.evaluate(()=>(window as any).searchEngine.state.stale.includes('wf:wf-2'))).toBeTruthy();
    const keptRev=await winB.evaluate(()=>(window as any).searchEngine.state.entries['wf:wf-2'].rev);
    expect(keptRev).toBe(afterA);

    // 窗口 B 用新数据重建后 CAS 成功
    await idle(winB);
    const finalRev=await winB.evaluate(()=>(window as any).searchEngine.state.entries['wf:wf-2'].rev);
    expect(finalRev).toBe(afterA);
  });
});
