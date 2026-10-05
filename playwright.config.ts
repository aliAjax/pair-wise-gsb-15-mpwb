import {defineConfig,devices} from '@playwright/test';
declare const process:{env:Record<string,string|undefined>,platform:string};
// 受限沙箱（无 root 安装 Chromium 系统依赖）下，把本地解压的库目录加入搜索路径；
// 目录不存在时动态链接器自动忽略，正常开发机不受影响
const localLibs=process.platform==='linux'?['/tmp/rootfs/rootfs/usr/lib/aarch64-linux-gnu','/tmp/rootfs/rootfs/lib/aarch64-linux-gnu']:[];
const ld=[...localLibs,process.env.LD_LIBRARY_PATH??''].filter(Boolean).join(':');
const env={...process.env,...(ld?{LD_LIBRARY_PATH:ld}:{})};
export default defineConfig({testDir:'./tests',fullyParallel:false,timeout:30_000,expect:{timeout:8000},use:{baseURL:'http://127.0.0.1:4173',trace:'on-first-retry',screenshot:'only-on-failure',viewport:{width:1440,height:1000},launchOptions:{args:['--no-sandbox','--disable-setuid-sandbox'],env}},webServer:{command:'npm run dev -- --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:true,env},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
