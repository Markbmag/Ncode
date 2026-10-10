import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge, Box, Button, ButtonGroup, Flex, HStack, Input, Menu, MenuButton, MenuItem, MenuList, Select, Skeleton, Text, Tooltip,
  VStack, useBreakpointValue,
} from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import { ResultView } from '../components/data/ResultView';
import { NoConnectionsState } from '../components/EmptyStates';
import { EngineBadge } from '../components/EngineBadge';
import { Split } from '../components/layout/Split';
import { CodeEditor } from '../components/sql/CodeEditor';
import type { CodeEditorHandle } from '../components/sql/CodeEditor';
import { SchemaTree } from '../components/sql/SchemaTree';
import { CheckIcon, ChevronDownIcon, RefreshIcon, SparklesIcon } from '../icons';
import { queryKeys } from '../lib/queryClient';
import { loadJson, saveJson } from '../lib/storage';
import { findParams, quoteIdent } from '../query/dialect';
import { prettySql } from '../query/prettySql';
import { addHistory, loadHistory } from '../query/sqlHistory';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { useSchema } from '../query/useSchema';
import { useWorkspace } from '../workspace/useWorkspace';

interface Incoming {
  connection?: string;
  sql?: string;
}

const LIMITS = [100, 1000, 2000, 10000];
const draftKey = (connection: string) => `ncode_sql_${connection}`;

/** SQL editor. "Open in SQL editor" from a question arrives here with { connection, sql } in the route state. */
export default function SqlPage() {
  const ws = useWorkspace();
  const location = useLocation();
  const incoming = (location.state ?? null) as Incoming | null;
  const { selectConnection, activeKey } = ws;

  useEffect(() => {
    if (incoming?.connection && incoming.connection !== activeKey) selectConnection(incoming.connection);
  }, [incoming?.connection, activeKey, selectConnection]);

  if (!ws.loaded) return <Skeleton h="400px" borderRadius="2xl" />;
  if (!ws.active) return <NoConnectionsState isAdmin={ws.isAdmin} onAdd={ws.openAddConnection} />;
  const initial = incoming?.sql && (!incoming.connection || incoming.connection === activeKey) ? incoming.sql : null;
  return <SqlWorkbench key={activeKey} connection={activeKey} initialSql={initial} />;
}

function SqlWorkbench({ connection, initialSql }: { connection: string; initialSql: string | null }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const engine = ws.active?.engine;
  const schemaQuery = useSchema(connection);
  const editor = useRef<CodeEditorHandle | null>(null);
  const [text, setText] = useState(() => initialSql ?? loadJson<string>(draftKey(connection), ''));
  const [params, setParams] = useState<Record<string, { value: string; number: boolean }>>({});
  const [limit, setLimit] = useState(() => loadJson<number>('ncode_sql_limit', 2000));
  const [smartDates, setSmartDates] = useState(() => loadJson('ncode_smart_dates', false));
  const [check, setCheck] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const { state, run, cancel } = useQueryRun();
  const vertical = useBreakpointValue({ base: true, lg: false }) ?? false;

  // The SQL handed over from a question is consumed once (a reload keeps the draft instead).
  useEffect(() => {
    if (initialSql) navigate('.', { replace: true, state: null });
  }, [initialSql, navigate]);
  useEffect(() => saveJson(draftKey(connection), text), [connection, text]);
  useEffect(() => saveJson('ncode_sql_limit', limit), [limit]);
  useEffect(() => saveJson('ncode_smart_dates', smartDates), [smartDates]);

  // Ask the server's guard whether this SQL may run (shown before running).
  useEffect(() => {
    if (!text.trim()) return;
    const timer = window.setTimeout(() => {
      http
        .post<{ ok: boolean; error: string | null }>('/api/query/sql/check', { connection, sql: text })
        .then((res) => setCheck(res.data))
        .catch(() => setCheck(null));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [text, connection]);

  const paramNames = useMemo(() => findParams(text), [text]);
  const autocomplete = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const t of schemaQuery.data?.tables ?? []) out[t.name] = t.columns.map((c) => c.name);
    return out;
  }, [schemaQuery.data]);
  const history = useMemo(() => loadHistory(connection).slice(0, 15), [connection, historyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const execute = useCallback(
    (sql: string) => {
      if (!sql.trim()) return;
      const values: Record<string, string | number | null> = {};
      for (const name of findParams(sql)) {
        const p = params[name];
        values[name] = p ? (p.number && p.value.trim() !== '' && !Number.isNaN(Number(p.value)) ? Number(p.value) : p.value) : null;
      }
      addHistory(connection, sql);
      setHistoryVersion((v) => v + 1);
      void run(async () => (await http.post<TaskSnapshot>('/api/query/sql', { connection, sql, params: values, limit, wait_ms: START_WAIT_MS })).data);
    },
    [connection, params, limit, run],
  );

  const onRun = useCallback((sql: string) => execute(sql), [execute]);

  const format = () => {
    const pretty = prettySql(text, engine);
    editor.current?.setText(pretty);
  };

  const quote = (name: string) => quoteIdent(name, engine);
  const reloadSchema = () => {
    void http.get(`/api/connections/${connection}/schema`, { params: { refresh: true } }).then((res) => queryClient.setQueryData(queryKeys.schema(connection), res.data));
  };

  const tree = (
    <Box h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      <SchemaTree
        tables={schemaQuery.data?.tables}
        loading={schemaQuery.isPending}
        error={schemaQuery.isError ? apiErrorMessage(schemaQuery.error, 'Could not read the structure') : null}
        onInsert={(t) => editor.current?.insert(t)}
        onInsertSelect={(table) => editor.current?.insert(`SELECT *\nFROM ${quote(table)}\n`)}
        onReload={reloadSchema}
        quote={quote}
      />
    </Box>
  );

  const editorPane = (
    <Flex direction="column" h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      <Box flex={1} minH="140px">
        <CodeEditor value={text} onChange={setText} onRun={onRun} engine={engine} schema={autocomplete} editorRef={editor} />
      </Box>
      {paramNames.length > 0 && (
        <Flex gap={3} px={3} py={2} borderTop="1px solid" borderColor="lineColor" wrap="wrap" data-testid="sql-params">
          {paramNames.map((name) => {
            const p = params[name] ?? { value: '', number: false };
            return (
              <HStack key={name} spacing={1}>
                <Text fontSize="xs" fontFamily="mono" color="mutedText">{`{{${name}}}`}</Text>
                <Input
                  size="xs"
                  maxW="140px"
                  value={p.value}
                  onChange={(e) => setParams((prev) => ({ ...prev, [name]: { ...p, value: e.target.value } }))}
                  aria-label={`Value of ${name}`}
                />
                <ButtonGroup size="xs" isAttached>
                  <Button variant={p.number ? 'subtle' : 'brand'} onClick={() => setParams((prev) => ({ ...prev, [name]: { ...p, number: false } }))}>
                    Text
                  </Button>
                  <Button variant={p.number ? 'brand' : 'subtle'} onClick={() => setParams((prev) => ({ ...prev, [name]: { ...p, number: true } }))}>
                    Number
                  </Button>
                </ButtonGroup>
              </HStack>
            );
          })}
        </Flex>
      )}
      <Flex align="center" gap={2} px={3} py={2} borderTop="1px solid" borderColor="lineColor" wrap="wrap">
        <Button size="sm" leftIcon={<RefreshIcon boxSize={4} />} onClick={() => execute(text)} isDisabled={!text.trim()} data-testid="run-sql">
          Run
        </Button>
        <Text fontSize="xs" color="faintText">
          Ctrl/Cmd + Enter · runs the selection if there is one
        </Text>
        <Box flex={1} />
        {text.trim() && check && (
          <Tooltip label={check.ok ? 'This query passes the read-only check' : check.error} hasArrow>
            <Badge colorScheme={check.ok ? 'green' : 'red'} display="flex" alignItems="center" gap={1} maxW="320px" data-testid="sql-check">
              {check.ok ? <CheckIcon boxSize={3} /> : null}
              <Text as="span" noOfLines={1}>
                {check.ok ? 'read-only' : check.error}
              </Text>
            </Badge>
          </Tooltip>
        )}
        <Select size="xs" maxW="110px" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Row limit">
          {LIMITS.filter((l) => l <= (ws.limits.query_max_rows ?? 10000)).map((l) => (
            <option key={l} value={l}>
              {l.toLocaleString()} rows
            </option>
          ))}
        </Select>
        <Button size="xs" variant="subtle" leftIcon={<SparklesIcon boxSize={3} />} onClick={format} isDisabled={!text.trim()}>
          Format
        </Button>
        <Menu isLazy>
          <MenuButton as={Button} size="xs" variant="subtle" rightIcon={<ChevronDownIcon boxSize={3} />} isDisabled={history.length === 0}>
            History
          </MenuButton>
          <MenuList maxW="480px" maxH="360px" overflowY="auto">
            {history.map((h) => (
              <MenuItem key={h.at} onClick={() => editor.current?.setText(h.sql)}>
                <VStack align="flex-start" spacing={0} w="100%">
                  <Text fontFamily="mono" fontSize="xs" noOfLines={2} whiteSpace="pre-wrap">
                    {h.sql}
                  </Text>
                  <Text fontSize="2xs" color="faintText">
                    {new Date(h.at).toLocaleString()}
                  </Text>
                </VStack>
              </MenuItem>
            ))}
          </MenuList>
        </Menu>
      </Flex>
    </Flex>
  );

  const results = (
    <Box h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      <ResultView
        state={state}
        onCancel={cancel}
        smartDates={smartDates}
        onSmartDates={setSmartDates}
        filename={`${ws.active?.label ?? connection}_sql`}
        empty={
          <Flex h="100%" align="center" justify="center" p={6} color="mutedText" fontSize="sm" textAlign="center">
            Write a SELECT and press Ctrl/Cmd + Enter. Only read-only queries run.
          </Flex>
        }
      />
    </Box>
  );

  return (
    <Flex direction="column" h="100%" gap={3}>
      <Flex align="center" gap={3}>
        {engine && <EngineBadge engine={engine} size={32} />}
        <Box>
          <Text fontSize="lg" fontWeight={700} lineHeight="1.2">
            SQL editor
          </Text>
          <Text fontSize="xs" color="mutedText">
            {ws.active?.label} · read-only
          </Text>
        </Box>
      </Flex>
      <Box flex={1} minH={0}>
        {vertical ? (
          <VStack align="stretch" spacing={3}>
            <Box h="320px">{editorPane}</Box>
            <Box h="60vh">{results}</Box>
            <Box h="320px">{tree}</Box>
          </VStack>
        ) : (
          <Split
            id="sql-split"
            defaultFirst="22%"
            minFirst="14%"
            minSecond="50%"
            first={tree}
            second={<Split id="sql-split-v" orientation="vertical" defaultFirst="42%" minFirst="20%" minSecond="20%" first={editorPane} second={results} />}
          />
        )}
      </Box>
    </Flex>
  );
}
