// Electron entry point.
//
// Runs the Next.js standalone server as a child process and points a window at
// it. A child process (not in-process) because the server spawns ffmpeg/yt-dlp
// and does heavy work — keeping it off the UI process keeps the window alive.
//
// The important part is the env block below: packaged, the app lives in a
// read-only dir inside an asar archive, so every writable/external path must be
// redirected. See lib/paths.ts for the receiving end.

const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { fork } = require("node:child_process");

// Render everything on the CPU and never talk to the graphics driver.
//
// Users reported the machine blue-screening ("Your device ran into a problem")
// mid-use. A user-mode app cannot bugcheck Windows — only kernel code can, i.e.
// a driver. The only driver this app leans on is the GPU: Chromium runs a
// gpu-process, and the result screen hands it several 1080x1920 H.264 clips to
// hardware-decode at once. Old Intel drivers (the dev machine still ships a
// 2021 Iris Xe driver; church PCs are likely older) are a well-known crash
// source for exactly that path.
//
// Nothing here needs GPU: it's a form, a list, and a few short clips. Software
// decoding costs a little CPU and buys us not being at the mercy of whatever
// driver a given church PC happens to have. Keep this off.
app.disableHardwareAcceleration();

const isDev = !app.isPackaged;
let serverProc = null;
let win = null;

// resources/ next to the exe when packaged; repo root in dev.
const resourcesDir = isDev ? path.join(__dirname, "..") : process.resourcesPath;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.on("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("서버가 시작되지 않았습니다."));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

async function startServer() {
  const port = await freePort();
  const serverJs = path.join(resourcesDir, "app", "server.js");

  if (!fs.existsSync(serverJs)) {
    throw new Error(`서버 파일을 찾을 수 없습니다:\n${serverJs}`);
  }

  const userData = app.getPath("userData");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    // Writable locations — install dir is read-only when packaged.
    SHORTS_DATA_DIR: path.join(userData, "data"),
    SHORTS_BIN_DIR: path.join(userData, "bin"),
    // Read-only, but must live OUTSIDE asar so ffmpeg can read them.
    SHORTS_FONTS_DIR: path.join(resourcesDir, "fonts"),
    SHORTS_FFMPEG: path.join(resourcesDir, "ffmpeg.exe"),
  };

  serverProc = fork(serverJs, [], {
    env,
    cwd: path.dirname(serverJs),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serverProc.stdout?.on("data", (d) => console.log("[server]", String(d).trim()));
  serverProc.stderr?.on("data", (d) => console.error("[server]", String(d).trim()));
  serverProc.on("exit", (code) => {
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("서버 종료", `백그라운드 서버가 예기치 않게 종료되었습니다 (코드 ${code}).`);
    }
  });

  await waitForServer(port);
  return port;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    backgroundColor: "#0B0B0F",
    show: false,
    autoHideMenuBar: true,
    title: "설교 쇼츠 메이커",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win.show());
  // External links (e.g. "API 키 발급받기") open in the real browser, not here.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith(url)) {
      shell.openExternal(u);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  win.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    createWindow(`http://127.0.0.1:${port}`);
  } catch (e) {
    dialog.showErrorBox("실행 실패", String(e?.message || e));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && win) win.show();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  serverProc?.kill();
});

app.on("window-all-closed", () => {
  serverProc?.kill();
  app.quit();
});
