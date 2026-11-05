/** K4: a plain sheet to print a board or My tasks for the morning meeting: one table per stage (or
 * group), an empty box to tick by hand, who, when, the steps. Printed instead of the page itself
 * (a board scrolls sideways and would not fit on paper). */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/index.ts';

export interface PrintRow {
  title: string;
  who: string;
  due: string;      // in words, e.g. "12 Nov" or "3 days late"
  late: boolean;
  steps: string;    // "2/5" or ""
  extra?: string;   // the board's name on My tasks, the importance on a board
}

export interface PrintGroup {
  title: string;
  rows: PrintRow[];
}

const CSS = `
.print-root { display: none; }
@media print {
  body.printing-sheet > *:not(.print-root) { display: none !important; }
  body.printing-sheet .print-root { display: block !important; color: #000; background: #fff; font: 11pt/1.35 Inter, Arial, sans-serif; }
  .print-root h1 { font-size: 17pt; margin: 0 0 2pt; }
  .print-root .sub { color: #444; margin: 0 0 12pt; }
  .print-root h2 { font-size: 13pt; margin: 14pt 0 4pt; break-after: avoid; }
  .print-root table { width: 100%; border-collapse: collapse; }
  .print-root th { text-align: left; font-size: 9.5pt; color: #444; border-bottom: 1.5pt solid #000; padding: 3pt 4pt; }
  .print-root td { border-bottom: 0.5pt solid #999; padding: 5pt 4pt; vertical-align: top; }
  .print-root tr { break-inside: avoid; }
  .print-root .box { width: 11pt; height: 11pt; border: 1pt solid #000; display: inline-block; }
  .print-root .late { font-weight: 700; }
  @page { margin: 12mm; }
}`;

export function PrintSheet({ title, note, groups, extraTitle }: { title: string; note?: string; groups: PrintGroup[]; extraTitle: string }) {
  useEffect(() => {
    if (document.getElementById('print-sheet-css')) return;
    const style = document.createElement('style');
    style.id = 'print-sheet-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);
  return createPortal(
    <div className="print-root" data-testid="print-sheet">
      <h1>{title}</h1>
      <p className="sub">
        <span className="print-when" />
        {note ? ` · ${note}` : ''}
      </p>
      {groups.map((g) => (
        <section key={g.title}>
          <h2>
            {g.title} ({g.rows.length})
          </h2>
          {g.rows.length ? (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '18pt' }} />
                  <th>{t('Task')}</th>
                  <th style={{ width: '22%' }}>{t('Who')}</th>
                  <th style={{ width: '14%' }}>{t('Due')}</th>
                  <th style={{ width: '9%' }}>{t('Steps')}</th>
                  <th style={{ width: '14%' }}>{extraTitle}</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <span className="box" />
                    </td>
                    <td>{r.title}</td>
                    <td>{r.who}</td>
                    <td className={r.late ? 'late' : undefined}>{r.due}</td>
                    <td>{r.steps}</td>
                    <td>{r.extra ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>{t('No tasks here')}</p>
          )}
        </section>
      ))}
    </div>,
    document.body,
  );
}
