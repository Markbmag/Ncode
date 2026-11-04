import { uploadAttachment, uploadThumb } from './api';
import { guessType, isImage } from './logic';
import { makeThumbnail, shrinkPhoto } from './thumb';

/** Sends one picked file to a task: big photos are made smaller first, pictures get a preview. */
export async function attachFile(cardId: number, file: File): Promise<void> {
  const type = guessType(file.name, file.type);
  const { blob, name } = await shrinkPhoto(file, type);
  const sentType = blob === file ? type : 'image/jpeg';
  const res = await uploadAttachment(cardId, blob, name || 'photo.jpg', sentType);
  if (isImage(sentType) && res?.id) {
    const thumb = await makeThumbnail(blob);
    if (thumb) await uploadThumb(res.id, thumb).catch(() => undefined); // the full image still works without it
  }
}
