import { t } from '../i18n/index.ts';

/** Plain-words names of the upload encodings (the dialog's options; how a file was read). */
export function encodingLabel(encoding: string): string {
  switch (encoding) {
    case 'utf-8':
      return 'UTF-8';
    case 'utf-16':
      return 'UTF-16';
    case 'windows-1251':
      return t('Windows-1251 (Russian Excel)');
    case 'windows-1252':
      return t('Windows-1252 (Western European Excel)');
    case 'latin-1':
      return t('Latin-1 (ISO-8859-1)');
    default:
      return encoding;
  }
}
