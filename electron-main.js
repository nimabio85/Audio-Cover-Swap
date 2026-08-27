const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { startServer, verifyAudioFile } = require('./server');

const LATEST_RELEASE_API = 'https://api.github.com/repos/nimabio85/Audio-Cover-Swap/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/nimabio85/Audio-Cover-Swap/releases/latest';
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let localServer = null;
let updateStatus = { state: 'idle' };
let runUpdateCheck = null;

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && (url.pathname === '/nimabio85' || url.pathname.startsWith('/nimabio85/'));
  } catch {
    return false;
  }
}

function publishUpdateStatus(status) {
  updateStatus = { ...updateStatus, ...status };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:status', updateStatus);
  }
}

async function checkPortableUpdate() {
  try {
    publishUpdateStatus({ state: 'checking' });
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { 'User-Agent': `CoverSwap/${app.getVersion()}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const release = await response.json();
    const latestVersion = semver.coerce(release.tag_name || release.name);
    const currentVersion = semver.coerce(app.getVersion());
    if (!latestVersion || !currentVersion || !semver.gt(latestVersion, currentVersion)) {
      publishUpdateStatus({ state: 'idle' });
      return;
    }

    publishUpdateStatus({
      state: 'portable-available',
      version: latestVersion.version,
      releaseUrl: release.html_url || LATEST_RELEASE_PAGE,
    });
  } catch (error) {
    console.warn(`Portable update check failed: ${error.message}`);
    publishUpdateStatus({ state: 'error', message: error.message, portable: true });
  }
}

function configureInstalledUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    if (updateStatus.state !== 'downloaded') publishUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-not-available', () => {
    if (updateStatus.state !== 'downloaded') publishUpdateStatus({ state: 'idle' });
  });

  autoUpdater.on('update-available', (info) => {
    publishUpdateStatus({ state: 'available', version: info.version, percent: 0 });
  });

  autoUpdater.on('download-progress', ({ percent, transferred, total }) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(percent / 100);
    publishUpdateStatus({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      transferred,
      total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    publishUpdateStatus({ state: 'downloaded', version: info.version, percent: 100 });
  });

  autoUpdater.on('error', (error) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    console.warn(`Automatic update failed: ${error.message}`);
    publishUpdateStatus({ state: 'error', message: error.message, portable: false });
  });
}

function scheduleUpdateChecks() {
  if (!app.isPackaged) return;
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  runUpdateCheck = () => {
    if (isPortable) return checkPortableUpdate();
    return autoUpdater.checkForUpdates().catch((error) => {
      console.warn(`Update check failed: ${error.message}`);
      publishUpdateStatus({ state: 'error', message: error.message, portable: false });
    });
  };

  if (!isPortable) configureInstalledUpdater();
  setTimeout(runUpdateCheck, 8000);
  setInterval(runUpdateCheck, UPDATE_INTERVAL_MS);
}

ipcMain.handle('updates:get-status', () => updateStatus);
ipcMain.on('updates:check', () => {
  if (runUpdateCheck) runUpdateCheck();
});
ipcMain.on('updates:install', () => {
  if (updateStatus.state === 'downloaded') autoUpdater.quitAndInstall(false, true);
});
ipcMain.on('updates:open-release', () => {
  const url = updateStatus.releaseUrl || LATEST_RELEASE_PAGE;
  if (url.startsWith('https://github.com/nimabio85/Audio-Cover-Swap/')) shell.openExternal(url);
});

async function createWindow() {
  localServer = await startServer(0);
  const { port } = localServer.address();
  const appUrl = `http://127.0.0.1:${port}`;

  if (process.env.COVERSWAP_SMOKE_TEST === '1') {
    if (process.env.COVERSWAP_SMOKE_AUDIO) {
      await verifyAudioFile(process.env.COVERSWAP_SMOKE_AUDIO);
    }
    const response = await fetch(appUrl);
    const html = await response.text();
    if (!response.ok || !html.includes('CoverSwap')) {
      throw new Error('Packaged UI smoke test failed');
    }
    console.log('CoverSwap packaged UI smoke test passed');
    if (process.env.COVERSWAP_SMOKE_MARKER) {
      fs.writeFileSync(process.env.COVERSWAP_SMOKE_MARKER, 'ok');
    }
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#090b12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(appUrl);
  scheduleUpdateChecks();
}

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  if (process.env.COVERSWAP_SMOKE_MARKER) {
    fs.writeFileSync(process.env.COVERSWAP_SMOKE_MARKER, `error: ${error.stack || error.message}`);
  }
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});
