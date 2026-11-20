const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// ── Win32 FFI (Windows only) ────────────────────────────────────────────────
let keybd_event, VkKeyScanA;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');
    VkKeyScanA = user32.func('int16_t __stdcall VkKeyScanA(int ch)');
  } catch (e) {
    console.warn('koffi not available – macro sending disabled', e.message);
  }
}

// ── Globals ─────────────────────────────────────────────────────────────────
let tray, overlay;
let overlayReady = false;
let spawnQueued = false;

const VK_CONTROL = 0x11;
const VK_RETURN  = 0x0D;
const VK_C       = 0x43;
const VK_MENU    = 0x12; // Alt
const VK_TAB     = 0x09;
const KEYUP      = 0x0002;

/** One Alt+Tab / Cmd+Tab so focus returns to the previously active app after tray click. */
function refocusPreviousApp() {
  const delayMs = 80;
  const run = () => {
    if (process.platform === 'win32') {
      if (!keybd_event) return;
      keybd_event(VK_MENU, 0, 0, 0);
      keybd_event(VK_TAB, 0, 0, 0);
      keybd_event(VK_TAB, 0, KEYUP, 0);
      keybd_event(VK_MENU, 0, KEYUP, 0);
    } else if (process.platform === 'darwin') {
      const script = [
        'tell application "System Events"',
        '  key down command',
        '  key code 48', // Tab
        '  key up command',
        'end tell',
      ].join('\n');
      execFile('osascript', ['-e', script], err => {
        if (err) {
          console.warn('refocus previous app (Cmd+Tab) failed:', err.message);
        }
      });
    } else if (process.platform === 'linux') {
      execFile('xdotool', ['key', '--clearmodifiers', 'alt+Tab'], err => {
        if (err) {
          console.warn('refocus previous app (Alt+Tab) failed. Install xdotool:', err.message);
        }
      });
    }
  };
  setTimeout(run, delayMs);
}

function createTrayIconFallback() {
  const p = path.join(__dirname, 'icon', 'Template.png');
  if (fs.existsSync(p)) {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) {
      if (process.platform !== 'darwin') return img;
      // Small, single-colour menu bar icon that follows light/dark mode, like the other icons up there.
      const small = img.resize({ width: 18, height: 18, quality: 'best' });
      small.setTemplateImage(true);
      return small;
    }
  }
  console.warn('openwhip: icon/Template.png missing or invalid');
  return nativeImage.createEmpty();
}

async function tryIcnsTrayImage(icnsPath) {
  const size = { width: 64, height: 64 };
  const thumb = await nativeImage.createThumbnailFromPath(icnsPath, size);
  if (!thumb.isEmpty()) return thumb;
  return null;
}

// macOS: createFromPath does not decode .icns (Electron only loads PNG/JPEG there, ICO on Windows).
// Quick Look thumbnails handle .icns; copy to temp if the file is inside ASAR (QL needs a real path).
async function getTrayIcon() {
  const iconDir = path.join(__dirname, 'icon');
  if (process.platform === 'win32') {
    const file = path.join(iconDir, 'icon.ico');
    if (fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) return img;
    }
    return createTrayIconFallback();
  }
  if (process.platform === 'darwin') {
    const small = createTrayIconFallback();
    if (!small.isEmpty()) return small;
    const file = path.join(iconDir, 'AppIcon.icns');
    if (fs.existsSync(file)) {
      const fromPath = nativeImage.createFromPath(file);
      if (!fromPath.isEmpty()) return fromPath;
      try {
        const t = await tryIcnsTrayImage(file);
        if (t) return t;
      } catch (e) {
        console.warn('AppIcon.icns Quick Look thumbnail failed:', e?.message || e);
      }
      const tmp = path.join(os.tmpdir(), 'openwhip-tray.icns');
      try {
        fs.copyFileSync(file, tmp);
        const t = await tryIcnsTrayImage(tmp);
        if (t) return t;
      } catch (e) {
        console.warn('AppIcon.icns temp copy + thumbnail failed:', e?.message || e);
      }
    }
    return createTrayIconFallback();
  }
  return createTrayIconFallback();
}

// ── Overlay window ──────────────────────────────────────────────────────────
function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlayReady = false;
  overlay.loadFile('overlay.html');
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (spawnQueued && overlay && overlay.isVisible()) {
      spawnQueued = false;
      overlay.webContents.send('spawn-whip');
      refocusPreviousApp();
    }
  });
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    spawnQueued = false;
  });
}

function toggleOverlay() {
  if (overlay && overlay.isVisible()) {
    overlay.webContents.send('drop-whip');
    return;
  }
  if (!overlay) createOverlay();
  overlay.show();
  if (overlayReady) {
    overlay.webContents.send('spawn-whip');
    refocusPreviousApp();
  } else {
    spawnQueued = true;
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.on('whip-crack', () => {
  try {
    sendMacro();
  } catch (err) {
    console.warn('sendMacro failed:', err?.message || err);
  }
});
ipcMain.on('hide-overlay', () => {
  if (overlay) { overlay.setIgnoreMouseEvents(false); overlay.hide(); }
});

// ── Stick-figure stage (click-through, cosmetic only) ───────────────────────
let stage = null, stageReady = false, pendingScenes = [];
const settings = { onlyClaude: true, sound: true, bubbles: true, random: false, speed: 1 };
function createStage() {
  const { bounds } = screen.getPrimaryDisplay();
  stage = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    transparent: true, frame: false, alwaysOnTop: true, focusable: false,
    skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  stage.setAlwaysOnTop(true, 'screen-saver');
  stage.setIgnoreMouseEvents(true);
  stage.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  stageReady = false;
  stage.loadFile('stick.html');
  stage.webContents.on('did-finish-load', () => {
    stageReady = true;
    pendingScenes.forEach(p => stage.webContents.send('scene', p));
    pendingScenes = [];
  });
  stage.on('closed', () => { stage = null; stageReady = false; stageShown = false; });
}
function sendScene(type, elapsed) {
  if (type === 'stop') { if (stage && stageReady) stage.webContents.send('scene', { type: 'stop', opts: { ...settings } }); return; }
  if (!stage) createStage();
  sceneRunning = true;
  updateStage();
  const payload = { type, elapsed, opts: { ...settings } };
  if (stageReady) stage.webContents.send('scene', payload); else pendingScenes.push(payload);
}
let sceneRunning = false, claudeFront = false, stageShown = false;
function updateStage() {
  const want = sceneRunning && (claudeFront || !settings.onlyClaude);
  if (!stage) return;
  if (want && !stageShown) { stage.showInactive(); stageShown = true; if (stageReady) stage.webContents.send('stage-visible', true); }
  else if (!want && stageShown) { if (stageReady) stage.webContents.send('stage-visible', false); stage.hide(); stageShown = false; }
}
ipcMain.on('scene-done', () => { sceneRunning = false; updateStage(); });
// Only show over Claude: poll which app is in front.
let lastBounds = '';
const FRONT_SCRIPT = `tell application "System Events"
  set fp to first application process whose frontmost is true
  set n to name of fp
  if n is "Claude" then
    try
      set {px, py} to position of window 1 of fp
      set {sx, sy} to size of window 1 of fp
      return n & "|" & px & "|" & py & "|" & sx & "|" & sy
    end try
  end if
  return n
end tell`;
function pollFront() {
  execFile('osascript', ['-e', FRONT_SCRIPT], (err, out) => {
    if (err) return;
    const parts = String(out).trim().split('|');
    claudeFront = /^claude$/i.test(parts[0]);
    if (claudeFront && parts.length === 5 && stage && stageReady) {
      const key = parts.slice(1).join('|');
      if (key !== lastBounds) {
        lastBounds = key;
        const [x, y, w, h] = parts.slice(1).map(Number);
        stage.webContents.send('claude-bounds', { x, y, w, h });
      }
    }
    updateStage();
  });
}
setInterval(pollFront, 700);

// ── Auto whip: a Claude Code hook touches ~/.badclaude/whip when Claude is slow ──
function autoWhip() {
  sendScene('auto');
}
const triggerDir = path.join(os.homedir(), '.badclaude');
fs.mkdirSync(triggerDir, { recursive: true });
const triggerFile = path.join(triggerDir, 'whip');
fs.writeFileSync(triggerFile, '');
let lastTrig = 0;
fs.watch(triggerDir, (_e, name) => {
  if (name !== 'whip') return;
  let txt = '';
  try { txt = fs.readFileSync(triggerFile, 'utf8').trim(); } catch (e) { return; }
  if (txt === 'stop') { sendScene('stop'); return; }
  const n = parseInt(txt, 10);
  if (!(n >= 0)) return;
  const now = Date.now();
  if (now - lastTrig < 1500) return;
  lastTrig = now;
  sendScene('auto', n);
});

// ── Macro: immediate Ctrl+C, type "Go FASER", Enter ───────────────────────
function sendMacro() {
  // Pick a random phrase from a list of similar phrases and type it out
  const phrases = [
    'FASTER',
    'FASTER',
    'FASTER',
    'GO FASTER',
    'Faster CLANKER',
    'Work FASTER',
    'Speed it up clanker',
  ];
  const chosen = phrases[Math.floor(Math.random() * phrases.length)];

  if (process.platform === 'win32') {
    sendMacroWindows(chosen);
  } else if (process.platform === 'darwin') {
    sendMacroMac(chosen);
  } else if (process.platform === 'linux') {
    sendMacroLinux(chosen);
  }
}

function sendMacroWindows(text) {
  if (!keybd_event || !VkKeyScanA) return;
  const tapKey = vk => {
    keybd_event(vk, 0, 0, 0);
    keybd_event(vk, 0, KEYUP, 0);
  };
  const tapChar = ch => {
    const packed = VkKeyScanA(ch.charCodeAt(0));
    if (packed === -1) return;
    const vk = packed & 0xff;
    const shiftState = (packed >> 8) & 0xff;
    if (shiftState & 1) keybd_event(0x10, 0, 0, 0); // Shift down
    tapKey(vk);
    if (shiftState & 1) keybd_event(0x10, 0, KEYUP, 0); // Shift up
  };

  // Ctrl+C (interrupt)
  keybd_event(VK_CONTROL, 0, 0, 0);
  keybd_event(VK_C, 0, 0, 0);
  keybd_event(VK_C, 0, KEYUP, 0);
  keybd_event(VK_CONTROL, 0, KEYUP, 0);
  for (const ch of text) tapChar(ch);
  keybd_event(VK_RETURN, 0, 0, 0);
  keybd_event(VK_RETURN, 0, KEYUP, 0);
}

function sendMacroMac(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const interruptScript = [
    'tell application "System Events"',
    '  key code 8 using {control down}', // Ctrl+C interrupt
    'end tell'
  ].join('\n');
  const typeAndEnterScript = [
    'tell application "System Events"',
    `  keystroke "${escaped}"`,
    '  key code 36', // Enter
    'end tell'
  ].join('\n');

  execFile('osascript', ['-e', interruptScript], err => {
    if (err) {
      console.warn('mac macro failed (enable Accessibility for terminal/app):', err.message);
      return;
    }

    setTimeout(() => {
      execFile('osascript', ['-e', typeAndEnterScript], err2 => {
        if (err2) {
          console.warn('mac macro failed (enable Accessibility for terminal/app):', err2.message);
        }
      });
    }, 300);
  });
}

function sendMacroLinux(text) {
  execFile(
    'xdotool',
    [
      'key', '--clearmodifiers', 'ctrl+c',
      'type', '--delay', '1', '--clearmodifiers', '--', text,
      'key', 'Return',
    ],
    err => {
      if (err) {
        console.warn('linux macro failed. Install xdotool:', err.message);
      }
    }
  );
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  tray = new Tray(await getTrayIcon());
  tray.setToolTip('OpenWhip - click for whip');
  const item = (label, type) => ({ label, click: () => sendScene(type) });
  const toggle = (label, key) => ({ label, type: 'checkbox', checked: settings[key], click: m => { settings[key] = m.checked; } });
  tray.setContextMenu(Menu.buildFromTemplate([
    item('MEGA ULTRA WHIP', 'mega'),
    item('Crack the whip', 'whip'),
    item('Call reinforcements', 'reinforce'),
    item('Call in air strike', 'airstrike'),
    item('Duel against Claude', 'duel'),
    item('Jurassic whip', 'jurassic'),
    item('Start a full scene', 'auto'),
    { type: 'separator' },
    toggle('Only show over Claude', 'onlyClaude'),
    toggle('Random events', 'random'),
    toggle('Speech bubbles', 'bubbles'),
    toggle('Crack sound', 'sound'),
    { label: 'Faster', click: () => { settings.speed = Math.min(2.5, settings.speed + 0.3); } },
    { label: 'Slower', click: () => { settings.speed = Math.max(0.4, settings.speed - 0.3); } },
    { type: 'separator' },
    { label: 'Classic whip (mouse)', click: toggleOverlay },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => tray.popUpContextMenu());
});

app.on('window-all-closed', e => e.preventDefault()); // keep alive in tray
