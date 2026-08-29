// Electron entry point.
//
// Runs the Next.js standalone server as a child process and points a window at
// it. A child process (not in-process) because the server spawns ffmpeg/yt-dlp
// and does heavy work — keeping it off the UI process keeps the window alive.
//
// The important part is the env block below: packaged, the app lives in a
// read-only dir inside an asar archive, so every writable/external path must be
// redirected. See lib/paths.ts for the receiving end.

const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage, clipboard } = require("electron");
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

// ---- settings store -------------------------------------------------------
// Lives in the main process because the renderer's origin changes with the
// port on every launch (see preload.js). Values are encrypted with the OS
// keychain where available — one of them is the user's API key, and the plain
// alternative would leave it readable in a text file forever.

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(obj) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(obj), { mode: 0o600 });
  } catch (e) {
    console.error("[settings] 저장 실패:", e.message);
  }
}

ipcMain.handle("settings:get", (_e, key) => {
  const raw = readSettings()[key];
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("enc:")) return raw; // written before encryption was available
  try {
    return safeStorage.decryptString(Buffer.from(raw.slice(4), "base64"));
  } catch {
    return null; // keychain changed or profile copied to another machine
  }
});

ipcMain.handle("settings:set", (_e, key, value) => {
  const all = readSettings();
  if (value == null || value === "") delete all[key];
  else if (safeStorage.isEncryptionAvailable()) {
    all[key] = "enc:" + safeStorage.encryptString(String(value)).toString("base64");
  } else {
    all[key] = String(value);
  }
  writeSettings(all);
  return true;
});


// ---- rendered clips ------------------------------------------------------
// The renderer passes a file NAME and nothing else. Resolving it here means a
// compromised or buggy page cannot point these at arbitrary files: the name is
// stripped to [A-Za-z0-9_.-] (same rule as app/api/files) and joined onto the
// one directory renders are written to.

function outFile(name) {
  const safe = String(name || "").replace(/[^\w.\-]/g, "");
  if (!safe || safe.includes("..")) return null;
  const file = path.join(app.getPath("userData"), "data", "out", safe);
  return fs.existsSync(file) ? file : null;
}

ipcMain.handle("clip:saveAs", async (_e, name, suggestedFileName) => {
  const src = outFile(name);
  if (!src) return { ok: false, reason: "notfound" };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "쇼츠 영상 저장",
    defaultPath: path.join(app.getPath("downloads"), suggestedFileName || path.basename(src)),
    filters: [{ name: "동영상", extensions: ["mp4"] }],
  });
  if (canceled || !filePath) return { ok: false, reason: "canceled" };
  try {
    fs.copyFileSync(src, filePath);
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});

ipcMain.handle("clip:reveal", (_e, name) => {
  const file = outFile(name);
  if (!file) return { ok: false, reason: "notfound" };
  shell.showItemInFolder(file);
  return { ok: true };
});

ipcMain.handle("clip:copyText", (_e, text) => {
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
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
