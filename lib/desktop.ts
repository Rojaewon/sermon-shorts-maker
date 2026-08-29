// Desktop-only actions, with browser fallbacks.
//
// Same shape as lib/settings.ts: use the Electron bridge when it exists, fall
// back to what a plain browser can do so `npm run dev` still works.

interface ShortsDesktop {
  saveAs(name: string, suggestedFileName: string): Promise<{ ok: boolean; reason?: string; path?: string }>;
  revealFile(name: string): Promise<{ ok: boolean; reason?: string }>;
  copyText(text: string): Promise<{ ok: boolean }>;
}

function bridge(): ShortsDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { shortsDesktop?: ShortsDesktop }).shortsDesktop ?? null;
}

export const isDesktop = () => bridge() !== null;

export async function copyText(text: string): Promise<boolean> {
  const b = bridge();
  if (b) {
    try {
      return (await b.copyText(text)).ok;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Returns "saved" | "canceled" | "failed". In a browser there is no save
// dialog, so fall back to a normal download and report it as saved.
export async function saveClipAs(
  name: string,
  suggestedFileName: string,
  downloadUrl: string,
): Promise<"saved" | "canceled" | "failed"> {
  const b = bridge();
  if (b) {
    try {
      const r = await b.saveAs(name, suggestedFileName);
      if (r.ok) return "saved";
      return r.reason === "canceled" ? "canceled" : "failed";
    } catch {
      return "failed";
    }
  }
  try {
    const a = document.createElement("a");
    a.href = `${downloadUrl}${downloadUrl.includes("?") ? "&" : "?"}download=1&as=${encodeURIComponent(suggestedFileName)}`;
    a.download = suggestedFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return "saved";
  } catch {
    return "failed";
  }
}
