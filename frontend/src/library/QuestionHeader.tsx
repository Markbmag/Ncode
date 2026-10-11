import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Badge, Box, Button, Flex, FormControl, FormLabel, HStack, IconButton, Input, Link, Menu, MenuButton, MenuDivider, MenuItem, MenuList,
  Text, Textarea, Tooltip, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { EngineBadge } from '../components/EngineBadge';
import { ArchiveIcon, ChevronRightIcon, CopyIcon, FolderIcon, MergeIcon, MoreIcon, PencilIcon, RefreshIcon, SaveIcon, SparklesIcon, StarIcon, TableIcon } from '../icons';
import { library } from './api';
import type { QuestionPayload, SavedQuestion } from './api';
import { DialogShell, MoveDialog, SaveQuestionDialog } from './dialogs';

interface Props {
  engine?: string;
  /** shown when the question is not saved yet, e.g. "New question" */
  title: string;
  subtitle?: ReactNode;
  saved: SavedQuestion | null;
  dirty: boolean;
  /** what would be saved now; null = not saveable (incomplete) */
  payload: () => QuestionPayload | null;
  defaultName: string;
  onRevert?: () => void;
  onSaved?: () => void;
  children?: ReactNode;
}

/** Title, path and save / save-as / move / archive for the builder and the SQL editor. */
export function QuestionHeader({ engine, title, subtitle, saved, dirty, payload, defaultName, onRevert, onSaved, children }: Props) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const toast = useToast();
  const saveNew = useDisclosure();
  const move = useDisclosure();
  const details = useDisclosure();
  const [saving, setSaving] = useState(false);
  const canEdit = saved?.access === 'edit';

  const fail = (e: unknown, what: string) => toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again'), duration: 6000, isClosable: true });

  const createFrom = async (target: { name: string; description: string | null; collection_id: number }) => {
    const body = payload();
    if (!body) throw new Error('The question is not complete');
    const q = await library.createQuestion({ ...body, ...target });
    onSaved?.();
    toast({ status: 'success', title: `Saved to ${q.collection?.name ?? 'the library'}`, duration: 2500 });
    navigate(`/questions/${q.id}`, { replace: !saved });
  };

  const saveChanges = async () => {
    const body = payload();
    if (!saved || !body) return;
    setSaving(true);
    try {
      await library.updateQuestion(saved.id, body);
      onSaved?.();
      toast({ status: 'success', title: 'Saved', duration: 1500 });
    } catch (e) {
      fail(e, 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!saved) return;
    try {
      await library.updateQuestion(saved.id, { archived: true });
      toast({ status: 'info', title: `“${saved.name}” archived`, description: 'Restore it from Library → Archive.', duration: 4000 });
      navigate(`/library/c/${saved.collection_id}`);
    } catch (e) {
      fail(e, 'Could not archive');
    }
  };

  const duplicate = async () => {
    if (!saved) return;
    try {
      const q = await library.duplicate(saved.id);
      navigate(`/questions/${q.id}`);
    } catch (e) {
      fail(e, 'Could not duplicate');
    }
  };

  const toggleModel = async () => {
    if (!saved) return;
    try {
      await library.updateQuestion(saved.id, { model: !saved.model });
      toast({
        status: 'success',
        title: saved.model ? 'No longer a model' : 'Now a model',
        description: saved.model ? undefined : 'New questions and Combine can start from it like from a table.',
        duration: 3000,
      });
    } catch (e) {
      fail(e, 'Could not change it');
    }
  };

  const star = async () => {
    if (!saved) return;
    try {
      await library.favorite(saved.id, !saved.favorite);
    } catch (e) {
      fail(e, 'Could not change favourites');
    }
  };

  const ready = payload !== undefined && payload() !== null;

  return (
    <Flex align="center" gap={3} wrap="wrap" data-testid="question-header">
      {engine && <EngineBadge engine={engine} size={32} />}
      <Box minW={0}>
        {saved && (
          <HStack spacing={1} fontSize="xs" color="mutedText" data-testid="question-path">
            <Link as={RouterLink} to="/library">
              Library
            </Link>
            {saved.path.map((p) => (
              <HStack key={p.id} spacing={1}>
                <ChevronRightIcon boxSize={3} />
                <Link as={RouterLink} to={`/library/c/${p.id}`}>
                  {p.name}
                </Link>
              </HStack>
            ))}
          </HStack>
        )}
        <HStack spacing={2}>
          <Text fontSize="lg" fontWeight={700} lineHeight="1.2" noOfLines={1} data-testid="question-title">
            {saved ? saved.name : title}
          </Text>
          {saved && (
            <Tooltip label={saved.favorite ? 'Remove from favourites' : 'Add to favourites'} hasArrow>
              <IconButton
                aria-label={saved.favorite ? 'Remove from favourites' : 'Add to favourites'}
                size="xs"
                variant="ghost"
                color={saved.favorite ? 'yellow.400' : 'faintText'}
                icon={<StarIcon boxSize={4} fill={saved.favorite ? 'currentColor' : 'none'} />}
                onClick={() => void star()}
                data-testid="favorite"
              />
            </Tooltip>
          )}
          {saved && !canEdit && <Badge>view only</Badge>}
          {saved?.model && <Badge colorScheme="teal">model</Badge>}
          {saved && dirty && <Badge colorScheme="orange">edited</Badge>}
        </HStack>
        {subtitle && (
          <Text fontSize="xs" color="mutedText" noOfLines={1}>
            {subtitle}
          </Text>
        )}
      </Box>
      <Box flex={1} />
      <HStack spacing={2} wrap="wrap">
        {children}
        {(!saved || canEdit) && (
          <Button
            size="sm"
            variant="brand"
            leftIcon={<SaveIcon boxSize={4} />}
            isDisabled={!ready || (!!saved && !dirty)}
            isLoading={saving}
            onClick={() => (saved ? void saveChanges() : saveNew.onOpen())}
            data-testid="save-question"
          >
            Save
          </Button>
        )}
        {saved && !canEdit && (
          <Button size="sm" variant="brand" leftIcon={<SaveIcon boxSize={4} />} isDisabled={!ready} onClick={saveNew.onOpen}>
            Save as new…
          </Button>
        )}
        {saved && (
          <Menu isLazy placement="bottom-end">
            <MenuButton as={IconButton} aria-label="More actions" size="sm" variant="ghost" icon={<MoreIcon boxSize={4} />} data-testid="question-menu" />
            <MenuList fontSize="sm">
              {canEdit && (
                <MenuItem icon={<SaveIcon boxSize={4} />} onClick={saveNew.onOpen} isDisabled={!ready}>
                  Save as new question…
                </MenuItem>
              )}
              {canEdit && dirty && onRevert && (
                <MenuItem icon={<RefreshIcon boxSize={4} />} onClick={onRevert}>
                  Discard changes
                </MenuItem>
              )}
              {canEdit && (
                <MenuItem icon={<PencilIcon boxSize={4} />} onClick={details.onOpen}>
                  Rename / describe…
                </MenuItem>
              )}
              <MenuItem icon={<CopyIcon boxSize={4} />} onClick={() => void duplicate()}>
                Duplicate
              </MenuItem>
              {saved.kind === 'builder' && (
                <MenuItem icon={<SparklesIcon boxSize={4} />} onClick={() => navigate(`/xray?question=${saved.id}`)} data-testid="question-xray">
                  X-ray
                </MenuItem>
              )}
              {saved.kind !== 'federated' && (
                <MenuItem icon={<MergeIcon boxSize={4} />} onClick={() => navigate(`/combine?question=${saved.id}`)}>
                  Combine with other sources
                </MenuItem>
              )}
              {canEdit && saved.kind !== 'federated' && (
                <MenuItem icon={<TableIcon boxSize={4} />} onClick={() => void toggleModel()} data-testid="toggle-model">
                  {saved.model ? 'Stop using as a model' : 'Use as a model'}
                </MenuItem>
              )}
              {canEdit && (
                <MenuItem icon={<FolderIcon boxSize={4} />} onClick={move.onOpen}>
                  Move…
                </MenuItem>
              )}
              {canEdit && (
                <>
                  <MenuDivider />
                  <MenuItem icon={<ArchiveIcon boxSize={4} />} onClick={() => void archive()} data-testid="archive-question">
                    Archive
                  </MenuItem>
                </>
              )}
            </MenuList>
          </Menu>
        )}
      </HStack>

      <SaveQuestionDialog
        isOpen={saveNew.isOpen}
        onClose={saveNew.onClose}
        title={saved ? 'Save as a new question' : 'Save question'}
        defaultName={saved ? `${saved.name} (copy)` : defaultName}
        defaultCollection={saved ? (saved.access === 'edit' ? saved.collection_id : null) : Number(search.get('collection')) || null}
        onSave={createFrom}
      />
      {saved && (
        <>
          <MoveDialog
            isOpen={move.isOpen}
            onClose={move.onClose}
            title={`Move “${saved.name}”`}
            current={saved.collection_id}
            onMove={(target) => library.updateQuestion(saved.id, { collection_id: target as number })}
          />
          {details.isOpen && <DetailsDialog isOpen onClose={details.onClose} question={saved} />}
        </>
      )}
    </Flex>
  );
}

function DetailsDialog({ isOpen, onClose, question }: { isOpen: boolean; onClose: () => void; question: SavedQuestion }) {
  const [name, setName] = useState(question.name);
  const [description, setDescription] = useState(question.description ?? '');
  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Rename / describe"
      submitLabel="Save"
      canSubmit={name.trim() !== ''}
      onSubmit={() => library.updateQuestion(question.id, { name: name.trim(), description: description.trim() || null })}
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
