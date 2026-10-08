import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Flex, HStack, IconButton, Select, Skeleton, Text, VStack, useDisclosure, useToast } from '@chakra-ui/react';
import { apiErrorMessage, http } from './api';
import type { Connection, ConnectionDetails, EngineOption, MatchMode, TableInfo, User } from './api';
import { ColorModeButton, Logo, Sidebar } from './components/Sidebar';
import { ConnectionModal } from './components/ConnectionModal';
import { EngineBadge } from './components/EngineBadge';
import { NoConnectionsState, NoResultsState, ReadyState } from './components/EmptyStates';
import { ResultsPanel } from './components/ResultsPanel';
import { ScopeModal } from './components/ScopeModal';
import { SearchBar } from './components/SearchBar';
import { SearchProgress } from './components/SearchProgress';
import { useSearch } from './hooks/useSearch';
import { LogOutIcon } from './icons';
import { engineMeta } from './lib/engines';
import { loadJson, saveJson } from './lib/storage';

interface Prefs {
  matchMode: MatchMode;
  caseSensitive: boolean;
  includeNumbers: boolean;
  rowLimit: number;
}

interface Scope {
  tables: string[]; // exact names; empty = every table
  exclude: string; // comma-separated glob patterns
}

type TablesEntry = { tables: TableInfo[] } | { error: string };

const DEFAULT_PREFS: Prefs = { matchMode: 'contains', caseSensitive: false, includeNumbers: false, rowLimit: 25 };
const EMPTY_SCOPE: Scope = { tables: [], exclude: '' };

const splitPatterns = (text: string): string[] =>
  text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

interface WorkspaceProps {
  user: User;
  onLogout: () => void;
}

export default function Workspace({ user, onLogout }: WorkspaceProps) {
  const isAdmin = user.role === 'admin';
  const toast = useToast();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [engines, setEngines] = useState<EngineOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(() => loadJson<string>('ncode_active', ''));
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...loadJson<Partial<Prefs>>('ncode_prefs', {}) }));
  const [scopes, setScopes] = useState<Record<string, Scope>>(() => loadJson<Record<string, Scope>>('ncode_scopes', {}));
  const [phrase, setPhrase] = useState('');
  const [tablesByKey, setTablesByKey] = useState<Record<string, TablesEntry>>({});
  const [searchCount, setSearchCount] = useState(0);
  const [editKey, setEditKey] = useState<string | null>(null);

  const connectionModal = useDisclosure();
  const scopeModal = useDisclosure();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { state, start, cancel, reset } = useSearch(onLogout);

  // ---------------------------------------------------------------- persistence
  useEffect(() => saveJson('ncode_active', activeKey), [activeKey]);
  useEffect(() => saveJson('ncode_prefs', prefs), [prefs]);
  useEffect(() => saveJson('ncode_scopes', scopes), [scopes]);

  // ---------------------------------------------------------------- initial load
  useEffect(() => {
    let cancelled = false;
    Promise.all([http.get<Connection[]>('/api/connections'), http.get<EngineOption[]>('/api/engines')])
      .then(([conns, engineList]) => {
        if (cancelled) return;
        setConnections(conns.data);
        setEngines(engineList.data);
        setActiveKey((current) => (conns.data.some((c) => c.key === current) ? current : (conns.data[0]?.key ?? '')));
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({ title: 'Could not load your databases', description: apiErrorMessage(error, ''), status: 'error' });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const reloadConnections = useCallback(async (preferKey?: string) => {
    const res = await http.get<Connection[]>('/api/connections');
    setConnections(res.data);
    setActiveKey((current) => {
      const wanted = preferKey ?? current;
      return res.data.some((c) => c.key === wanted) ? wanted : (res.data[0]?.key ?? '');
    });
  }, []);

  // ---------------------------------------------------------------- table list of the active database
  useEffect(() => {
    if (!activeKey || tablesByKey[activeKey]) return;
    let cancelled = false;
    http
      .get<{ tables: TableInfo[] }>(`/api/connections/${activeKey}/tables`)
      .then((res) => {
        if (!cancelled) setTablesByKey((prev) => ({ ...prev, [activeKey]: { tables: res.data.tables } }));
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setTablesByKey((prev) => ({
            ...prev,
            [activeKey]: { error: apiErrorMessage(error, 'Could not read the database structure') },
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeKey, tablesByKey]);

  const forgetTables = useCallback((key: string) => {
    setTablesByKey((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // ---------------------------------------------------------------- keyboard: "/" focuses the search box
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      if (typing || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---------------------------------------------------------------- derived values
  const active = connections.find((c) => c.key === activeKey);
  const scope = scopes[activeKey] ?? EMPTY_SCOPE;
  const excludePatterns = useMemo(() => splitPatterns(scope.exclude), [scope.exclude]);
  const entry = tablesByKey[activeKey];
  const tableList = entry && 'tables' in entry ? entry.tables : null;
  const tablesError = entry && 'error' in entry ? entry.error : null;

  let scopeLabel = 'All tables';
  if (scope.tables.length > 0) scopeLabel = `${scope.tables.length}${tableList ? ` of ${tableList.length}` : ''} tables`;
  else if (tableList) scopeLabel = `All ${tableList.length} tables`;
  if (excludePatterns.length > 0) scopeLabel += ` · ${excludePatterns.length} skipped`;
  const scopeCustom = scope.tables.length > 0 || excludePatterns.length > 0;

  // ---------------------------------------------------------------- handlers
  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((prev) => ({ ...prev, [key]: value }));

  const selectConnection = (key: string) => {
    if (key === activeKey) return;
    setActiveKey(key);
    reset();
  };

  const openAdd = () => {
    setEditKey(null);
    http
      .get<EngineOption[]>('/api/engines')
      .then((res) => setEngines(res.data))
      .catch(() => undefined); // keep the list we already have
    connectionModal.onOpen();
  };

  const openEdit = (key: string) => {
    setEditKey(key);
    connectionModal.onOpen();
  };

  const handleSaved = async (details: ConnectionDetails) => {
    forgetTables(details.key);
    reset();
    try {
      await reloadConnections(details.key);
    } catch (error) {
      toast({ title: 'Saved, but the list could not be refreshed', description: apiErrorMessage(error, ''), status: 'warning' });
    }
  };

  const handleDeleted = async (key: string) => {
    forgetTables(key);
    setScopes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    reset();
    try {
      await reloadConnections();
    } catch (error) {
      toast({ title: 'Removed, but the list could not be refreshed', description: apiErrorMessage(error, ''), status: 'warning' });
    }
  };

  const applyScope = (tables: string[], exclude: string) => {
    setScopes((prev) => ({ ...prev, [activeKey]: { tables, exclude } }));
    scopeModal.onClose();
  };

  const startSearch = () => {
    const trimmed = phrase.trim();
    if (!trimmed || !activeKey) return;
    setSearchCount((count) => count + 1);
    void start({
      connection: activeKey,
      phrase: trimmed,
      matchMode: prefs.matchMode,
      caseSensitive: prefs.caseSensitive,
      includeNumbers: prefs.includeNumbers,
      rowLimit: prefs.rowLimit,
      tables: scope.tables,
      excludePatterns,
    });
  };

  // ---------------------------------------------------------------- render
  const running = state.phase === 'running';
  const noResultsAtAll =
    state.phase === 'done' && state.status === 'completed' && state.results.length === 0 && state.errors.length === 0;

  let content: ReactNode;
  if (!loaded) {
    content = (
      <VStack align="stretch" spacing={4}>
        <Skeleton h="120px" borderRadius="2xl" />
        <Skeleton h="280px" borderRadius="2xl" />
      </VStack>
    );
  } else if (connections.length === 0) {
    content = <NoConnectionsState isAdmin={isAdmin} onAdd={openAdd} />;
  } else if (running) {
    content = (
      <SearchProgress
        phrase={state.params?.phrase ?? ''}
        processed={state.progress.processed}
        total={state.progress.total}
        found={state.progress.found}
        starting={state.status === 'starting' || state.status === 'pending'}
      />
    );
  } else if (noResultsAtAll && state.params) {
    content = (
      <NoResultsState
        phrase={state.params.phrase}
        matchMode={state.params.matchMode}
        caseSensitive={state.params.caseSensitive}
        includeNumbers={state.params.includeNumbers}
        tablesSearched={Math.max(0, state.progress.processed - state.skipped)}
      />
    );
  } else if (state.phase === 'done') {
    content = <ResultsPanel key={searchCount} state={state} connectionLabel={active?.label ?? ''} />;
  } else {
    content = <ReadyState connectionLabel={active?.label ?? 'your database'} scopeLabel={scopeLabel} />;
  }

  return (
    <Flex minH="100vh" align="flex-start">
      <Sidebar
        connections={connections}
        activeKey={activeKey}
        onSelect={selectConnection}
        isAdmin={isAdmin}
        onAdd={openAdd}
        onEdit={openEdit}
        user={user}
        onLogout={onLogout}
      />

      <Box flex={1} minW={0}>
        <Flex
          display={{ base: 'flex', md: 'none' }}
          align="center"
          justify="space-between"
          px={4}
          py={3}
          bg="sidebarBg"
          borderBottom="1px solid"
          borderColor="lineColor"
        >
          <Logo />
          <HStack>
            <ColorModeButton />
            <IconButton aria-label="Sign out" size="sm" icon={<LogOutIcon boxSize={4} />} onClick={onLogout} />
          </HStack>
        </Flex>

        <Box maxW="1180px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 5, md: 8 }}>
          <VStack align="stretch" spacing={6}>
            {connections.length > 0 && (
              <Select
                display={{ base: 'block', md: 'none' }}
                value={activeKey}
                onChange={(e) => selectConnection(e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}

            {active && (
              <HStack spacing={3} display={{ base: 'none', md: 'flex' }}>
                <EngineBadge engine={active.engine} size={40} />
                <Box>
                  <Text fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" lineHeight="1.1">
                    {active.label}
                  </Text>
                  <Text fontSize="sm" color="mutedText">
                    {engineMeta(active.engine).label} · {active.database}
                    {tableList && ` · ${tableList.length} tables`}
                  </Text>
                </Box>
              </HStack>
            )}

            <SearchBar
              inputRef={inputRef}
              phrase={phrase}
              onPhraseChange={setPhrase}
              onSubmit={startSearch}
              onCancel={() => void cancel()}
              running={running}
              disabled={!active || !loaded}
              matchMode={prefs.matchMode}
              onMatchMode={(v) => setPref('matchMode', v)}
              caseSensitive={prefs.caseSensitive}
              onCaseSensitive={(v) => setPref('caseSensitive', v)}
              includeNumbers={prefs.includeNumbers}
              onIncludeNumbers={(v) => setPref('includeNumbers', v)}
              rowLimit={prefs.rowLimit}
              onRowLimit={(v) => setPref('rowLimit', v)}
              scopeLabel={scopeLabel}
              scopeCustom={scopeCustom}
              onOpenScope={scopeModal.onOpen}
            />

            {content}
          </VStack>
        </Box>
      </Box>

      <ConnectionModal
        isOpen={connectionModal.isOpen}
        onClose={connectionModal.onClose}
        engines={engines}
        editKey={editKey}
        onSaved={(details) => void handleSaved(details)}
        onDeleted={(key) => void handleDeleted(key)}
      />
      <ScopeModal
        isOpen={scopeModal.isOpen}
        onClose={scopeModal.onClose}
        connectionLabel={active?.label ?? ''}
        tables={tableList}
        loadError={tablesError}
        selected={scope.tables}
        excludeText={scope.exclude}
        onApply={applyScope}
        onReload={() => forgetTables(activeKey)}
      />
    </Flex>
  );
}
