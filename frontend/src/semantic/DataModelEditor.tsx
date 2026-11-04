import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, HStack, IconButton, Input, Select, SimpleGrid, Text, Textarea, VStack, useToast,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, http } from '../api';
import type { ColumnType, SchemaColumn, SchemaTable, SchemaV2 } from '../api';
import { FriendlyName } from '../components/FriendlyName';
import { FilterEditor } from '../components/query/FilterEditor';
import { ColumnSelect } from '../components/query/ColumnSelect';
import type { PickOption } from '../components/query/ColumnSelect';
import { t } from '../i18n/index.ts';
import { PencilIcon, PlusIcon, TrashIcon, XIcon } from '../icons';
import { GlossaryLinks } from '../glossary/GlossaryLinks';
import { ConfirmDialog, DialogShell } from '../library/dialogs';
import { AGGREGATES } from '../query/draft';
import { byLabel, descriptionOf, differsFromTechnical, nameOf, prettify, setTranslation } from '../lib/names';
import type { Translations } from '../lib/names';
import type { FilterGroup } from '../query/types';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { formatNumber } from '../viz/format';
import type { ColumnFormat, NumberStyle } from '../viz/types';
import { SEMANTIC_TYPES, semantic, useMetrics } from './api';
import { LabelColumnField } from './LabelColumnField';
import type { FieldMeta, Metric, MetricDefinition, MetricPart, TotalFn } from './api';
import { ADDABLE, definitionOf, definitionReady, draftOf, draftReady, emptyGroup, exampleSpec, exampleValues, needsColumn } from './ratio';
import type { TotalDraft } from './ratio';

// ---------------------------------------------------------------- translations (M11)

/** The Russian name and description next to the base ones: what people see when the interface is in Russian. */
function RussianFields({ translations, onChange, nameField = 'display_name', nameMax = 200, namePlaceholder, testId = 'ru' }: {
  translations: Translations | null;
  onChange: (tr: Translations) => void;
  nameField?: 'display_name' | 'name';
  nameMax?: number;
  namePlaceholder?: string;
  testId?: string;
}) {
  const ru = translations?.ru ?? {};
  return (
    <Box border="1px dashed" borderColor="lineColor" borderRadius="md" px={3} py={2}>
      <Text fontSize="xs" fontWeight={700} color="faintText" mb={1}>
        Русский
      </Text>
      <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={2}>
        <Input
          size="sm"
          value={ru[nameField] ?? ''}
          placeholder={namePlaceholder ?? t('Name in Russian')}
          aria-label={t('Name in Russian')}
          maxLength={nameMax}
          onChange={(e) => onChange(setTranslation(translations, 'ru', nameField, e.target.value))}
          data-testid={`${testId}-name`}
        />
        <Input
          size="sm"
          value={ru.description ?? ''}
          placeholder={t('Description in Russian')}
          aria-label={t('Description in Russian')}
          maxLength={5000}
          onChange={(e) => onChange(setTranslation(translations, 'ru', 'description', e.target.value))}
          data-testid={`${testId}-description`}
        />
      </SimpleGrid>
      <Text fontSize="xs" color="faintText" mt={1}>
        {t('Shown when the interface is in Russian; empty fields show the text above.')}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------- a table

/** A table's friendly name with its technical one, and a button to name and describe it. */
export function TableHeading({ connection, table }: { connection: string; table: SchemaTable }) {
  const [editing, setEditing] = useState(false);
  const label = nameOf(table.name, table);
  return (
    <HStack spacing={1} minW={0}>
      <FriendlyName label={label} name={table.name} description={descriptionOf(table)} showTechnical={differsFromTechnical(table.name, label)} mono fontSize="sm" fontWeight={700} />
      <Tooltip label={t('Name and describe the table')} hasArrow>
        <IconButton aria-label={t('Name and describe {table}', { table: table.name })} size="xs" variant="ghost" icon={<PencilIcon boxSize={3} />} onClick={() => setEditing(true)} data-testid="table-name-edit" />
      </Tooltip>
      {editing && <TableDialog connection={connection} table={table} onClose={() => setEditing(false)} />}
    </HStack>
  );
}

function TableDialog({ connection, table, onClose }: { connection: string; table: SchemaTable; onClose: () => void }) {
  const [name, setName] = useState(table.display_name ?? '');
  const [description, setDescription] = useState(table.description ?? '');
  const [translations, setTranslations] = useState<Translations | null>(table.translations ?? null);
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={table.name}
      submitLabel={t('Save')}
      size="lg"
      onSubmit={() => semantic.setTable(connection, table.name, { display_name: name, description, translations })}
    >
      <FormControl>
        <FormLabel fontSize="sm">{t('Display name')}</FormLabel>
        <Input size="sm" value={name} placeholder={prettify(table.name)} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="table-display-name" />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder={t('What one row is, where the data comes from')} data-testid="table-description" />
      </FormControl>
      <RussianFields translations={translations} onChange={setTranslations} testId="table-ru" />
      <Text fontSize="xs" color="mutedText">
        {t('People see this name in table lists and pickers; the technical name stays next to it and still finds the table.')}
      </Text>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- a column

function FormatFields({ format, onChange }: { format: ColumnFormat; onChange: (f: ColumnFormat) => void }) {
  return (
    <SimpleGrid columns={3} spacing={2}>
      <FormControl>
        <FormLabel fontSize="xs">{t('Numbers as')}</FormLabel>
        <Select size="sm" value={format.style ?? 'auto'} onChange={(e) => onChange({ ...format, style: e.target.value as NumberStyle })}>
          <option value="auto">{t('Automatic')}</option>
          <option value="number">{t('Number')}</option>
          <option value="currency">{t('Money')}</option>
          <option value="percent">{t('Percent (0.12 = 12 %)')}</option>
          <option value="plain">{t('Plain (no separators)')}</option>
        </Select>
      </FormControl>
      <FormControl isDisabled={format.style !== 'currency'}>
        <FormLabel fontSize="xs">{t('Currency')}</FormLabel>
        <Input size="sm" value={format.currency ?? ''} placeholder="EUR" maxLength={3} onChange={(e) => onChange({ ...format, currency: e.target.value.toUpperCase() || undefined })} />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="xs">{t('Decimals')}</FormLabel>
        <Input size="sm" type="number" min={0} max={10} value={format.decimals ?? ''} placeholder={t('auto')} onChange={(e) => onChange({ ...format, decimals: e.target.value === '' ? null : Number(e.target.value) })} />
      </FormControl>
    </SimpleGrid>
  );
}

function cleanFormat(f: ColumnFormat): ColumnFormat | null {
  const out: ColumnFormat = {};
  if (f.style && f.style !== 'auto') out.style = f.style;
  if (f.style === 'currency' && f.currency) out.currency = f.currency;
  if (f.decimals !== null && f.decimals !== undefined) out.decimals = f.decimals;
  return Object.keys(out).length ? out : null;
}

export function FieldDialog({ connection, table, column, onClose }: { connection: string; table: string; column: SchemaColumn | null; onClose: () => void }) {
  return column ? <FieldForm connection={connection} table={table} column={column} onClose={onClose} /> : null;
}

function FieldForm({ connection, table, column, onClose }: { connection: string; table: string; column: SchemaColumn; onClose: () => void }) {
  const [meta, setMeta] = useState<FieldMeta>({
    display_name: column.display_name ?? '',
    description: column.description ?? '',
    semantic_type: column.semantic_type ?? '',
    hidden: !!column.hidden,
    parse_as_date: !!column.parse_as_date,
    translations: column.translations ?? null,
    label_column: column.label_column ?? null,
  });
  const [format, setFormat] = useState<ColumnFormat>((column.format as ColumnFormat) ?? {});
  const text = /char|text|string|clob/i.test(column.db_type) || column.parse_as_date;
  const set = (patch: Partial<FieldMeta>) => setMeta((m) => ({ ...m, ...patch }));
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={`${table}.${column.name}`}
      submitLabel={t('Save')}
      size="lg"
      onSubmit={() => semantic.setField(connection, table, column.name, { ...meta, format: cleanFormat(format) })}
    >
      <Text fontSize="xs" color="mutedText" mt={-2}>
        {t('{dbType} · shown as {type}', { dbType: column.db_type, type: column.type })}
      </Text>
      <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
        <FormControl>
          <FormLabel fontSize="sm">{t('Display name')}</FormLabel>
          <Input size="sm" value={meta.display_name ?? ''} placeholder={prettify(column.name)} onChange={(e) => set({ display_name: e.target.value })} maxLength={200} data-testid="field-display-name" />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="sm">{t('What it is')}</FormLabel>
          <Select size="sm" value={meta.semantic_type ?? ''} onChange={(e) => set({ semantic_type: e.target.value || null })} data-testid="field-semantic-type">
            <option value="">—</option>
            {SEMANTIC_TYPES.map((st) => (
              <option key={st.value} value={st.value}>
                {t(st.label)}
              </option>
            ))}
          </Select>
        </FormControl>
      </SimpleGrid>
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={meta.description ?? ''} onChange={(e) => set({ description: e.target.value })} maxLength={5000} placeholder={t('Shown as a tooltip on the column')} />
      </FormControl>
      <RussianFields translations={meta.translations ?? null} onChange={(translations) => set({ translations })} testId="field-ru" />
      <FormatFields format={format} onChange={setFormat} />
      <LabelColumnField connection={connection} column={column} value={meta.label_column} onChange={(label_column) => set({ label_column })} />
      <VStack align="stretch" spacing={2}>
        <Checkbox size="sm" isChecked={!!meta.hidden} onChange={(e) => set({ hidden: e.target.checked })} data-testid="field-hidden">
          {t('Hidden — not offered in the question builder and left out of “all columns” (still usable by name; not a permission)')}
        </Checkbox>
        <Checkbox size="sm" isChecked={!!meta.parse_as_date} isDisabled={!text && !meta.parse_as_date} onChange={(e) => set({ parse_as_date: e.target.checked })} data-testid="field-parse-date">
          {t('Read as dates — text like 2026-01-31, 31.01.2026 or unix time becomes a date-time (filters, “by month”); other values become empty')}
        </Checkbox>
      </VStack>
    </DialogShell>
  );
}

/** The columns of one table with their data-model settings; click a column to change them. */
export function EditableColumns({ connection, table, columns, onEdit }: { connection: string; table: string; columns: SchemaColumn[]; onEdit: (c: SchemaColumn) => void }) {
  void connection;
  void table;
  return (
    <VStack align="stretch" spacing={0}>
      {columns.map((col) => (
        <Flex
          key={col.name}
          as="button"
          type="button"
          onClick={() => onEdit(col)}
          align="center"
          gap={2}
          px={3}
          py={1.5}
          textAlign="left"
          borderTop="1px solid"
          borderColor="lineColor"
          _hover={{ bg: 'panelHover' }}
          opacity={col.hidden ? 0.55 : 1}
          data-testid="model-column"
        >
          <Box flex={1} minW={0}>
            <Text fontFamily="mono" fontSize="xs" noOfLines={1}>
              {col.name}
            </Text>
            {(col.display_name || col.translations?.ru?.display_name) && (
              <Text fontSize="xs" color="mutedText" noOfLines={1}>
                {[col.display_name, col.translations?.ru?.display_name].filter(Boolean).join(' · ')}
              </Text>
            )}
            <GlossaryLinks target={{ connection, table, column: col.name }} plain />
          </Box>
          {col.parse_as_date && <Badge fontSize="0.6rem" colorScheme="teal">{t('as date')}</Badge>}
          {col.hidden && <Badge fontSize="0.6rem">{t('hidden')}</Badge>}
          {col.semantic_type && <Badge fontSize="0.6rem" colorScheme="purple" textTransform="none">{col.semantic_type}</Badge>}
          {col.label_column && (
            <Tooltip label={t('Shown as {column} of {table}', { column: col.label_column, table: col.foreign_key?.table ?? '' })} hasArrow>
              <Badge fontSize="0.6rem" colorScheme="teal" textTransform="none" data-testid="model-label-column">
                → {col.label_column}
              </Badge>
            </Tooltip>
          )}
          <Tooltip label={col.db_type} hasArrow>
            <Badge fontSize="0.6rem" bg="chipBg" color="mutedText" textTransform="none">
              {col.type}
            </Badge>
          </Tooltip>
          <PencilIcon boxSize={3} color="faintText" />
        </Flex>
      ))}
    </VStack>
  );
}

// ---------------------------------------------------------------- relationships

export function ManualRelationships({ connection, schema }: { connection: string; schema: SchemaV2 }) {
  const toast = useToast();
  const list = useQuery({ queryKey: ['semantic', 'relationships', connection], queryFn: () => semantic.relationships(connection) });
  const [adding, setAdding] = useState(false);
  const remove = async (id: number) => {
    try {
      await semantic.deleteRelationship(connection, id);
      await list.refetch();
    } catch (e) {
      toast({ status: 'error', title: t('Could not remove it'), description: apiErrorMessage(e, t('Please try again')) });
    }
  };
  return (
    <Box>
      <Flex align="center" justify="space-between" mb={2}>
        <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
          {t('RELATIONSHIPS ADDED BY HAND')}
        </Text>
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} onClick={() => setAdding(true)} data-testid="add-relationship">
          {t('Relationship')}
        </Button>
      </Flex>
      {(list.data ?? []).length === 0 ? (
        <Text fontSize="sm" color="mutedText">
          {t('None. For tables without foreign keys, add how they relate (orders.customer_ref → customers.id): the question builder then joins them by itself.')}
        </Text>
      ) : (
        <VStack align="stretch" spacing={1}>
          {list.data!.map((r) => (
            <Flex key={r.id} align="center" gap={2} fontFamily="mono" fontSize="xs" border="1px solid" borderColor="lineColor" borderRadius="md" px={2} py={1}>
              <Text flex={1}>
                {String(r.from_table)}.{(r.from_columns as string[]).join(', ')} → {String(r.to_table)}.{(r.to_columns as string[]).join(', ')}
              </Text>
              <IconButton aria-label={t('Remove relationship')} size="xs" variant="ghost" icon={<TrashIcon boxSize={3} />} onClick={() => void remove(r.id)} />
            </Flex>
          ))}
        </VStack>
      )}
      {adding && <RelationshipDialog connection={connection} schema={schema} onClose={() => { setAdding(false); void list.refetch(); }} />}
    </Box>
  );
}

function RelationshipDialog({ connection, schema, onClose }: { connection: string; schema: SchemaV2; onClose: () => void }) {
  const tables = schema.tables.map((tb) => tb.name);
  const [from, setFrom] = useState({ table: '', column: '' });
  const [to, setTo] = useState({ table: '', column: '' });
  const colsOf = (name: string) => schema.tables.find((x) => x.name === name)?.columns.map((c) => c.name) ?? [];
  const side = (label: string, v: { table: string; column: string }, set: (v: { table: string; column: string }) => void, testId: string) => (
    <FormControl>
      <FormLabel fontSize="sm">{label}</FormLabel>
      <HStack>
        <Select size="sm" value={v.table} placeholder={t('Table…')} onChange={(e) => set({ table: e.target.value, column: '' })} data-testid={`${testId}-table`}>
          {tables.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Select size="sm" value={v.column} placeholder={t('Column…')} onChange={(e) => set({ ...v, column: e.target.value })} isDisabled={!v.table} data-testid={`${testId}-column`}>
          {colsOf(v.table).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </HStack>
    </FormControl>
  );
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={t('Add a relationship')}
      submitLabel={t('Add')}
      canSubmit={!!(from.table && from.column && to.table && to.column)}
      onSubmit={() => semantic.addRelationship(connection, { from_table: from.table, from_columns: [from.column], to_table: to.table, to_columns: [to.column] })}
    >
      {side(t('Column that refers (many rows)'), from, setFrom, 'rel-from')}
      {side(t('Column it refers to (usually the id)'), to, setTo, 'rel-to')}
      <Text fontSize="xs" color="mutedText">
        {t('Works like a foreign key for the question builder (joins and suggestions). The database is not changed.')}
      </Text>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- metrics

/** "Sum of total", "Count of rows"; a ratio: "Sum of scrap_qty ÷ Sum of a formula". */
function metricSummary(d: MetricDefinition): string {
  const one = (p: MetricPart) => `${AGGREGATES.find((a) => a.fn === p.fn)?.label ?? p.fn} ${p.ref ?? (p.expr ? t('a formula') : '')}`.trim();
  if (d.fn === 'ratio' && d.numerator && d.denominator) return `${one(d.numerator)} ÷ ${one(d.denominator)}`;
  return one(d as MetricPart);
}

export function MetricsPanel({ connection, schema }: { connection: string; schema: SchemaV2 }) {
  const metrics = useMetrics(connection);
  const [editing, setEditing] = useState<Metric | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Metric | null>(null);
  return (
    <Box>
      <Flex align="center" justify="space-between" mb={2}>
        <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
          {t('METRICS')}
        </Text>
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} onClick={() => setEditing('new')} data-testid="new-metric">
          {t('Metric')}
        </Button>
      </Flex>
      {(metrics.data ?? []).length === 0 ? (
        <Text fontSize="sm" color="mutedText">
          {t('None yet. A metric is a named calculation (e.g. “Revenue” = sum of total of paid orders) that everyone picks in Summarise, so it is computed the same way everywhere.')}
        </Text>
      ) : (
        <VStack align="stretch" spacing={1}>
          {metrics.data!.map((m) => (
            <Flex key={m.id} align="center" gap={2} border="1px solid" borderColor="lineColor" borderRadius="md" px={3} py={1.5} data-testid="metric-item">
              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight={600}>
                  ★ {m.name}
                  {m.translations?.ru?.name && (
                    <Text as="span" fontWeight={400} color="mutedText">
                      {' · '}
                      {m.translations.ru.name}
                    </Text>
                  )}
                </Text>
                <Text fontSize="xs" color="mutedText" noOfLines={1}>
                  {metricSummary(m.definition)} · {m.table}
                  {m.definition.where ? t(' · with a condition') : ''}
                  {m.description ? ` · ${m.description}` : ''}
                </Text>
                <GlossaryLinks target={{ metric: m.id }} />
              </Box>
              <IconButton aria-label={t('Change {name}', { name: m.name })} size="xs" variant="ghost" icon={<PencilIcon boxSize={3} />} onClick={() => setEditing(m)} />
              <IconButton aria-label={t('Archive {name}', { name: m.name })} size="xs" variant="ghost" icon={<TrashIcon boxSize={3} />} onClick={() => setArchiving(m)} />
            </Flex>
          ))}
        </VStack>
      )}
      {editing && <MetricDialog connection={connection} schema={schema} metric={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        isOpen={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('Archive this metric?')}
        confirmLabel={t('Archive')}
        body={t('“{name}” disappears from Summarise. Saved questions that use it keep working.', { name: archiving?.name })}
        onConfirm={async () => {
          if (archiving) await semantic.archiveMetric(archiving);
        }}
      />
    </Box>
  );
}

const NUMERIC_FNS: TotalFn[] = ['sum', 'avg'];

/** The column(s) of one total: one column, or for sums and averages several added up (good + scrapped pieces). */
function TotalColumns({ draft, onChange, options, testId }: { draft: TotalDraft; onChange: (d: TotalDraft) => void; options: PickOption[]; testId: string }) {
  if (!needsColumn(draft.fn)) return null;
  const columns = draft.columns.length ? draft.columns : [''];
  const addable = ADDABLE.includes(draft.fn);
  const types = NUMERIC_FNS.includes(draft.fn) ? (['number'] as ColumnType[]) : undefined;
  const set = (i: number, ref: string | null) => {
    const next = [...columns];
    if (ref === null) next.splice(i, 1);
    else next[i] = ref;
    onChange({ ...draft, columns: next, formula: undefined });
  };
  return (
    <Flex gap={1.5} align="center" wrap="wrap" flex={1} minW="200px">
      {(addable ? columns : columns.slice(0, 1)).map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <Text fontSize="sm" color="mutedText">+</Text>}
          <ColumnSelect options={options} value={c || undefined} onChange={(ref) => set(i, ref)} types={types} maxW="220px"
            aria-label={t('Column')} data-testid={i === 0 ? testId : `${testId}-${i + 1}`} />
          {i > 0 && <IconButton aria-label={t('Remove this column')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set(i, null)} />}
        </Fragment>
      ))}
      {addable && columns[0] !== '' && columns.length < 6 && (
        <Tooltip label={t('Add another column to it, row by row (e.g. good + scrapped pieces)')} hasArrow openDelay={300}>
          <IconButton aria-label={t('Add a column')} size="xs" variant="ghost" icon={<PlusIcon boxSize={3} />} onClick={() => onChange({ ...draft, columns: [...columns, ''], formula: undefined })} data-testid={`${testId}-add`} />
        </Tooltip>
      )}
      {draft.formula && !draft.columns.length && (
        <Text fontSize="xs" color="mutedText" w="100%">
          {t('Calculated with a formula; pick a column to replace it.')}
        </Text>
      )}
    </Flex>
  );
}

/** One side of a ratio: "Divide [Sum of] [Scrapped pieces]", with its own optional condition. */
function RatioSide({ label, draft, onChange, options, testId }: { label: string; draft: TotalDraft; onChange: (d: TotalDraft) => void; options: PickOption[]; testId: string }) {
  const [conditions, setConditions] = useState(draft.where.rules.length > 0);
  return (
    <Box>
      <Flex gap={2} align="center" wrap="wrap">
        <Text fontSize="sm" fontWeight={600} minW="64px">
          {label}
        </Text>
        <Select size="sm" w="auto" value={draft.fn} onChange={(e) => onChange({ ...draft, fn: e.target.value as TotalFn })} aria-label={t('Calculation')} data-testid={`${testId}-fn`}>
          {AGGREGATES.map((a) => (
            <option key={a.fn} value={a.fn}>
              {a.label}
            </option>
          ))}
        </Select>
        <TotalColumns draft={draft} onChange={onChange} options={options} testId={`${testId}-column`} />
        {!conditions && (
          <Button size="xs" variant="link" onClick={() => setConditions(true)} data-testid={`${testId}-only`}>
            {t('Only some rows…')}
          </Button>
        )}
      </Flex>
      {conditions && (
        <Box pl={{ base: 0, sm: '72px' }} mt={1.5}>
          <FilterEditor group={draft.where} onChange={(where) => onChange({ ...draft, where })} options={options} emptyText={t('Every row counts.')} testId={`${testId}-where`} />
        </Box>
      )}
    </Box>
  );
}

/** The metric on all rows of its table, run like a question while the dialog changes (M12). */
function MetricExample({ spec, format, ratio }: { spec: Record<string, unknown> | null; format: ColumnFormat; ratio: boolean }) {
  const { state, run } = useQueryRun();
  const json = spec ? JSON.stringify(spec) : '';
  useEffect(() => {
    if (!json) return;
    const timer = window.setTimeout(
      () => void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec: JSON.parse(json), wait_ms: START_WAIT_MS })).data),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [json, run]);
  if (!json) return null;
  let text: string;
  let color = 'mutedText';
  if (state.error && (state.status === 'error' || state.status === 'failed')) {
    text = state.error;
    color = 'orange.400';
  } else if (!state.result || state.phase === 'running') {
    text = t('Working out an example…');
  } else {
    const { value, top, bottom } = exampleValues(state.result.rows[0]);
    const plain = (v: number | null) => (v === null ? '—' : formatNumber(v, {}));
    if (value !== null && ratio) text = t('On all rows of the table now: {value} = {top} ÷ {bottom}', { value: formatNumber(value, format), top: plain(top), bottom: plain(bottom) });
    else if (value !== null) text = t('On all rows of the table now: {value}', { value: formatNumber(value, format) });
    else if (ratio && bottom === 0) text = t('On all rows of the table now: no value, because the second total is 0');
    else text = t('On all rows of the table now: no value (no row counts)');
  }
  return (
    <Text fontSize="sm" color={color} data-testid="metric-example">
      {text}
    </Text>
  );
}

function MetricDialog({ connection, schema, metric, onClose }: { connection: string; schema: SchemaV2; metric: Metric | null; onClose: () => void }) {
  const def = metric?.definition;
  const [name, setName] = useState(metric?.name ?? '');
  const [description, setDescription] = useState(metric?.description ?? '');
  const [table, setTable] = useState(metric?.table ?? '');
  const [kind, setKind] = useState<'total' | 'ratio'>(def?.fn === 'ratio' ? 'ratio' : 'total');
  const [total, setTotal] = useState<TotalDraft>(() => (def && def.fn !== 'ratio' ? draftOf(def as MetricPart, metric!.table) : draftOf(undefined, '', 'sum')));
  const [numerator, setNumerator] = useState<TotalDraft>(() => draftOf(def?.numerator, metric?.table ?? '', 'sum'));
  const [denominator, setDenominator] = useState<TotalDraft>(() => draftOf(def?.denominator, metric?.table ?? '', 'sum'));
  const [where, setWhere] = useState<FilterGroup>(def?.where ?? emptyGroup());
  const [format, setFormat] = useState<ColumnFormat>(metric?.format ?? {});
  const [translations, setTranslations] = useState<Translations | null>(metric?.translations ?? null);
  const options = useMemo(
    () =>
      (schema.tables.find((tb) => tb.name === table)?.columns ?? [])
        .filter((c) => c.type !== 'binary')
        .map((c) => ({ ref: `${table}.${c.name}`, label: nameOf(c.name, c), type: c.type })),
    [schema, table],
  );
  const tables = useMemo(() => byLabel(schema.tables), [schema]);
  const ready = !!table && definitionReady(kind, total, numerator, denominator);
  const definition = definitionOf(kind, total, numerator, denominator, where);
  const example = ready ? exampleSpec(connection, table, definition) : null;
  const pickTable = (next: string) => {
    setTable(next);
    const reset = (d: TotalDraft) => ({ ...d, columns: [], formula: undefined, where: emptyGroup() });
    setTotal(reset);
    setNumerator(reset);
    setDenominator(reset);
    setWhere(emptyGroup());
  };
  const pickCalculation = (value: string) => {
    if (value !== 'ratio') {
      setKind('total');
      setTotal((d) => ({ ...d, fn: value as TotalFn }));
      return;
    }
    setKind('ratio');
    // a share is the usual ratio (scrap rate, % on time): shown as percent unless a format was chosen
    if (!format.style || format.style === 'auto') setFormat((f) => ({ ...f, style: 'percent' }));
    if (!draftReady(numerator) && total.columns.length) setNumerator({ ...total, where: emptyGroup() });
  };
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={metric ? t('Change “{name}”', { name: metric.name }) : t('New metric')}
      submitLabel={t('Save')}
      size="xl"
      canSubmit={!!name.trim() && ready}
      onSubmit={() =>
        semantic.saveMetric(
          { name: name.trim(), description: description.trim() || null, connection, table, definition, format: cleanFormat(format), translations },
          metric?.id,
        )
      }
    >
      <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
        <FormControl isRequired>
          <FormLabel fontSize="sm">{t('Name')}</FormLabel>
          <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('Revenue')} data-testid="metric-name" />
        </FormControl>
        <FormControl isRequired>
          <FormLabel fontSize="sm">{t('Table')}</FormLabel>
          <Select size="sm" value={table} placeholder={t('Pick a table…')} onChange={(e) => pickTable(e.target.value)} data-testid="metric-table">
            {tables.map((tb) => (
              <option key={tb.name} value={tb.name}>
                {tb.showTechnical ? `${tb.label} (${tb.name})` : tb.name}
              </option>
            ))}
          </Select>
        </FormControl>
      </SimpleGrid>
      <Flex align="flex-end" gap={2} wrap="wrap">
        <FormControl maxW="260px">
          <FormLabel fontSize="sm">{t('Calculation')}</FormLabel>
          <Select size="sm" value={kind === 'ratio' ? 'ratio' : total.fn} onChange={(e) => pickCalculation(e.target.value)} data-testid="metric-fn">
            {AGGREGATES.map((a) => (
              <option key={a.fn} value={a.fn}>
                {a.label}
              </option>
            ))}
            <option value="ratio">{t('Divide one total by another')}</option>
          </Select>
        </FormControl>
        {kind === 'total' && needsColumn(total.fn) && (
          <FormControl flex={1} minW="220px">
            <FormLabel fontSize="sm">{t('Column')}</FormLabel>
            <TotalColumns draft={total} onChange={setTotal} options={options} testId="metric-column" />
          </FormControl>
        )}
      </Flex>
      {kind === 'ratio' && (
        <VStack align="stretch" spacing={2} border="1px solid" borderColor="lineColor" borderRadius="md" p={3} data-testid="metric-ratio">
          <RatioSide label={t('Divide')} draft={numerator} onChange={setNumerator} options={options} testId="metric-num" />
          <RatioSide label={t('by')} draft={denominator} onChange={setDenominator} options={options} testId="metric-den" />
          <Text fontSize="xs" color="mutedText">
            {t('Both totals are worked out over the same rows of each group (each line, each month …), so the result stays right however a question splits it. Example: scrap rate = sum of scrapped pieces ÷ sum of good + scrapped pieces.')}
          </Text>
        </VStack>
      )}
      <MetricExample spec={example} format={cleanFormat(format) ?? {}} ratio={kind === 'ratio'} />
      {table && (
        <Box>
          <Text fontSize="sm" fontWeight={500} mb={1}>
            {kind === 'ratio' ? t('Only rows where… (for both totals)') : t('Only rows where…')}
          </Text>
          <FilterEditor group={where} onChange={setWhere} options={options} emptyText={t('Every row counts.')} testId="metric-where" />
        </Box>
      )}
      <FormatFields format={format} onChange={setFormat} />
      <FormControl>
        <FormLabel fontSize="sm">{t('Description')}</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder={t('How it is defined, who owns it')} />
      </FormControl>
      <RussianFields translations={translations} onChange={setTranslations} nameField="name" nameMax={120} testId="metric-ru" />
    </DialogShell>
  );
}
