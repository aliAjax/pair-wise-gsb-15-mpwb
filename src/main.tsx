import React from 'react';import ReactDOM from 'react-dom/client';
// 必须在 App/store/engine 初始化前完成首次启动的旧版数据播种
import {seedFirstBoot} from './search/bootstrap';
import {engine} from './search/engine';
import {useAppStore} from './store/useAppStore';
import {LEGACY_KEY} from './search/bootstrap';
import './styles.css';

seedFirstBoot();

const s=useAppStore.getState();
engine.bind({workflows:s.workflows,instances:s.instances,revs:s.revs,currentUser:s.currentUser});
const rawLegacy=localStorage.getItem(LEGACY_KEY);
if(rawLegacy){
  engine.migrateLegacy(rawLegacy);
  localStorage.removeItem(LEGACY_KEY);
}else if(engine.state.building){
  // 上次构建中断：从检查点自动继续
  engine.resume();
}else if(!Object.keys(engine.state.entries).length){
  engine.startFullBuild();
}
// 供双窗口/检查点自动化测试驱动
(window as any).searchEngine=engine;
(window as any).appStore=useAppStore;

import('./App').then(({default:App})=>{
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
});
