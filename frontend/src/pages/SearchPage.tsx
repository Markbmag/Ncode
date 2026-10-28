import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, Skeleton, Text, VStack, useDisclosure } from '@chakra-ui/react';
import { ConnectionHeader } from '../components/ConnectionHeader';
import { NoResultsState, ReadyState } from '../components/EmptyStates';
import { NoConnections } from '../components/LoadError';
import { ResultsPanel } from '../components/ResultsPanel';
import { ScopeModal } from '../components/ScopeModal';
import { SearchBar } from '../components/SearchBar';
import { SearchProgress } from '../components/SearchProgress';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';

const DEMO_KEY = 'demo'; // the Factory demo database (backend app/demo.py)
const DEMO_EXAMPLE = 'PA-3001'; // one of its part numbers

export default function SearchPage() {
  const ws = useWorkspace();
  const { search: state, scope, tables: tableList, excludePatterns } = ws;
  const scopeModal = useDisclosure();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // "Search for PA-3001": fill the box, then search once the phrase is in place
  const pending = useRef<string | null>(null);
  const tryExample = (value: string) => {
    pending.current = value;
    ws.setPhrase(value);
  };
  const { phrase, startSearch } = ws;
  useEffect(() => {
    if (pending.current === null || pending.current !== phrase) return;
    pending.current = null;
    startSearch();
  }, [phrase, startSearch]);

  // "/" focuses the search box
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

  let scopeLabel = t('All tables');
  if (scope.tables.length > 0) scopeLabel = tableList ? t('{n} of {total} tables', { n: scope.tables.length, total: tableList.length }) : t('{n} tables', { n: scope.tables.length });
  else if (tableList) scopeLabel = t('All {n} tables', { n: tableList.length });
  if (excludePatterns.length > 0) scopeLabel += t(' · {n} skipped', { n: excludePatterns.length });
  const scopeCustom = scope.tables.length > 0 || excludePatterns.length > 0;

  const running = state.phase === 'running';
  const noResultsAtAll =
    state.phase === 'done' && state.status === 'completed' && state.results.length === 0 && state.errors.length === 0;

  let content: ReactNode;
  if (!ws.loaded) {
    content = (
      <VStack align="stretch" spacing={4}>
        <Skeleton h="120px" borderRadius="2xl" />
        <Skeleton h="280px" borderRadius="2xl" />
      </VStack>
    );
  } else if (ws.connections.length === 0) {
    content = <NoConnections />;
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
    content = (
      <ResultsPanel key={ws.searchCount} state={state} connectionLabel={ws.active?.label ?? ''} onOpenTable={ws.openInExplorer} />
    );
  } else {
    content = (
      <ReadyState
        connectionLabel={ws.active?.label ?? t('your database')}
        scopeLabel={scopeLabel}
        action={
          // one example (M11): a value that exists in the Factory demo, else what to type
          <VStack spacing={2}>
            <Text fontSize="xs" color="faintText">
              {ws.activeKey === DEMO_KEY
                ? t('Example: the part number {value}', { value: DEMO_EXAMPLE })
                : t('Example: an order number, a VIN or part of a customer’s name')}
            </Text>
            {ws.activeKey === DEMO_KEY ? (
              <Button size="sm" variant="brand" onClick={() => tryExample(DEMO_EXAMPLE)} data-testid="search-example">
                {t('Search for “{value}”', { value: DEMO_EXAMPLE })}
              </Button>
            ) : (
              <Button size="sm" variant="subtle" onClick={() => inputRef.current?.focus()} data-testid="search-example">
                {t('Type what you are looking for')}
              </Button>
            )}
          </VStack>
        }
      />
    );
  }

  return (
    <VStack align="stretch" spacing={6}>
      <ConnectionHeader />
      <SearchBar
        inputRef={inputRef}
        phrase={ws.phrase}
        onPhraseChange={ws.setPhrase}
        onSubmit={ws.startSearch}
        onCancel={ws.cancelSearch}
        running={running}
        disabled={!ws.active || !ws.loaded}
        matchMode={ws.prefs.matchMode}
        onMatchMode={(v) => ws.setPref('matchMode', v)}
        caseSensitive={ws.prefs.caseSensitive}
        onCaseSensitive={(v) => ws.setPref('caseSensitive', v)}
        includeNumbers={ws.prefs.includeNumbers}
        onIncludeNumbers={(v) => ws.setPref('includeNumbers', v)}
        rowLimit={ws.prefs.rowLimit}
        onRowLimit={(v) => ws.setPref('rowLimit', v)}
        scopeLabel={scopeLabel}
        scopeCustom={scopeCustom}
        onOpenScope={scopeModal.onOpen}
      />
      {content}

      <ScopeModal
        isOpen={scopeModal.isOpen}
        onClose={scopeModal.onClose}
        connectionLabel={ws.active?.label ?? ''}
        tables={tableList}
        loadError={ws.tablesError}
        selected={scope.tables}
        excludeText={scope.exclude}
        onApply={(tables, exclude) => {
          ws.applyScope(tables, exclude);
          scopeModal.onClose();
        }}
        onReload={ws.reloadTables}
      />
    </VStack>
  );
}
