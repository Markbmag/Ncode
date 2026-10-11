import { useState } from 'react';
import {
  Badge, Box, Button, Flex, FormControl, FormHelperText, FormLabel, IconButton, Input, InputGroup, InputLeftElement, Link, Menu, MenuButton,
  MenuDivider, MenuItem, MenuList, Skeleton, Text, Textarea, VStack, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ArchiveIcon, CopyIcon, FolderIcon, LayoutIcon, MoreIcon, PlusIcon, SearchIcon, StarIcon } from '../icons';
import { useCollections } from '../library/api';
import { CollectionPicker, DialogShell, MoveDialog } from '../library/dialogs';
import { dashboards, useDashboards } from '../dashboards/api';
import type { DashboardSummary } from '../dashboards/types';

function ago(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

/** /dashboards: favourites, search and every dashboard the user can see. */
export default function DashboardsPage() {
  const [text, setText] = useState('');
  const create = useDisclosure();
  const query = text.trim();
  const favorites = useDashboards({ favorites: true });
  const all = useDashboards({ q: query || undefined, limit: 200 });
  return (
    <VStack align="stretch" spacing={5}>
      <PageHeader
        title="Dashboards"
        subtitle="Saved questions, text and headings on one page, with shared filters."
        actions={
          <Button size="sm" variant="brand" leftIcon={<PlusIcon boxSize={4} />} onClick={create.onOpen} data-testid="new-dashboard">
            New dashboard
          </Button>
        }
      />
      <InputGroup>
        <InputLeftElement pointerEvents="none">
          <SearchIcon boxSize={4} color="faintText" />
        </InputLeftElement>
        <Input placeholder="Find a dashboard…" value={text} onChange={(e) => setText(e.target.value)} bg="panelBg" />
      </InputGroup>
      {!query && (favorites.data?.length ?? 0) > 0 && (
        <Panel title="Favourites">
          {favorites.data!.map((d) => (
            <DashboardRow key={d.id} d={d} showCollection />
          ))}
        </Panel>
      )}
      <Panel title={query ? `Dashboards matching “${query}”` : 'All dashboards'}>
        {all.isPending && <Skeleton h="100px" />}
        {all.isError && <Empty>{apiErrorMessage(all.error, 'Could not load the dashboards')}</Empty>}
        {all.data?.length === 0 && <Empty>{query ? 'Nothing found.' : 'No dashboards yet. Create one, then add saved questions to it.'}</Empty>}
        {all.data?.map((d) => (
          <DashboardRow key={d.id} d={d} showCollection />
        ))}
      </Panel>
      <NewDashboardDialog isOpen={create.isOpen} onClose={create.onClose} />
    </VStack>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      <Text fontSize="sm" fontWeight={700} px={3} py={2} borderBottom="1px solid" borderColor="lineColor">
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="sm" color="faintText" px={3} py={4}>
      {children}
    </Text>
  );
}

/** One dashboard in a list (also used by the Library). */
export function DashboardRow({ d, showCollection = false }: { d: DashboardSummary; showCollection?: boolean }) {
  const toast = useToast();
  const navigate = useNavigate();
  const move = useDisclosure();
  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again'), duration: 5000 });
    }
  };
  return (
    <Flex align="center" gap={3} px={3} py={2.5} borderBottom="1px solid" borderColor="lineColor" _last={{ borderBottom: 'none' }} _hover={{ bg: 'panelHover' }} data-testid="dashboard-row">
      <LayoutIcon boxSize={4} color="green.400" flexShrink={0} />
      <Box flex={1} minW={0}>
        <Link as={RouterLink} to={`/dashboards/${d.id}`} fontWeight={600} fontSize="sm" noOfLines={1}>
          {d.name}
        </Link>
        <Text fontSize="xs" color="mutedText" noOfLines={1}>
          {showCollection && d.collection && `${d.collection.name} · `}
          dashboard · {d.owner ?? 'former user'} · {ago(d.updated_at)}
          {d.description && ` · ${d.description}`}
        </Text>
      </Box>
      {d.imported && <Badge fontSize="2xs">DataDesk</Badge>}
      {d.access === 'view' && <Badge fontSize="2xs">view only</Badge>}
      <IconButton
        aria-label={d.favorite ? 'Remove from favourites' : 'Add to favourites'}
        size="xs"
        variant="ghost"
        color={d.favorite ? 'yellow.400' : 'faintText'}
        icon={<StarIcon boxSize={4} fill={d.favorite ? 'currentColor' : 'none'} />}
        onClick={() => void act('Could not change favourites', () => dashboards.favorite(d.id, !d.favorite))}
      />
      <Menu isLazy placement="bottom-end">
        <MenuButton as={IconButton} aria-label={`Actions for ${d.name}`} size="xs" variant="ghost" icon={<MoreIcon boxSize={4} />} />
        <MenuList fontSize="sm">
          <MenuItem icon={<CopyIcon boxSize={4} />} onClick={() => void act('Could not duplicate', async () => navigate(`/dashboards/${(await dashboards.duplicate(d.id)).id}`))}>
            Duplicate
          </MenuItem>
          {d.access === 'edit' && (
            <>
              <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
                Move…
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<ArchiveIcon boxSize={4} />} onClick={() => void act('Could not archive', () => dashboards.update(d.id, { archived: true }))}>
                Archive
              </MenuItem>
            </>
          )}
        </MenuList>
      </Menu>
      <MoveDialog isOpen={move.isOpen} onClose={move.onClose} title={`Move “${d.name}”`} current={d.collection_id} onMove={(t) => dashboards.update(d.id, { collection_id: t as number })} />
    </Flex>
  );
}

export function NewDashboardDialog({ isOpen, onClose, collectionId = null }: { isOpen: boolean; onClose: () => void; collectionId?: number | null }) {
  return isOpen ? <NewDashboardForm onClose={onClose} collectionId={collectionId} /> : null;
}

function NewDashboardForm({ onClose, collectionId }: { onClose: () => void; collectionId: number | null }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { data } = useCollections();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<number | null>(collectionId ?? (Number(search.get('collection')) || null));
  const collection = picked ?? data?.personal_id ?? null;
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title="New dashboard"
      submitLabel="Create"
      canSubmit={name.trim() !== '' && collection !== null}
      onSubmit={async () => {
        const d = await dashboards.create({ name: name.trim(), description: description.trim() || null, collection_id: collection });
        navigate(`/dashboards/${d.id}?edit=1`);
      }}
    >
      <FormControl isRequired>
        <FormLabel fontSize="sm">Name</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus data-testid="dashboard-name" />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">Description</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </FormControl>
      <FormControl isRequired>
        <FormLabel fontSize="sm">Collection</FormLabel>
        <CollectionPicker value={collection} onChange={setPicked} />
        <FormHelperText fontSize="xs">People who can see the collection can see the dashboard — and only the questions on it that are shared with them.</FormHelperText>
      </FormControl>
    </DialogShell>
  );
}
