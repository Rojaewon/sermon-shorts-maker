// Assembles .next/standalone into a runnable app tree for electron-builder.
//
// `next build` leaves standalone incomplete on purpose: static assets and
// public/ are NOT copied in (on a server they'd be served by a CDN). For a
// desktop app the server must serve them itself, so we copy them in here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pngToIco from "png-to-ico";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const build = path.join(root, "build");

// Hand-rolled recursive copy. fs.cpSync({recursive:true}) segfaults (0xC0000005)
// on the standalone node_modules tree on Windows, so it can't be used here.
// Symlinks are dereferenced: the packaged app must contain real files.
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    let type = entry;
    if (entry.isSymbolicLink()) {
      try {
        type = fs.statSync(src); // follow it
      } catch {
        continue; // broken link — skip
      }
    }
    if (type.isDirectory()) copyDir(src, dst);
    else if (type.isFile()) fs.copyFileSync(src, dst);
  }
}

function must(p, what) {
  if (!fs.existsSync(p)) throw new Error(`${what} 없음: ${p}\n먼저 "npm run build"를 실행하세요.`);
}

must(standalone, "standalone 빌드");

// Start clean so stale files from a previous build can't ship.
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(build, { recursive: true });

// 1) the standalone server tree -> build/app
copyDir(standalone, path.join(build, "app"));

// 2) static assets next build leaves behind
must(path.join(root, ".next", "static"), ".next/static");
copyDir(path.join(root, ".next", "static"), path.join(build, "app", ".next", "static"));
if (fs.existsSync(path.join(root, "public"))) {
  copyDir(path.join(root, "public"), path.join(build, "app", "public"));
}

// 3) fonts + ffmpeg go in as plain files, NOT into the app tree: ffmpeg is
//    spawned as an external process and reads the font files itself, so neither
//    can live inside the asar archive.
copyDir(path.join(root, "assets", "fonts"), path.join(build, "fonts"));

const ffmpeg = require("ffmpeg-static");
must(ffmpeg, "ffmpeg 바이너리");
fs.copyFileSync(ffmpeg, path.join(build, path.basename(ffmpeg)));

// 4) Next traces ffmpeg-static and drags copies of the 79MB binary into the app
//    tree — sometimes twice. The packaged app never runs those (Electron points
//    SHORTS_FFMPEG at the standalone copy above), so they are pure bulk.
//    Removing the .exe is safe: ffmpeg-static's index.js only computes a path
//    string from __dirname, it never checks that the file exists.
let reclaimed = 0;
const stripExe = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) stripExe(p);
    else if (/^ffmpeg(\.exe)?$/.test(entry.name)) {
      reclaimed += fs.statSync(p).size;
      fs.rmSync(p);
    }
  }
};
stripExe(path.join(build, "app"));

// 5) Source maps are debug-only and never read at runtime. Forcing the
//    next-server runtime in (see next.config) drags ~20MB of them along.
const stripMaps = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) stripMaps(p);
    else if (entry.name.endsWith(".js.map")) {
      reclaimed += fs.statSync(p).size;
      fs.rmSync(p);
    }
  }
};
stripMaps(path.join(build, "app"));

// 6) icon.png -> multi-resolution icon.ico (16/32/48/256). The taskbar, desktop
//    and Alt-Tab each pull a different size out of it.
//    Pass the path as a STRING, not an array: given an array png-to-ico packs
//    each file as-is with no resizing, which yields one oversized frame that
//    lies about its dimensions in the header, and NSIS rejects the file
//    ("invalid icon file size").
const iconPng = path.join(root, "electron", "resources", "icon.png");
must(iconPng, "아이콘 (electron/resources/icon.png)");
fs.writeFileSync(path.join(build, "icon.ico"), await pngToIco(iconPng));

// Guard: private data must never reach the installer. Trust but verify.
const leaks = [];
const scan = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(p);
    else if (/\.(mp4|m4a|webm)$/i.test(entry.name)) leaks.push(path.relative(build, p));
  }
};
scan(build);
if (leaks.length) {
  throw new Error(
    `빌드에 미디어 파일이 포함되었습니다. 배포하면 안 됩니다:\n  ${leaks.slice(0, 5).join("\n  ")}` +
      (leaks.length > 5 ? `\n  ...외 ${leaks.length - 5}개` : ""),
  );
}

const dirMB = (d) => {
  let n = 0;
  const walk = (x) => {
    for (const e of fs.readdirSync(x, { withFileTypes: true })) {
      const p = path.join(x, e.name);
      if (e.isDirectory()) walk(p);
      else n += fs.statSync(p).size;
    }
  };
  walk(d);
  return (n / 1048576).toFixed(0);
};

console.log("build/ 준비 완료  (미디어 유출 없음 확인)");
console.log(`  app/         ${dirMB(path.join(build, "app"))} MB  standalone 서버`);
console.log(`  fonts/       ${dirMB(path.join(build, "fonts"))} MB`);
console.log(`  ffmpeg.exe   ${(fs.statSync(ffmpeg).size / 1048576).toFixed(0)} MB`);
console.log(`  (중복 ffmpeg ${(reclaimed / 1048576).toFixed(0)} MB 제거)`);
