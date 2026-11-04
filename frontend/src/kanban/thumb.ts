import { PHOTO_MAX_SIDE, shouldShrink, shrunkName, thumbSize } from './logic';

/** A ≤ 400 px JPEG preview of an image, made in the browser (null when the browser cannot read it, e.g. HEIC). */
export function makeThumbnail(file: Blob, max = 400): Promise<Blob | null> {
  return scaledJpeg(file, max, 0.82);
}

/** A big phone photo as a ≤ 2560 px JPEG (K2): a 4 MB picture becomes about 1 MB, the location and
 * camera details in it are left out, and it is turned the right way up. Other files stay as they are. */
export async function shrinkPhoto(file: File, type: string): Promise<{ blob: Blob; name: string }> {
  if (!shouldShrink(type, file.size)) return { blob: file, name: file.name };
  const smaller = await scaledJpeg(file, PHOTO_MAX_SIDE, 0.85);
  return smaller && smaller.size < file.size ? { blob: smaller, name: shrunkName(file.name) } : { blob: file, name: file.name };
}

async function scaledJpeg(file: Blob, max: number, quality: number): Promise<Blob | null> {
  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      bitmap = img;
    }
    const { width, height } = thumbSize(bitmap.width, bitmap.height, max);
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background instead of black
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
  } catch {
    return null;
  } finally {
    if (bitmap && 'close' in bitmap) bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
