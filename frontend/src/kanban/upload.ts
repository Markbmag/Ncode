import { uploadAttachment, uploadThumb } from './api';
import { guessType, isImage } from './logic';
import { makeThumbnail, shrinkPhoto } from './thumb';
import { t } from '../i18n/index.ts';
import { sendOrQueue } from './offline/queue';
import type { Queued } from './offline/queue';

async function send(cardId: number, blob: Blob, name: string, type: string): Promise<void> {
  const res = await uploadAttachment(cardId, blob, name || 'photo.jpg', type);
  if (isImage(type) && res?.id) {
    const thumb = await makeThumbnail(blob);
    if (thumb) await uploadThumb(res.id, thumb).catch(() => undefined); // the full image still works without it
  }
}

/** Sends one picked file to a task: big photos are made smaller first, pictures get a preview. */
export async function attachFile(cardId: number, file: File): Promise<void> {
  const type = guessType(file.name, file.type);
  const { blob, name } = await shrinkPhoto(file, type);
  await send(cardId, blob, name, blob === file ? type : 'image/jpeg');
}

/** The same, kept on the phone and sent later when there is no connection (K4). */
export async function attachOrQueue(cardId: number, file: File): Promise<void | Queued> {
  const type = guessType(file.name, file.type);
  const { blob, name } = await shrinkPhoto(file, type);
  const sentType = blob === file ? type : 'image/jpeg';
  return sendOrQueue({ kind: 'attach', cardId, name: name || 'photo.jpg', type: sentType, blob, label: t('add {file}', { file: name || 'photo.jpg' }) }, () => send(cardId, blob, name, sentType));
}
