/**
 * Graphics quality. Low trades bloom, half the ceiling lights, normal maps and
 * some of the camcorder filter's taps for a frame rate weak tablets can hold.
 * Unless the player has chosen, it's picked from what the device looks like.
 */

const KEY = 'hum-lowgfx';

/** A best guess at whether this device's GPU will struggle with the full look. */
export function looksWeak(): boolean {
  const ua = navigator.userAgent;
  // Amazon Fire tablets (Silk browser, KF* model codes).
  if (/Silk|KF[A-Z]{2,4}\b/.test(ua)) return true;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && ((navigator.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 3)) return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    // Phone and tablet GPUs below the flagship class.
    if (/Mali|PowerVR|Adreno \(TM\) [1-5]\d\d\b|Adreno \(TM\) 6[0-1]\d\b/i.test(gpu)) return true;
  } catch { /* no WebGL info */ }
  return false;
}

export function loadLowGfx(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage blocked */ }
  return looksWeak();
}

export function saveLowGfx(low: boolean) {
  try { localStorage.setItem(KEY, low ? '1' : '0'); } catch { /* storage blocked */ }
}
