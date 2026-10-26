const { app, BrowserWindow, shell, ipcMain, screen, clipboard } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let compactMode = false;
let directFillMode = false;
let normalBounds = null;
let normalWasMaximized = false;
let automationMode = false;
let automationBounds = null;

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function setDirectFillMode(nextDirectFill) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  directFillMode = Boolean(nextDirectFill && compactMode && process.platform === 'win32');
  sendToWindow('window:direct-fill-state', directFillMode);
  return directFillMode;
}

function pasteHelperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'paste-helper.exe')
    : path.join(__dirname, 'paste-helper.exe');
}

function runPasteHelper(args = [], timeout = 3000) {
  return new Promise((resolve, reject) => {
    execFile(pasteHelperPath(), args.map(String), { windowsHide: true, timeout }, error => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}

function runPowerShellInput(args = [], timeout = 5000) {
  const action = args[0] || 'paste';
  if (!['paste', 'click', 'click-paste'].includes(action)) return Promise.reject(new Error('unsupported-action'));
  const x = action === 'paste' ? 0 : Number(args[1]);
  const y = action === 'paste' ? 0 : Number(args[2]);
  if (action !== 'paste' && (!Number.isFinite(x) || !Number.isFinite(y))) return Promise.reject(new Error('invalid-point'));
  const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativePostInput { [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; } [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); [DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e); [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p); [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w,uint f); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr w); [DllImport("user32.dll", SetLastError=true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); public static void EnableDpi() { try { if(!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { try { SetProcessDPIAware(); } catch {} } } public static void FocusAt(int x,int y) { SetCursorPos(x,y); POINT p = new POINT { X=x, Y=y }; IntPtr w=WindowFromPoint(p); IntPtr r=w==IntPtr.Zero ? IntPtr.Zero : GetAncestor(w,2); if(r!=IntPtr.Zero) SetForegroundWindow(r); } }'
$action = '${action}'
[NativePostInput]::EnableDpi()
if ($action -ne 'paste') {
  [NativePostInput]::FocusAt(${Math.round(x)}, ${Math.round(y)})
  Start-Sleep -Milliseconds 700
  if (-not [NativePostInput]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})) { exit 11 }
  Start-Sleep -Milliseconds 120
  [NativePostInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 55
  [NativePostInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
if ($action -ne 'click') {
  Start-Sleep -Milliseconds 140
  [NativePostInput]::keybd_event(17,0,0,[UIntPtr]::Zero)
  [NativePostInput]::keybd_event(86,0,0,[UIntPtr]::Zero)
  [NativePostInput]::keybd_event(86,0,2,[UIntPtr]::Zero)
  [NativePostInput]::keybd_event(17,0,2,[UIntPtr]::Zero)
}
exit 0`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, timeout }, error => {
      if (error) reject(error);
      else resolve(true);
    });
  });
}

async function runNativeInput(args = []) {
  try {
    await runPasteHelper(args);
    return 'native-helper';
  } catch (primaryError) {
    try {
      await runPowerShellInput(args);
      return 'windows-compatibility';
    } catch (fallbackError) {
      const reason = fallbackError?.code === 'ENOENT'
        ? '找不到 Windows 兼容组件'
        : 'Windows 阻止了模拟输入；请让浏览器和本应用使用相同权限运行';
      const error = new Error(reason);
      error.primaryError = primaryError;
      error.fallbackError = fallbackError;
      throw error;
    }
  }
}

function interactWithPage(args) {
  return new Promise((resolve, reject) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.blur();
    setTimeout(() => runNativeInput(args).then(resolve, reject), 120);
  });
}

function invokeNamedControl(point, name) {
  return new Promise((resolve, reject) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.blur();
    setTimeout(async () => {
      try {
        await runPasteHelper(['invoke-at', point.x, point.y, name], 8000);
        resolve('accessibility-name');
      } catch (accessibilityError) {
        try {
          const engine = await runNativeInput(['click', point.x, point.y]);
          resolve(`${engine}-fallback`);
        } catch (clickError) {
          const error = new Error('没有找到网页按钮，坐标备用点击也失败');
          error.accessibilityError = accessibilityError;
          error.clickError = clickError;
          reject(error);
        }
      }
    }, 120);
  });
}

function pasteIntoActiveWindow() {
  return interactWithPage([]);
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function toNativePoint(point) {
  const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
  if (process.platform !== 'win32' || typeof screen.dipToScreenPoint !== 'function') return rounded;
  return screen.dipToScreenPoint(rounded);
}

function setAutomationMode(nextRunning) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = Boolean(nextRunning && process.platform === 'win32');
  if (next === automationMode) return automationMode;

  if (next) {
    automationBounds = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(automationBounds);
    const width = Math.min(390, workArea.width - 24);
    const height = Math.min(176, workArea.height - 24);
    mainWindow.setMinimumSize(340, 150);
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setBounds({
      x: workArea.x + 12,
      y: workArea.y + workArea.height - height - 12,
      width,
      height
    }, true);
  } else {
    mainWindow.setMinimumSize(compactMode ? 360 : 900, compactMode ? 460 : 650);
    if (automationBounds) mainWindow.setBounds(automationBounds, true);
    automationBounds = null;
  }

  automationMode = next;
  sendToWindow('window:automation-state', automationMode);
  return automationMode;
}

function captureCursorPoint(delayMs) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('window-unavailable'));
      return;
    }
    const waitMs = Math.min(7000, Math.max(1500, Number(delayMs) || 3000));
    mainWindow.hide();
    setTimeout(() => {
      try {
        const point = screen.getCursorScreenPoint();
        mainWindow.show();
        mainWindow.focus();
        resolve({ x: point.x, y: point.y });
      } catch (error) {
        if (!mainWindow.isDestroyed()) mainWindow.show();
        reject(error);
      }
    }, waitMs);
  });
}

function setCompactMode(nextCompact) {
  if (!mainWindow || mainWindow.isDestroyed()) return compactMode;
  const next = Boolean(nextCompact);
  if (next === compactMode) return compactMode;

  if (next) {
    normalBounds = mainWindow.getBounds();
    normalWasMaximized = mainWindow.isMaximized();
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (normalWasMaximized) mainWindow.unmaximize();
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    const { workArea } = screen.getDisplayMatching(normalBounds);
    const width = Math.min(430, workArea.width);
    let topClearance = Math.min(280, Math.max(180, Math.round(workArea.height * 0.26)));
    if (workArea.height - topClearance - 12 < 460) topClearance = Math.max(12, workArea.height - 472);
    const height = Math.min(820, workArea.height - topClearance - 12);
    mainWindow.setMinimumSize(360, 460);
    mainWindow.setResizable(true);
    mainWindow.setAlwaysOnTop(true, 'floating');
    const compactBounds = {
      x: workArea.x + workArea.width - width - 12,
      y: workArea.y + topClearance,
      width,
      height
    };
    mainWindow.setBounds(compactBounds, false);
    mainWindow.setSize(width, height, false);
    mainWindow.setPosition(compactBounds.x, compactBounds.y, false);
  } else {
    setAutomationMode(false);
    setDirectFillMode(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(900, 650);
    if (normalBounds) mainWindow.setBounds(normalBounds, true);
    if (normalWasMaximized) mainWindow.maximize();
    normalWasMaximized = false;
  }

  compactMode = next;
  sendToWindow('window:compact-state', compactMode);
  return compactMode;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f3f6fa',
    title: '帖子日程台',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    compactMode = false;
    directFillMode = false;
    automationMode = false;
    automationBounds = null;
    normalBounds = null;
    normalWasMaximized = false;
  });
}

ipcMain.handle('window:toggle-compact', () => setCompactMode(!compactMode));
ipcMain.handle('window:set-direct-fill', (_event, enabled) => setDirectFillMode(Boolean(enabled)));
ipcMain.handle('clipboard:write', (_event, text) => {
  clipboard.writeText(String(text));
  return true;
});
ipcMain.handle('clipboard:fill-active', async (_event, text) => {
  clipboard.writeText(String(text));
  if (!directFillMode) return { pasted: false, reason: 'direct-fill-off' };
  try {
    await pasteIntoActiveWindow();
    return { pasted: true };
  } catch (error) {
    return { pasted: false, reason: error?.message || 'paste-helper-failed' };
  }
});
ipcMain.handle('automation:capture-point', (_event, delayMs) => captureCursorPoint(delayMs));
ipcMain.handle('automation:set-running', (_event, running) => setAutomationMode(Boolean(running)));
ipcMain.handle('automation:click', async (_event, point) => {
  if (!validPoint(point)) return { clicked: false, reason: 'invalid-point' };
  try {
    const nativePoint = toNativePoint(point);
    const engine = await interactWithPage(['click', nativePoint.x, nativePoint.y]);
    return { clicked: true, engine };
  } catch (error) {
    return { clicked: false, reason: error?.message || 'click-helper-failed' };
  }
});
ipcMain.handle('automation:invoke', async (_event, point, name) => {
  if (!validPoint(point) || !String(name || '').trim()) return { invoked: false, reason: 'invalid-target' };
  try {
    const nativePoint = toNativePoint(point);
    const engine = await invokeNamedControl(nativePoint, String(name).trim());
    return { invoked: true, engine };
  } catch (error) {
    return { invoked: false, reason: error?.message || 'invoke-failed' };
  }
});
ipcMain.handle('automation:click-paste', async (_event, point, text) => {
  if (!validPoint(point)) return { pasted: false, reason: 'invalid-point' };
  clipboard.writeText(String(text));
  try {
    const nativePoint = toNativePoint(point);
    const engine = await interactWithPage(['click-paste', nativePoint.x, nativePoint.y]);
    return { pasted: true, engine };
  } catch (error) {
    return { pasted: false, reason: error?.message || 'paste-helper-failed' };
  }
});

app.whenReady().then(() => {
  createWindow();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
