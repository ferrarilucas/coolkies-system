import { whatsappUrl } from "@/lib/whatsapp";

export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: Pick<Clipboard, "writeText" | "write">;
};

export type ShareOutcome =
  | "shared"
  | "cancelled"
  | "needs-gesture"
  | "failed"
  | "fallback-opened"
  | "image-ready";

export type ShareResult =
  | { outcome: Exclude<ShareOutcome, "image-ready"> }
  | { outcome: "image-ready"; imageCopied: boolean };

function copyTextSilently(nav: ShareNavigator, text: string): void {
  try {
    nav.clipboard?.writeText(text).catch(() => {});
  } catch {
    return;
  }
}

function canShareData(nav: ShareNavigator, data: ShareData): boolean {
  if (typeof nav.share !== "function") return false;
  if (!data.files) return true;
  try {
    return typeof nav.canShare === "function" && nav.canShare(data);
  } catch {
    return false;
  }
}

async function copyImageSafely(
  file: File,
  clipboardImage: ((file: File) => Promise<boolean>) | undefined,
): Promise<boolean> {
  if (!clipboardImage) return false;
  try {
    return (await clipboardImage(file)) === true;
  } catch {
    return false;
  }
}

export async function shareToWhatsApp(input: {
  text: string;
  file?: File | null;
  phone?: string | null;
  nav: ShareNavigator;
  open: (url: string) => void;
  clipboardImage?: (file: File) => Promise<boolean>;
  forceFallback?: boolean;
  skipTextCopy?: boolean;
}): Promise<ShareResult> {
  const { text, file, phone, nav, open, clipboardImage, forceFallback, skipTextCopy } = input;
  const data: ShareData = file ? { text, files: [file] } : { text };

  if (!skipTextCopy) copyTextSilently(nav, text);

  if (!forceFallback && canShareData(nav, data)) {
    try {
      await nav.share!(data);
      return { outcome: "shared" };
    } catch (error) {
      const name = (error as { name?: unknown })?.name;
      if (name === "AbortError") return { outcome: "cancelled" };
      if (name === "NotAllowedError") return { outcome: "needs-gesture" };
      return { outcome: "failed" };
    }
  }

  if (file) {
    const imageCopied = await copyImageSafely(file, clipboardImage);
    return { outcome: "image-ready", imageCopied };
  }

  open(whatsappUrl(text, phone));
  return { outcome: "fallback-opened" };
}
