import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(desktopDir);
const html = fs.readFileSync(path.join(projectDir, 'dist', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(projectDir, 'dist', 'app-v2.js'), 'utf8');
const main = fs.readFileSync(path.join(desktopDir, 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(desktopDir, 'preload.cjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ids = Array.from(html.matchAll(/id="([^"]+)"/g), match => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicateIds.length === 0, `HTML 存在重复 id：${Array.from(new Set(duplicateIds)).join('、')}`);

const idReferences = Array.from(renderer.matchAll(/getElementById\('([^']+)'\)/g), match => match[1]);
const missingIds = Array.from(new Set(idReferences.filter(id => !ids.includes(id))));
assert(missingIds.length === 0, `脚本引用了不存在的元素：${missingIds.join('、')}`);

const requiredAutomationIds = [
  'automationLaunch',
  'automationDialog',
  'automationDays',
  'automationInterval',
  'automationSpeed',
  'automationReady',
  'testAutomationButton',
  'startAutomationButton',
  'automationHud',
  'stopAutomationButton',
  'compactPrevDay',
  'compactNextDay',
  'compactDayPosition'
];
for (const id of requiredAutomationIds) assert(ids.includes(id), `缺少自动发布元素：${id}`);

const requiredChannels = [
  'automation:capture-point',
  'automation:set-running',
  'automation:invoke',
  'automation:click',
  'automation:click-paste'
];
for (const channel of requiredChannels) assert(main.includes(channel), `主进程缺少通信通道：${channel}`);

const requiredBridgeMethods = [
  'captureAutomationPoint',
  'setAutomationRunning',
  'invokeAutomationControl',
  'clickAutomationPoint',
  'clickPasteAutomationPoint'
];
for (const method of requiredBridgeMethods) assert(preload.includes(method), `预加载桥接缺少方法：${method}`);

assert(main.includes('runPowerShellInput'), '主进程缺少 Windows 兼容点击通道');
assert(main.includes('dipToScreenPoint'), '主进程缺少 Windows 显示缩放坐标换算');

assert(packageJson.version === '1.7.0', `版本号应为 1.7.0，当前为 ${packageJson.version}`);
assert(html.includes('app-v2.js?v=1.7.0'), '页面脚本缓存版本没有更新到 1.7.0');
assert(!html.includes('id="automationDays" type="number" min="1" max="10"'), '连续发布天数仍被限制为10');
assert(fs.existsSync(path.join(desktopDir, 'paste-helper.exe')), '缺少 paste-helper.exe');

console.log(JSON.stringify({
  result: 'PASS',
  version: packageJson.version,
  htmlIds: ids.length,
  rendererReferences: idReferences.length,
  automationElements: requiredAutomationIds.length,
  automationChannels: requiredChannels.length,
  bridgeMethods: requiredBridgeMethods.length
}, null, 2));
