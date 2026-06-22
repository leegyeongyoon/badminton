import { Platform } from 'react-native';

/**
 * Copy `text` to the system clipboard, cross-platform & WEB-SAFE.
 *
 *  • web    → navigator.clipboard.writeText (with a legacy execCommand fallback
 *             for non-secure contexts where the async Clipboard API is missing).
 *  • native → expo-clipboard IF installed, else a no-op that resolves false so
 *             callers can branch (we never crash if the module is absent).
 *
 * Returns true on success, false if the copy could not be performed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        return true;
      }
      // Legacy fallback (e.g. http / older browsers): hidden textarea + execCommand.
      if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      }
    } catch {
      return false;
    }
    return false;
  }

  // Native: use expo-clipboard only if it is actually installed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(text);
      return true;
    }
    if (Clipboard?.setString) {
      Clipboard.setString(text);
      return true;
    }
  } catch {
    // expo-clipboard not installed → fall through.
  }
  return false;
}
