const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const { startServer, verifyAudioFile } = require('./server');

let mainWindow = null;
let localServer = null;

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
