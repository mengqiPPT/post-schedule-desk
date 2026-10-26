import path from 'node:path';

const [, , portArgument, ...inputFiles] = process.argv;
const debugPort = Number(portArgument);
if (!Number.isInteger(debugPort) || debugPort < 1024) throw new Error('需要传入有效的测试端口');
if (inputFiles.length !== 3) throw new Error('需要传入三份 Markdown 文件');

const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page');
if (!page?.webSocketDebuggerUrl) throw new Error('未找到应用测试页面');

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  return result.result.value;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await send('DOM.enable');
await send('Runtime.enable');
console.error('CHECKPOINT connected');

await evaluate('localStorage.clear(); location.reload(); true');
await delay(1800);
console.error('CHECKPOINT reloaded');

const documentNode = await send('DOM.getDocument', { depth: 2 });
const query = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#fileInput' });
if (!query.nodeId) throw new Error('未找到文件选择控件');

await send('DOM.setFileInputFiles', {
  nodeId: query.nodeId,
  files: inputFiles.map(file => path.resolve(file))
});
await delay(4500);
console.error('CHECKPOINT imported');

const firstPass = await evaluate(`(() => {
  const saved = JSON.parse(localStorage.getItem('post-schedule-desk-v1'));
  return {
    libraries: saved?.libraries?.length || 0,
    counts: (saved?.libraries || []).map(item => item.posts.length),
    options: document.querySelectorAll('#courseSelect option').length,
    days: document.querySelectorAll('#dayList .day-button').length,
    cards: document.querySelectorAll('#postGrid .post-card').length,
    emptyHidden: document.querySelector('#emptyView').hidden,
    workspaceVisible: !document.querySelector('#workspace').hidden
  };
})()`);

if (firstPass.libraries !== 3) throw new Error(`课程保存数量错误：${firstPass.libraries}`);
if (firstPass.counts.some(count => count !== 1200)) throw new Error(`帖子数量错误：${firstPass.counts.join(',')}`);
if (firstPass.options !== 3 || firstPass.days !== 120 || firstPass.cards !== 10) throw new Error(`界面数量错误：${JSON.stringify(firstPass)}`);
if (!firstPass.emptyHidden || !firstPass.workspaceVisible) throw new Error('导入后界面状态错误');
console.error('CHECKPOINT import-verified');

await evaluate("document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 620); true");
await delay(300);
const clickTarget = await evaluate(`(() => {
  const rect = document.querySelectorAll('.copy-title')[4].getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, beforeY: window.scrollY };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickTarget.x, y: clickTarget.y, button: 'left', clickCount: 1 });
await delay(700);
const afterClickY = await evaluate('window.scrollY');
if (afterClickY !== clickTarget.beforeY) throw new Error(`点击复制导致页面滚动：${clickTarget.beforeY} -> ${afterClickY}`);
console.error('CHECKPOINT copy-verified');

await evaluate('location.reload(); true');
await delay(2200);

const persisted = await evaluate(`(() => ({
  libraries: JSON.parse(localStorage.getItem('post-schedule-desk-v1'))?.libraries?.length || 0,
  options: document.querySelectorAll('#courseSelect option').length,
  days: document.querySelectorAll('#dayList .day-button').length,
  cards: document.querySelectorAll('#postGrid .post-card').length
}))()`);

if (persisted.libraries !== 3 || persisted.options !== 3 || persisted.days !== 120 || persisted.cards !== 10) {
  throw new Error(`重新打开后的保存状态错误：${JSON.stringify(persisted)}`);
}
console.error('CHECKPOINT persistence-verified');

await evaluate(`(async () => {
  await window.postDesktop.toggleCompact();
  for (let attempt = 0; attempt < 20 && (!document.body.classList.contains('compact-app') || window.innerWidth > 450); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return true;
})()`);
const accessibilityProbe = await evaluate(`(() => {
  localStorage.removeItem('post-schedule-uia-probe');
  const button = document.createElement('button');
  button.id = 'uiaProbeButton';
  button.type = 'button';
  button.setAttribute('aria-label', '自动化测试按钮');
  button.textContent = '自动化测试按钮';
  button.style.cssText = 'position:fixed;left:78px;top:300px;width:220px;height:64px;z-index:99999;background:#fff;color:#000;';
  button.addEventListener('click', () => localStorage.setItem('post-schedule-uia-probe', 'clicked'));
  document.body.appendChild(button);
  const rect = button.getBoundingClientRect();
  return {
    x: Math.round(window.screenX + rect.left + rect.width / 2),
    y: Math.round(window.screenY + rect.top + rect.height / 2)
  };
})()`);
await delay(350);
const accessibilityResult = await evaluate(`window.postDesktop.invokeAutomationControl(${JSON.stringify(accessibilityProbe)}, '自动化测试按钮')`);
if (!accessibilityResult?.invoked) throw new Error(`按名称调用网页按钮返回失败：${JSON.stringify(accessibilityResult)}`);
await delay(500);
const accessibilityInvoked = await evaluate(`(() => {
  const invoked = localStorage.getItem('post-schedule-uia-probe') === 'clicked';
  document.querySelector('#uiaProbeButton')?.remove();
  localStorage.removeItem('post-schedule-uia-probe');
  return invoked;
})()`);
if (!accessibilityInvoked) throw new Error('按名称调用网页按钮失败');
await evaluate(`(async () => {
  await window.postDesktop.toggleCompact();
  for (let attempt = 0; attempt < 20 && document.body.classList.contains('compact-app'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return true;
})()`);
console.error('CHECKPOINT accessibility-button-verified');

const compact = await evaluate(`(async () => {
  if (!window.postDesktop) return { bridge: false };
  await window.postDesktop.toggleCompact();
  for (let attempt = 0; attempt < 20 && (!document.body.classList.contains('compact-app') || window.innerWidth > 450); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const before = {
    bridge: true,
    active: document.body.classList.contains('compact-app'),
    width: window.innerWidth,
    visibleCards: document.querySelectorAll('#postGrid .post-card.compact-active').length,
    position: document.querySelector('#compactPosition').textContent,
    toolbarVisible: !document.querySelector('#compactToolbar').hidden,
    dayToolbarVisible: !document.querySelector('#compactDayToolbar').hidden,
    dayPosition: document.querySelector('#compactDayPosition').textContent
  };
  before.automation = {
    launchVisible: getComputedStyle(document.querySelector('#automationLaunch')).display !== 'none',
    dialogExists: Boolean(document.querySelector('#automationDialog')),
    stopExists: Boolean(document.querySelector('#stopAutomationButton')),
    daysMax: Number(document.querySelector('#automationDays').max),
    intervalExists: Boolean(document.querySelector('#automationInterval')),
    bridge: ['captureAutomationPoint', 'setAutomationRunning', 'invokeAutomationControl', 'clickAutomationPoint', 'clickPasteAutomationPoint']
      .every(name => typeof window.postDesktop[name] === 'function')
  };
  document.querySelector('#compactNext').click();
  await new Promise(resolve => setTimeout(resolve, 150));
  before.nextPosition = document.querySelector('#compactPosition').textContent;
  document.querySelector('#compactNextDay').click();
  await new Promise(resolve => setTimeout(resolve, 150));
  before.nextDayPosition = document.querySelector('#compactDayPosition').textContent;
  document.querySelector('#compactPrevDay').click();
  await new Promise(resolve => setTimeout(resolve, 150));
  before.returnedDayPosition = document.querySelector('#compactDayPosition').textContent;
  await window.postDesktop.writeClipboard('帖子日程台-剪贴板测试');
  await window.postDesktop.toggleCompact();
  await new Promise(resolve => setTimeout(resolve, 500));
  before.exited = !document.body.classList.contains('compact-app');
  return before;
})()`);

if (!compact.bridge || !compact.active || compact.width > 450 || compact.visibleCards !== 1 || !compact.toolbarVisible || !compact.dayToolbarVisible || compact.position !== '1 / 10' || compact.nextPosition !== '2 / 10' || compact.dayPosition !== '第 1 / 120 天' || compact.nextDayPosition !== '第 2 / 120 天' || compact.returnedDayPosition !== '第 1 / 120 天' || !compact.exited || !compact.automation.launchVisible || !compact.automation.dialogExists || !compact.automation.stopExists || compact.automation.daysMax !== 120 || !compact.automation.intervalExists || !compact.automation.bridge) {
  throw new Error(`悬浮小窗状态错误：${JSON.stringify(compact)}`);
}
console.error('CHECKPOINT compact-verified');

const deleted = await evaluate(`(() => {
  window.confirm = () => true;
  document.querySelector('#deleteCourseButton').click();
  const saved = JSON.parse(localStorage.getItem('post-schedule-desk-v1'));
  return {
    libraries: saved?.libraries?.length || 0,
    options: document.querySelectorAll('#courseSelect option').length,
    activeExists: saved?.libraries?.some(item => item.id === saved.activeLibraryId) || false,
    cards: document.querySelectorAll('#postGrid .post-card').length
  };
})()`);

if (deleted.libraries !== 2 || deleted.options !== 2 || !deleted.activeExists || deleted.cards !== 10) {
  throw new Error(`删除课程后的状态错误：${JSON.stringify(deleted)}`);
}

await evaluate('location.reload(); true');
await delay(1800);
const deletionPersisted = await evaluate(`(() => ({
  libraries: JSON.parse(localStorage.getItem('post-schedule-desk-v1'))?.libraries?.length || 0,
  options: document.querySelectorAll('#courseSelect option').length
}))()`);
if (deletionPersisted.libraries !== 2 || deletionPersisted.options !== 2) {
  throw new Error(`删除课程后重新打开的状态错误：${JSON.stringify(deletionPersisted)}`);
}

console.log(JSON.stringify({ import: firstPass, scrollStability: { before: clickTarget.beforeY, after: afterClickY }, persisted, accessibilityButton: accessibilityInvoked, compact, deleted, deletionPersisted, result: 'PASS' }, null, 2));
socket.close();
