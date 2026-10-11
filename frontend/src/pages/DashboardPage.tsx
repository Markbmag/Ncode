import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Box, Button, Flex, FormControl, FormLabel, HStack, IconButton, Input, Link, Menu, MenuButton,
  MenuDivider, MenuItem, MenuList, Select, Skeleton, Text, Textarea, Tooltip, useBreakpointValue, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { apiErrorMessage, http } from '../api';
import type { SavedQuestion } from '../library/api';
import {
  ArchiveIcon, ChartIcon, ChevronRightIcon, CopyIcon, FolderIcon, LayoutIcon, MoreIcon, PencilIcon, PlusIcon, RefreshIcon, SaveIcon,
  SlidersIcon, StarIcon, XIcon,
} from '../icons';
import { DialogShell, MoveDialog } from '../library/dialogs';
import { useWorkspace } from '../workspace/useWorkspace';
import { cardQueue, dashboards, useDashboard } from '../dashboards/api';
import { DashboardCard } from '../dashboards/DashboardCard';
import { AddQuestionDialog, CardDialog, FiltersDialog } from '../dashboards/EditDialogs';
import { FilterBar } from '../dashboards/FilterBar';
import {
  DEFAULT_SIZE, addTab, applyLayout, cardsOnTab, newKey, placeNew, removeTab, runValues, toDefinition, valuesFromSearch, valuesToSearch,
} from '../dashboards/logic';
import type { FilterValues } from '../dashboards/logic';
import { REFRESH_CHOICES } from '../dashboards/types';
import type { Dashboard, DashCard, Definition } from '../dashboards/types';

const ROW_HEIGHT = 40;
const MARGIN = 12;

/** /dashboards/:id */
export default function DashboardPage() {
  const id = Number(useParams().id);
  const query = useDashboard(id);
  if (query.isPending) return <Skeleton h="480px" borderRadius="2xl" />;
  if (query.isError || !query.data)
    return (
      <Alert status="error" borderRadius="xl" flexDirection="column" alignItems="flex-start" gap={2}>
        <Text fontWeight={600}>This dashboard could not be opened</Text>
        <Text fontSize="sm">{apiErrorMessage(query.error, 'It may have been deleted, or it was not shared with you.')}</Text>
        <Button as={RouterLink} to="/dashboards" size="sm">
          All dashboards
        </Button>
      </Alert>
    );
  return <DashboardView key={id} dashboard={query.data} />;
}

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const ws = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const canEdit = dashboard.access === 'edit';
  const definitionOf = (d: Dashboard): Definition => ({ filters: d.filters, tabs: d.tabs, cards: d.cards, settings: d.settings });
  // set while editing; a new dashboard opens in edit mode (?edit=1)
  const [draft, setDraft] = useState<Definition | null>(() => (search.get('edit') === '1' && canEdit ? definitionOf(dashboard) : null));
  const editing = draft !== null;
  const def: Definition = draft ?? dashboard;
  useEffect(() => {
    if (search.get('edit') === null) return;
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('edit');
      return next;
    }, { replace: true });
  }, [search, setSearch]);
  const [saving, setSaving] = useState(false);
  const addQuestion = useDisclosure();
  const filtersDialog = useDisclosure();
  const details = useDisclosure();
  const move = useDisclosure();
  const [editingCard, setEditingCard] = useState<DashCard | null>(null);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);

  // Card runs share a queue sized to the server's per-user limit.
  useEffect(() => {
    cardQueue.limit = Math.max(1, ws.limits.max_concurrent_queries ?? 3);
  }, [ws.limits.max_concurrent_queries]);

  // filters and tab live in the URL, so a link shows the same view
  const values = useMemo(() => valuesFromSearch(search), [search]);
  const setValues = (next: FilterValues) => setSearch((prev) => valuesToSearch(next, prev), { replace: true });
  const tabParam = search.get('tab');
  const activeTab = def.tabs.length ? (def.tabs.find((t) => t.id === tabParam)?.id ?? def.tabs[0].id) : null;
  const setTab = (id: string) =>
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  const runJson = useMemo(() => JSON.stringify(runValues(def.filters, values)), [def.filters, values]);

  // refresh: manual, or every N seconds (paused while editing)
  const [refreshEvery, setRefreshEvery] = useState<number>(dashboard.settings.refresh ?? 0);
  const [tick, setTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const refreshAll = useCallback(() => {
    setTick((n) => n + 1);
    setLastRefresh(Date.now());
  }, []);
  useEffect(() => {
    if (!refreshEvery || editing) return;
    const timer = window.setInterval(refreshAll, refreshEvery * 1000);
    return () => window.clearInterval(timer);
  }, [refreshEvery, editing, refreshAll]);

  // TV mode: the dashboard alone, full screen
  const frame = useRef<HTMLDivElement | null>(null);
  const [tv, setTv] = useState(false);
  useEffect(() => {
    const onChange = () => setTv(document.fullscreenElement === frame.current && frame.current !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enterTv = () => {
    void frame.current?.requestFullscreen?.().catch(() => toast({ status: 'warning', title: 'Full screen is not available in this browser' }));
  };

  // ------------------------------------------------------------------ editing
  const startEdit = () => setDraft(definitionOf(dashboard));
  const change = useCallback((fn: (d: Definition) => Definition) => setDraft((d) => (d ? fn(d) : d)), []);
  const tabCards = cardsOnTab(def, activeTab);
  const addCard = (card: Omit<DashCard, 'key' | 'layout' | 'tab'>) =>
    change((d) => {
      const size = DEFAULT_SIZE[card.kind];
      const key = newKey('c', d.cards.map((c) => c.key));
      return { ...d, cards: [...d.cards, { ...card, key, tab: activeTab, layout: placeNew(cardsOnTab(d, activeTab), size.w, size.h) }] };
    });
  const replaceCard = (next: DashCard) => change((d) => ({ ...d, cards: d.cards.map((c) => (c.key === next.key ? next : c)) }));
  const removeCard = (key: string) => change((d) => ({ ...d, cards: d.cards.filter((c) => c.key !== key) }));
  const onLayout = (layout: Layout) =>
    change((d) => {
      const updated = applyLayout(cardsOnTab(d, activeTab), [...layout]);
      if (updated === cardsOnTab(d, activeTab)) return d;
      const byKey = new Map(updated.map((c) => [c.key, c]));
      return { ...d, cards: d.cards.map((c) => byKey.get(c.key) ?? c) };
    });
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await dashboards.save(dashboard.id, toDefinition({ ...draft, settings: { ...draft.settings, refresh: refreshEvery as Definition['settings']['refresh'] } }));
      setDraft(null);
      toast({ status: 'success', title: 'Dashboard saved', duration: 1500 });
    } catch (e) {
      toast({ status: 'error', title: 'Could not save', description: apiErrorMessage(e, 'Please try again'), duration: 6000, isClosable: true });
    } finally {
      setSaving(false);
    }
  };

  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again'), duration: 5000 });
    }
  };

  // ------------------------------------------------------------------ grid
  const { width, containerRef, mounted } = useContainerWidth();
  const stacked = (useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false) && !editing;
  const layout: Layout = tabCards.map((c) => ({
    i: c.key, x: c.layout.x, y: c.layout.y, w: c.layout.w, h: c.layout.h, minW: 2, minH: c.kind === 'heading' ? 1 : 2,
  }));
  const renderCard = (c: DashCard) => (
    <DashboardCard
      dashboardId={dashboard.id}
      card={c}
      filters={def.filters}
      values={values}
      runValuesJson={runJson}
      saved={dashboard.cards.some((x) => x.key === c.key && x.question_id === c.question_id)}
      trigger={tick}
      refresh={tick > 0}
      editing={editing}
      onEdit={() => setEditingCard(c)}
      onRemove={() => removeCard(c.key)}
      onChange={replaceCard}
    />
  );

  return (
    <Box ref={frame} bg={tv ? 'appBg' : undefined} p={tv ? 6 : 0} overflowY={tv ? 'auto' : undefined} data-testid="dashboard">
      {/* header */}
      {!tv && (
        <HStack spacing={1} fontSize="xs" color="mutedText" mb={1} className="no-print">
          <Link as={RouterLink} to="/dashboards">
            Dashboards
          </Link>
          {dashboard.path.map((p) => (
            <HStack key={p.id} spacing={1}>
              <ChevronRightIcon boxSize={3} />
              <Link as={RouterLink} to={`/library/c/${p.id}`}>
                {p.name}
              </Link>
            </HStack>
          ))}
        </HStack>
      )}
      <Flex align="center" gap={3} wrap="wrap" mb={3}>
        <Box minW={0}>
          <HStack spacing={2}>
            <Text as="h1" fontSize={tv ? '3xl' : '2xl'} fontWeight={700} letterSpacing="-0.02em" noOfLines={1} data-testid="dashboard-title">
              {dashboard.name}
            </Text>
            {!tv && (
              <IconButton
                aria-label={dashboard.favorite ? 'Remove from favourites' : 'Add to favourites'}
                size="xs"
                variant="ghost"
                className="no-print"
                color={dashboard.favorite ? 'yellow.400' : 'faintText'}
                icon={<StarIcon boxSize={4} fill={dashboard.favorite ? 'currentColor' : 'none'} />}
                onClick={() => void act('Could not change favourites', () => dashboards.favorite(dashboard.id, !dashboard.favorite))}
              />
            )}
            {!canEdit && !tv && <Badge className="no-print">view only</Badge>}
            {editing && <Badge colorScheme="orange">editing</Badge>}
          </HStack>
          {dashboard.description && !tv && (
            <Text fontSize="sm" color="mutedText" noOfLines={2}>
              {dashboard.description}
            </Text>
          )}
        </Box>
        <Box flex={1} />
        {editing ? (
          <HStack spacing={2} wrap="wrap" className="no-print">
            <Button size="sm" variant="subtle" leftIcon={<ChartIcon boxSize={4} />} onClick={addQuestion.onOpen} data-testid="add-question-card">
              Question
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<PencilIcon boxSize={4} />} onClick={() => setEditingCard({ key: '', kind: 'text', text: '', layout: { x: 0, y: 0, w: 6, h: 3 } })} data-testid="add-text-card">
              Text
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={() => setEditingCard({ key: '', kind: 'heading', text: '', layout: { x: 0, y: 0, w: 12, h: 1 } })} data-testid="add-heading-card">
              Heading
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<SlidersIcon boxSize={4} />} onClick={filtersDialog.onOpen} data-testid="edit-filters">
              Filters{def.filters.length ? ` (${def.filters.length})` : ''}
            </Button>
            <Button size="sm" variant="subtle" leftIcon={<LayoutIcon boxSize={4} />} onClick={() => change((d) => addTab(d, `Tab ${d.tabs.length + (d.tabs.length ? 1 : 2)}`))} data-testid="add-tab">
              Tab
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="brand" leftIcon={<SaveIcon boxSize={4} />} onClick={() => void save()} isLoading={saving} data-testid="save-dashboard">
              Save
            </Button>
          </HStack>
        ) : (
          <HStack spacing={2} wrap="wrap" className="no-print">
            <Tooltip label={`Last refreshed ${new Date(lastRefresh).toLocaleTimeString()}`} hasArrow>
              <IconButton aria-label="Refresh all cards" size="sm" variant="subtle" icon={<RefreshIcon boxSize={4} />} onClick={refreshAll} data-testid="refresh-dashboard" />
            </Tooltip>
            <Select size="sm" w="170px" value={refreshEvery} onChange={(e) => setRefreshEvery(Number(e.target.value))} aria-label="Auto-refresh" data-testid="auto-refresh">
              {REFRESH_CHOICES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value ? `Every ${r.label}` : 'Auto-refresh off'}
                </option>
              ))}
            </Select>
            {!tv && (
              <>
                <Button size="sm" variant="subtle" onClick={enterTv} data-testid="tv-mode">
                  TV mode
                </Button>
                {canEdit && (
                  <Button size="sm" variant="brand" leftIcon={<PencilIcon boxSize={4} />} onClick={startEdit} data-testid="edit-dashboard">
                    Edit
                  </Button>
                )}
                <Menu isLazy placement="bottom-end">
                  <MenuButton as={IconButton} aria-label="More actions" size="sm" variant="ghost" icon={<MoreIcon boxSize={4} />} data-testid="dashboard-menu" />
                  <MenuList fontSize="sm">
                    <MenuItem onClick={() => window.print()}>Print / save as PDF</MenuItem>
                    <MenuItem icon={<CopyIcon boxSize={4} />} onClick={() => void act('Could not duplicate', async () => navigate(`/dashboards/${(await dashboards.duplicate(dashboard.id)).id}`))}>
                      Duplicate
                    </MenuItem>
                    {canEdit && (
                      <>
                        <MenuItem icon={<PencilIcon boxSize={4} />} onClick={details.onOpen}>
                          Rename / describe…
                        </MenuItem>
                        <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
                          Move…
                        </MenuItem>
                        <MenuDivider />
                        <MenuItem
                          icon={<ArchiveIcon boxSize={4} />}
                          onClick={() =>
                            void act('Could not archive', async () => {
                              await dashboards.update(dashboard.id, { archived: true });
                              toast({ status: 'info', title: `“${dashboard.name}” archived`, description: 'Restore it from Library → Archive.' });
                              navigate('/dashboards');
                            })
                          }
                        >
                          Archive
                        </MenuItem>
                      </>
                    )}
                  </MenuList>
                </Menu>
              </>
            )}
            {tv && (
              <Button size="sm" variant="ghost" onClick={() => void document.exitFullscreen()}>
                Exit TV mode
              </Button>
            )}
          </HStack>
        )}
      </Flex>

      {/* filters */}
      {def.filters.length > 0 && (
        <Box mb={3}>
          <FilterBar filters={def.filters} values={values} onChange={setValues} />
        </Box>
      )}

      {/* tabs */}
      {def.tabs.length > 0 && (
        <HStack spacing={1} mb={3} borderBottom="1px solid" borderColor="lineColor" overflowX="auto" data-testid="dashboard-tabs">
          {def.tabs.map((t) => {
            const active = t.id === activeTab;
            return (
              <HStack key={t.id} spacing={0} borderBottom="2px solid" borderColor={active ? 'brand.400' : 'transparent'} mb="-1px">
                {editing && renamingTab === t.id ? (
                  <Input
                    size="xs"
                    w="140px"
                    autoFocus
                    defaultValue={t.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim() || t.name;
                      change((d) => ({ ...d, tabs: d.tabs.map((x) => (x.id === t.id ? { ...x, name: name.slice(0, 80) } : x)) }));
                      setRenamingTab(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    aria-label="Tab name"
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    borderRadius="0"
                    fontWeight={active ? 700 : 500}
                    color={active ? 'bodyText' : 'mutedText'}
                    onClick={() => setTab(t.id)}
                    onDoubleClick={() => editing && setRenamingTab(t.id)}
                    data-testid={`tab-${t.id}`}
                  >
                    {t.name}
                  </Button>
                )}
                {editing && (
                  <IconButton aria-label={`Remove tab ${t.name}`} size="xs" variant="ghost" icon={<XIcon boxSize={2.5} />} onClick={() => change((d) => removeTab(d, t.id))} />
                )}
              </HStack>
            );
          })}
          {editing && (
            <Text fontSize="2xs" color="faintText" pl={2} whiteSpace="nowrap">
              double-click a tab to rename it
            </Text>
          )}
        </HStack>
      )}

      {/* cards */}
      {tabCards.length === 0 && (
        <Flex direction="column" align="center" justify="center" gap={3} py={16} border="1px dashed" borderColor="lineColor" borderRadius="2xl" color="mutedText" textAlign="center">
          <LayoutIcon boxSize={8} />
          <Text fontSize="sm">{editing ? 'Add saved questions, text and headings with the buttons above.' : 'This dashboard is empty.'}</Text>
          {!editing && canEdit && (
            <Button size="sm" variant="brand" onClick={startEdit}>
              Add cards
            </Button>
          )}
        </Flex>
      )}
      {/* the measured box is always there: the grid library measures its width once, on mount */}
      <Box ref={containerRef} mx={stacked ? 0 : `-${MARGIN}px`} className={editing ? 'dash-grid editing' : 'dash-grid'}>
        {stacked ? (
          <Box display="flex" flexDirection="column" gap={3}>
            {[...tabCards]
              .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
              .map((c) => (
                <Box key={c.key} h={c.kind === 'heading' ? 'auto' : `${Math.max(c.layout.h, 4) * ROW_HEIGHT}px`}>
                  {renderCard(c)}
                </Box>
              ))}
          </Box>
        ) : (
          mounted &&
          tabCards.length > 0 && (
            <ReactGridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: 12, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN] }}
              dragConfig={{ enabled: editing, handle: '.card-drag', cancel: '.no-drag' }}
              resizeConfig={{ enabled: editing }}
              compactor={verticalCompactor}
              onLayoutChange={(l) => editing && onLayout(l)}
            >
              {tabCards.map((c) => (
                <div key={c.key}>{renderCard(c)}</div>
              ))}
            </ReactGridLayout>
          )
        )}
      </Box>

      <PrintStyles />

      {/* dialogs */}
      <AddQuestionDialog
        isOpen={addQuestion.isOpen}
        onClose={addQuestion.onClose}
        onAdd={(q) =>
          void act('Could not add the question', async () => {
            // its parameters and tables are needed to connect filters before the dashboard is saved
            const full = (await http.get<SavedQuestion>(`/api/questions/${q.id}`)).data;
            addCard({ kind: 'question', question_id: q.id, question: cardQuestion(full) });
          })
        }
      />
      <CardDialog
        card={editingCard}
        onClose={() => setEditingCard(null)}
        onSave={(c) => (c.key ? replaceCard(c) : addCard({ kind: c.kind, text: c.text, title: c.title }))}
      />
      <FiltersDialog
        isOpen={filtersDialog.isOpen}
        onClose={filtersDialog.onClose}
        filters={def.filters}
        cards={def.cards}
        onSave={(filters, cards) => change((d) => ({ ...d, filters, cards }))}
      />
      {details.isOpen && <DetailsDialog dashboard={dashboard} onClose={details.onClose} />}
      <MoveDialog
        isOpen={move.isOpen}
        onClose={move.onClose}
        title={`Move “${dashboard.name}”`}
        current={dashboard.collection_id}
        onMove={(target) => dashboards.update(dashboard.id, { collection_id: target as number })}
      />
    </Box>
  );
}

/** What the server says about a question on a card (dashboard_routes._question_info). */
function cardQuestion(q: SavedQuestion): DashCard['question'] {
  const spec = q.spec as { source?: { table?: string; alias?: string }; joins?: { table?: string; alias?: string }[] };
  const tables = q.kind === 'builder' ? [spec.source, ...(spec.joins ?? [])].map((t) => t?.alias || t?.table).filter((t): t is string => !!t) : [];
  return {
    state: q.archived ? 'archived' : 'ok', id: q.id, name: q.name, kind: q.kind, connection: q.connection,
    parameters: q.parameters, viz: q.viz, tables,
  };
}

function DetailsDialog({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
  const [name, setName] = useState(dashboard.name);
  const [description, setDescription] = useState(dashboard.description ?? '');
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title="Rename / describe"
      submitLabel="Save"
      canSubmit={name.trim() !== ''}
      onSubmit={() => dashboards.update(dashboard.id, { name: name.trim(), description: description.trim() || null })}
    >
      <FormControl isRequired>
        <FormLabel fontSize="sm">Name</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">Description</FormLabel>
        <Textarea size="sm" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </FormControl>
    </DialogShell>
  );
}

/** Print / "save as PDF": only the dashboard, cards not cut in half. */
function PrintStyles() {
  return (
    <style>{`
      .dash-grid.editing .react-grid-item { transition: none; }
      .dash-grid .react-grid-item.react-grid-placeholder { background: rgba(99,102,241,0.25); border-radius: 12px; }
      @media print {
        [data-print-hide], .no-print { display: none !important; }
        html, body { background: #fff !important; }
        .dash-card { break-inside: avoid; }
        @page { margin: 12mm; }
      }
    `}</style>
  );
}

