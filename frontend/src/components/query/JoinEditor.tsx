import { Badge, Button, Flex, HStack, IconButton, Input, Menu, MenuButton, MenuDivider, MenuGroup, MenuItem, MenuList, Select, Text, Tooltip, VStack } from '@chakra-ui/react';
import { LinkIcon, PlusIcon, XIcon } from '../../icons';
import { columnOptions, queryTables } from '../../query/draft';
import type { SchemaInfo } from '../../query/draft';
import { joinSuggestions } from '../../query/joins';
import type { Join, JoinType, QuerySpec } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import { FriendlyName } from '../FriendlyName';
import { byLabel, descriptionIn, labelIn, nameOf } from '../../lib/names';
import { t } from '../../i18n/index.ts';

// plain words first (M11); the SQL name of each kind of join is in its hint
const TYPES: { value: JoinType; label: string; hint: string }[] = [
  { value: 'left', label: t('Keep all rows'), hint: t('Keep every row of the data so far, add matches where they exist (left join)') },
  { value: 'inner', label: t('Only matching rows'), hint: t('Only rows that have a match on both sides (inner join)') },
  { value: 'full', label: t('All rows of both'), hint: t('Every row from both sides (full join; not on MySQL / MariaDB)') },
];

interface JoinEditorProps {
  spec: QuerySpec;
  schema: SchemaInfo;
  onChange: (joins: Join[]) => void;
  openMenu?: boolean; // the step was just opened from "More steps": show the tables at once
}

export function JoinEditor({ spec, schema, onChange, openMenu = false }: JoinEditorProps) {
  const joins = spec.joins ?? [];
  const inQuery = queryTables(spec, schema);
  const suggestions = joinSuggestions(
    schema.relationships,
    schema.tables.map((t) => t.name),
    inQuery.map((t) => t.table),
  );
  const suggested = new Set(suggestions.map((s) => s.table));
  const picks = byLabel(schema.tables); // data model names (M11)
  const pick = new Map(picks.map((l) => [l.name, l]));
  const others = picks.filter((l) => !suggested.has(l.name));
  const label = (table: string) => labelIn(schema.tables, table);

  const update = (i: number, join: Join | null) => {
    const next = [...joins];
    if (join === null) next.splice(i, 1);
    else next[i] = join;
    onChange(next);
  };

  const addAuto = (table: string) => onChange([...joins, { table, type: 'left' }]);
  const addCustom = (table: string) => {
    const taken = new Set(inQuery.map((t) => t.alias));
    let alias = table;
    for (let n = 2; taken.has(alias); n++) alias = `${table}_${n}`;
    onChange([...joins, { table, type: 'left', alias, on: [{ left: '', right: '' }] }]);
  };

  return (
    <VStack align="stretch" spacing={2}>
      {joins.map((join, i) => {
        const before = columnOptions({ ...spec, joins: joins.slice(0, i), expressions: [] }, schema);
        const alias = join.alias || join.table;
        const target = schema.tables.find((t) => t.name === join.table);
        const rightOptions = (target?.columns ?? []).map((c) => ({ ref: `${alias}.${c.name}`, label: nameOf(c.name, c), type: c.type }));
        const via = queryTables({ ...spec, joins: joins.slice(0, i + 1) }, schema).filter((t) => t.via && !inQueryBefore(spec, schema, i).includes(t.table));
        const custom = (join.on?.length ?? 0) > 0;
        return (
          <Flex key={i} direction="column" gap={2} p={2} borderRadius="lg" bg="chipBg" data-testid="join-row">
            <Flex gap={2} align="center" wrap="wrap">
              <LinkIcon boxSize={3.5} color="brand.300" />
              <Text fontWeight={700} fontSize="sm" title={descriptionIn(schema.tables, join.table) ?? undefined}>
                {label(join.table)}
                {join.alias && join.alias !== join.table && (
                  <Text as="span" color="faintText" fontWeight={400}>
                    {' '}
                    {t('as {alias}', { alias: join.alias })}
                  </Text>
                )}
              </Text>
              <Select size="xs" maxW="170px" value={join.type} onChange={(e) => update(i, { ...join, type: e.target.value as JoinType })} aria-label={t('Join type')} title={TYPES.find((x) => x.value === join.type)?.hint}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value} title={t.hint}>
                    {t.label}
                  </option>
                ))}
              </Select>
              {!custom && (
                <Tooltip label={t('Rows are matched by the links (foreign keys) declared in the database')} hasArrow>
                  <Badge bg="panelBg" color="mutedText" textTransform="none">
                    {via.length > 0 ? t('automatic · via {tables}', { tables: via.map((v) => label(v.table)).join(', ') }) : t('automatic')}
                  </Badge>
                </Tooltip>
              )}
              <IconButton aria-label={t('Remove join')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => update(i, null)} ml="auto" />
            </Flex>
            {custom && (
              <VStack align="stretch" spacing={1} pl={6}>
                {(join.on ?? []).map((pair, p) => (
                  <HStack key={p} spacing={2}>
                    <ColumnSelect options={before} value={pair.left || undefined} onChange={(left) => update(i, { ...join, on: join.on!.map((x, k) => (k === p ? { ...x, left } : x)) })} aria-label={t('Column so far')} />
                    <Text fontSize="sm">=</Text>
                    <ColumnSelect options={rightOptions} value={pair.right || undefined} onChange={(right) => update(i, { ...join, on: join.on!.map((x, k) => (k === p ? { ...x, right } : x)) })} aria-label={t('Column of the joined table')} />
                    {join.on!.length > 1 && (
                      <IconButton aria-label={t('Remove condition')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => update(i, { ...join, on: join.on!.filter((_, k) => k !== p) })} />
                    )}
                  </HStack>
                ))}
                <HStack spacing={2}>
                  <Button size="xs" variant="ghost" leftIcon={<PlusIcon boxSize={3} />} onClick={() => update(i, { ...join, on: [...(join.on ?? []), { left: '', right: '' }] })}>
                    {t('Match another column')}
                  </Button>
                  <Input size="xs" maxW="140px" value={join.alias ?? ''} placeholder={t('alias')} onChange={(e) => update(i, { ...join, alias: e.target.value.replace(/[^A-Za-z0-9_]/g, '') || undefined })} aria-label={t('Alias')} />
                </HStack>
              </VStack>
            )}
          </Flex>
        );
      })}

      <Menu isLazy defaultIsOpen={openMenu && joins.length === 0}>
        <MenuButton as={Button} size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" data-testid="add-join">
          {joins.length ? t('Another table') : t('Pick a table')}
        </MenuButton>
        <MenuList maxH="360px" overflowY="auto" fontSize="sm">
          {suggestions.length > 0 && (
            <MenuGroup title={t('Linked tables (matched automatically)')}>
              {suggestions.map((s) => (
                <MenuItem key={s.table} onClick={() => addAuto(s.table)} data-testid={`join-suggestion-${s.table}`}>
                  <Flex direction="column">
                    <FriendlyName label={label(s.table)} name={s.table} description={pick.get(s.table)?.description} showTechnical={pick.get(s.table)?.showTechnical} />
                    {s.via.length > 0 && (
                      <Text fontSize="xs" color="faintText">
                        {t('via {tables}', { tables: s.via.map(label).join(' → ') })}
                      </Text>
                    )}
                  </Flex>
                </MenuItem>
              ))}
            </MenuGroup>
          )}
          {suggestions.length > 0 && others.length > 0 && <MenuDivider />}
          {others.length > 0 && (
            <MenuGroup title={t('Other tables (you pick the matching columns)')}>
              {others.map((o) => (
                <MenuItem key={o.name} onClick={() => addCustom(o.name)}>
                  <FriendlyName label={o.label} name={o.name} description={o.description} showTechnical={o.showTechnical} />
                </MenuItem>
              ))}
            </MenuGroup>
          )}
        </MenuList>
      </Menu>
    </VStack>
  );
}

function inQueryBefore(spec: QuerySpec, schema: SchemaInfo, index: number): string[] {
  return queryTables({ ...spec, joins: (spec.joins ?? []).slice(0, index) }, schema).map((t) => t.table);
}
