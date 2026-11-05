import { t } from '../i18n/index.ts';
import { fullTime } from './logic';

/** Puts the sheet on paper: the page itself is hidden while printing. */
export function printSheet() {
  // the time it is printed, taken now
  const when = t('Printed {when}', { when: fullTime(Date.now() / 1000) });
  document.querySelectorAll('.print-root .print-when').forEach((el) => (el.textContent = when));
  document.body.classList.add('printing-sheet');
  const done = () => {
    document.body.classList.remove('printing-sheet');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // print() returns at once on some phones; the class only matters while printing, so the fallback waits
  setTimeout(done, 60_000);
}
