/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone: a self-contained server plus only the node_modules it
  // actually needs. Without this the desktop app would have to ship the whole
  // node_modules tree.
  output: "standalone",

  // ffmpeg-static / yt-dlp-wrap ship native binaries.
  // Keep them external so Next doesn't try to bundle the .exe files.
  serverExternalPackages: ["ffmpeg-static", "yt-dlp-wrap"],

  // The file tracer reads `path.join(process.cwd(), ".data")` in lib/paths.ts
  // and helpfully copies that whole directory into the build — which is the
  // user's cached sermon videos and rendered output (200MB+ of private
  // content that would then ship inside the installer). Same for bin/ (the
  // downloaded yt-dlp) and previous build artifacts. None of it belongs in a
  // build: the packaged app creates these fresh under userData.
  outputFileTracingExcludes: {
    "*": [
      "./.data/**",
      "./bin/**",
      "./build/**",
      "./dist/**",
      "./electron/**",
      "./*.mp4",
      "./*.png",
    ],
  },

  // The tracer copies the next-server runtime for *pages* into standalone but
  // misses the one API routes need (app-route-turbo.runtime.prod.js), so every
  // /api/* call 500s with "Cannot find module" in a packaged build. It only
  // shows up outside the repo — run standalone from the project dir and Node
  // resolves the missing file from the real node_modules and it appears to work.
  // Force the whole prod runtime set in; it's ~4MB.
  outputFileTracingIncludes: {
    "*": ["./node_modules/next/dist/compiled/next-server/*.prod.js"],
  },
};

export default nextConfig;
