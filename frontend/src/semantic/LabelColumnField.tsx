import { Button, FormControl, FormHelperText, FormLabel, HStack, Select } from '@chakra-ui/react';
import type { SchemaColumn } from '../api';
import { t } from '../i18n/index.ts';
import { differsFromTechnical, nameOf } from '../lib/names';
import { useSchema } from '../query/useSchema';

/**
 * "Show values as" (M12) for a foreign-key column in the data model: the column of the related table
 * that questions grouped by it show in place of the id ("Final assembly", not 4). An obvious column
 * (name, title, code ...) is suggested; empty = the id itself.
 */
export function LabelColumnField({ connection, column, value, onChange }: {
  connection: string;
  column: SchemaColumn;
  value: string | null | undefined;
  onChange: (label: string | null) => void;
}) {
  const schema = useSchema(column.foreign_key ? connection : '');
  const fk = column.foreign_key;
  if (!fk) return null;
  const target = schema.data?.tables.find((tb) => tb.name === fk.table);
  const choices = (target?.columns ?? []).filter((c) => c.name !== fk.column && c.type !== 'binary' && c.type !== 'json');
  const tableName = nameOf(fk.table, target);
  const label = (c: SchemaColumn) => {
    const name = nameOf(c.name, c);
    return differsFromTechnical(c.name, name) ? `${tableName} → ${name} (${c.name})` : `${tableName} → ${name}`;
  };
  const suggested = column.suggested_label;
  return (
    <FormControl>
      <FormLabel fontSize="sm">{t('Show values as')}</FormLabel>
      <HStack>
        <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} data-testid="field-label-column">
          <option value="">{t('The value itself ({column})', { column: column.name })}</option>
          {value && !choices.some((c) => c.name === value) && <option value={value}>{value}</option>}
          {choices.map((c) => (
            <option key={c.name} value={c.name}>
              {label(c)}
            </option>
          ))}
        </Select>
        {suggested && !value && (
          <Button size="sm" variant="subtle" flexShrink={0} onClick={() => onChange(suggested)} data-testid="field-label-suggested">
            {t('Use {column}', { column: suggested })}
          </Button>
        )}
      </HStack>
      <FormHelperText fontSize="xs">
        {t('Questions grouped by this column show the name from {table} instead of the id; filters, sorting and links still use the id. Value pickers show both.', { table: tableName })}
      </FormHelperText>
    </FormControl>
  );
}
