const { app, BrowserWindow, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const semver = require('semver');
const { startServer, verifyAudioFile } = require('./server');

const LATEST_RELEASE_API = 'https://api.github.com/repos/nimabio85/Audio-Cover-Swap/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/nimabio85/Audio-Cover-Swap/releases/latest';
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;
let localServer = null;

function showAppDialog(options) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return dialog.showMessageBox(mainWindow, options);
  }
  return dialog.showMessageBox(options);
}

async function checkPortableUpdate() {
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { 'User-Agent': `CoverSwap/${app.getVersion()}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return;

    const release = await response.json();
    const latestVersion = semver.coerce(release.tag_name || release.name);
    const currentVersion = semver.coerce(app.getVersion());
    if (!latestVersion || !currentVersion || !semver.gt(latestVersion, currentVersion)) return;

    const result = await showAppDialog({
      type: 'info',
      title: 'CoverSwap update available',
      message: `CoverSwap ${latestVersion.version} is available`,
      detail: 'Portable editions cannot replace themselves while running. Open the release page to download the new portable version.',
      buttons: ['Open download page', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) await shell.openExternal(release.html_url || LATEST_RELEASE_PAGE);
  } catch (error) {
    console.warn(`Portable update check failed: ${error.message}`);
  }
}

function configureInstalledUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  autoUpdater.on('update-available', async (info) => {
    const result = await showAppDialog({
      type: 'info',
      title: 'CoverSwap update available',
      message: `CoverSwap ${info.version} is available`,
      detail: 'Would you like to download it now? Your audio files will not be touched during the app update.',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.downloadUpdate().catch((error) => console.error(error));
  });

  autoUpdater.on('download-progress', ({ percent }) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(percent / 100);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    const result = await showAppDialog({
      type: 'info',
      title: 'CoverSwap update ready',
      message: `CoverSwap ${info.version} has been downloaded`,
      detail: 'Restart CoverSwap to finish installing the update.',
      buttons: ['Restart and install', 'Install when I close the app'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on('error', (error) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    console.warn(`Automatic update failed: ${error.message}`);
  });
}

function scheduleUpdateChecks() {
  if (!app.isPackaged) return;
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const check = () => {
    if (isPortable) checkPortableUpdate();
    else autoUpdater.checkForUpdates().catch((error) => console.warn(`Update check failed: ${error.message}`));
  };

  if (!isPortable) configureInstalledUpdater();
  setTimeout(check, 8000);
  setInterval(check, UPDATE_INTERVAL_MS);
}

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
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
