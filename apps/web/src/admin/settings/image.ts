// Client-side image shrinking for brand images (logo / shop photo): ≤ 1200 px long side, ≤ 1 MB.
export const MAX_SIDE = 1200;
export const MAX_BYTES = 1024 * 1024;

/** Size that fits within maxSide on the long side, never upscaling. Pure, tested. */
export function fitWithin(w: number, h: number, maxSide = MAX_SIDE): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Quality steps tried until the file is small enough. */
export const QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.35];

/** Pick the first encoded size within the limit (pure helper over measured sizes). */
export function pickQuality(sizes: { q: number; bytes: number }[], maxBytes = MAX_BYTES): number | null {
  return sizes.find((s) => s.bytes <= maxBytes)?.q ?? null;
}

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

function canvasBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), type, q));
}

/** Resize + re-encode (webp, falling back to jpeg). Throws a readable error if it cannot get under 1 MB. */
export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; type: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image (JPG, PNG or WebP).');
  const bmp = await createImageBitmap(file);
  const { w, h } = fitWithin(bmp.width, bmp.height, maxSide);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize images.');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const q of QUALITY_STEPS) {
      const b = await canvasBlob(c, type, q);
      if (!b || b.type !== type) break; // encoder not supported → next type
      if (b.size <= MAX_BYTES) return { blob: b, ext: type === 'image/webp' ? 'webp' : 'jpg', type };
    }
  }
  throw new Error('This image is too large even after shrinking. Try a smaller photo.');
}
