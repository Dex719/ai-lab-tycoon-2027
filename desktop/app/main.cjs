// Оболочка для Windows (exe) и macOS (app): одно окно с игрой, режим экрана, разрешение, монитор и масштаб из настроек.
// Сборка: desktop/README.md.
const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const IS_MAC = process.platform === 'darwin';
const DEFAULTS = { mode: 'fullscreen', width: 0, height: 0, displayId: null, scale: 0 };
let cfg = { ...DEFAULTS };
let win = null;

const cfgPath = () => path.join(app.getPath('userData'), 'display.json');

function loadCfg() {
  try {
    cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) };
  } catch {
    cfg = { ...DEFAULTS };
  }
}

function saveCfg() {
  try {
    fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
  } catch {
    // настройки останутся до выхода
  }
}

// Пиксели монитора (размер в точках Windows × масштаб Windows; 1707 × 1,5 = 2560,5 - отбрасываем дробь).
function physW(d) {
  return Math.floor(d.size.width * d.scaleFactor + 0.01);
}
function physH(d) {
  return Math.floor(d.size.height * d.scaleFactor + 0.01);
}

// Масштаб интерфейса: «Авто» - как в Windows, но игре остаётся не меньше 1366 × 768 точек.
function uiScale(d, w, h) {
  if (cfg.scale > 0) return cfg.scale;
  return Math.max(0.5, Math.min(d.scaleFactor, w / 1366, h / 768));
}

function clampZoom(z) {
  return Math.max(0.3, Math.min(3, z));
}

function targetDisplay() {
  return screen.getAllDisplays().find((d) => d.id === cfg.displayId) || screen.getPrimaryDisplay();
}

function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label || '',
    width: physW(d),
    height: physH(d),
    hz: Math.round(d.displayFrequency || 60),
    primary: d.id === primary,
  }));
}

function rectInside(r, b) {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height;
}

// Применить режим, разрешение, монитор и масштаб. Вход и выход из полного экрана в Windows идут
// с анимацией: сначала переключаем режим, а размер и масштаб выставляем, когда переход закончился.
let settleTimer = null;

function apply() {
  if (!win) return;
  const d = targetDisplay();
  // Разрешение не задано (первый запуск) или больше монитора - как у монитора.
  if (!cfg.width || !cfg.height || cfg.width > physW(d) || cfg.height > physH(d)) {
    cfg.width = physW(d);
    cfg.height = physH(d);
  }
  const wantFull = cfg.mode === 'fullscreen';
  const onTarget = rectInside(win.getBounds(), d.bounds);
  if (win.isFullScreen() && (!wantFull || !onTarget)) {
    win.setFullScreen(false);
    settle(() => !win.isFullScreen(), apply);
    return;
  }
  if (wantFull && !win.isFullScreen()) {
    if (!onTarget) win.setBounds({ x: d.bounds.x + 50, y: d.bounds.y + 50, width: 800, height: 600 });
    win.setFullScreen(true);
    settle(() => win.isFullScreen(), layout);
    return;
  }
  layout();
}

// Ждать, пока Windows закончит переход (до 3 с), затем выполнить next.
function settle(done, next) {
  clearTimeout(settleTimer);
  let n = 0;
  const tick = () => {
    if (!win) return;
    if (done() || ++n > 30) {
      // Ещё немного, чтобы окно получило итоговый размер.
      settleTimer = setTimeout(() => win && next(), 150);
      return;
    }
    settleTimer = setTimeout(tick, 100);
  };
  settleTimer = setTimeout(tick, 100);
}

// Размер окна и масштаб страницы для текущего режима.
function layout() {
  if (!win) return;
  const d = targetDisplay();
  if (win.isFullScreen()) {
    // Полный экран: окно размером с монитор, разрешение ниже родного делает картинку крупнее.
    const fit = Math.min(physW(d) / cfg.width, physH(d) / cfg.height);
    win.webContents.setZoomFactor(clampZoom((fit * uiScale(d, cfg.width, cfg.height)) / d.scaleFactor));
    return;
  }
  const wa = d.workArea;
  // В окне: размер окна в пикселях монитора равен выбранному разрешению (насколько помещается).
  const w = Math.min(Math.round(cfg.width / d.scaleFactor), wa.width);
  const h = Math.min(Math.round(cfg.height / d.scaleFactor), wa.height - 40);
  win.setContentSize(w, h);
  const outer = win.getBounds();
  win.setPosition(Math.round(wa.x + (wa.width - outer.width) / 2), Math.max(wa.y, Math.round(wa.y + (wa.height - outer.height) / 2)));
  windowZoom();
}

// Окно тянут мышью - масштаб «Авто» пересчитывается под новый размер.
function windowZoom() {
  if (!win || win.isFullScreen() || cfg.mode !== 'window') return;
  const d = screen.getDisplayMatching(win.getBounds());
  const [cw, ch] = win.getContentSize();
  win.webContents.setZoomFactor(clampZoom(uiScale(d, cw * d.scaleFactor, ch * d.scaleFactor) / d.scaleFactor));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 480,
    show: false,
    backgroundColor: '#24272d',
    title: 'AI Lab Tycoon',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Игра идёт и в окне за другими окнами; пауза при сворачивании - по настройке в самой игре.
      backgroundThrottling: false,
    },
  });
  if (!IS_MAC) win.setMenu(null);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    // Windows: F11 или Alt+Enter; macOS: Ctrl+Cmd+F, как в других программах Mac.
    const macFull = IS_MAC && input.meta && input.control && input.key.toLowerCase() === 'f';
    if (input.key === 'F11' || (input.alt && input.key === 'Enter') || macFull) {
      e.preventDefault();
      cfg.mode = cfg.mode === 'fullscreen' ? 'window' : 'fullscreen';
      saveCfg();
      apply();
    }
  });
  // Игра локальная: ссылки наружу и переходы не нужны.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => apply());
  win.once('ready-to-show', () => {
    apply();
    win.show();
  });
  win.on('resize', windowZoom);
  win.on('closed', () => {
    win = null;
  });
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

ipcMain.handle('cfg:get', () => cfg);
ipcMain.handle('cfg:set', (_e, patch) => {
  const p = patch || {};
  if (p.mode === 'window' || p.mode === 'fullscreen') cfg.mode = p.mode;
  if (Number.isFinite(p.width) && Number.isFinite(p.height) && p.width >= 640 && p.height >= 480) {
    cfg.width = Math.round(p.width);
    cfg.height = Math.round(p.height);
  }
  if (p.displayId === null || Number.isFinite(p.displayId)) cfg.displayId = p.displayId;
  if (Number.isFinite(p.scale) && (p.scale === 0 || (p.scale >= 0.5 && p.scale <= 2))) cfg.scale = p.scale;
  saveCfg();
  apply();
  return cfg;
});
ipcMain.handle('displays', () => displayList());
ipcMain.on('quit', () => app.quit());

// Окно, закрытое другими окнами, всё равно перерисовывается (иначе смена размера видна только после фокуса).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // На Mac без меню не работают Cmd+Q, Cmd+H и копирование в полях ввода: оставляем стандартные пункты.
  Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  app.whenReady().then(() => {
    loadCfg();
    createWindow();
    screen.on('display-removed', () => apply());
  });
  app.on('window-all-closed', () => app.quit());
}
