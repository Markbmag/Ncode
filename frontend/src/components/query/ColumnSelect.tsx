import { Select } from '@chakra-ui/react';
import type { SelectProps } from '@chakra-ui/react';
import type { ColumnType } from '../../api';
import { t } from '../../i18n/index.ts';

export interface PickOption {
  ref: string;
  label: string;
  table?: string;
  type: ColumnType;
  description?: string | null; // from the data model: shown on hover (M11)
}

interface ColumnSelectProps extends Omit<SelectProps, 'onChange' | 'value'> {
  options: PickOption[];
  value: string | undefined;
  onChange: (ref: string) => void;
  types?: ColumnType[]; // only offer these types
}

/** A native select of columns grouped by table: fast, keyboard friendly, works for thousands of columns. */
export function ColumnSelect({ options, value, onChange, types, placeholder = t('Pick a column…'), ...rest }: ColumnSelectProps) {
  const allowed = types ? options.filter((o) => types.includes(o.type) || o.type === 'unknown') : options;
  const groups = new Map<string, PickOption[]>();
  for (const o of allowed) {
    const key = o.table ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const missing = value && !allowed.some((o) => o.ref === value);
  // the picked column's description shows when pointing at the select; each option carries its own
  const picked = allowed.find((o) => o.ref === value);
  const option = (o: PickOption) => (
    <option key={o.ref} value={o.ref} title={o.description ?? undefined}>
      {o.label}
    </option>
  );
  return (
    <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} title={picked?.description ?? undefined} {...rest}>
      {missing && <option value={value}>{t('{name} (not available)', { name: value })}</option>}
      {[...groups.entries()].map(([table, items]) =>
        table ? (
          <optgroup key={table} label={table}>
            {items.map(option)}
          </optgroup>
        ) : (
          items.map(option)
        ),
      )}
    </Select>
  );
}
