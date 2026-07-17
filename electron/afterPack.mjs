// electron-builder afterPack hook: stamp the icon and version info onto the
// app .exe.
//
// Normally electron-builder does this itself, but only when
// win.signAndEditExecutable is on — and that makes it fetch its winCodeSign
// toolchain, whose archive contains macOS symlinks that cannot be unpacked on
// Windows without admin rights, failing the whole build. We have no certificate
// and nothing to sign, so signing stays off and we run rcedit ourselves here.
// Without this the installed app would wear the default Electron logo.

import path from "node:path";
import fs from "node:fs";
import { rcedit } from "rcedit";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const ico = path.join(context.packager.info.projectDir, "build", "icon.ico");

  if (!fs.existsSync(ico)) throw new Error(`아이콘 없음: ${ico}`);
  if (!fs.existsSync(exe)) throw new Error(`실행 파일 없음: ${exe}`);

  await rcedit(exe, {
    icon: ico,
    "version-string": {
      ProductName: "설교 쇼츠 메이커",
      FileDescription: "설교 쇼츠 메이커",
      CompanyName: "설교 쇼츠 메이커",
      LegalCopyright: "© 2026",
    },
    "file-version": context.packager.appInfo.version,
    "product-version": context.packager.appInfo.version,
  });

  console.log(`  • icon + version info stamped onto ${path.basename(exe)}`);
}
