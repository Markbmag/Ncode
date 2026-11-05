import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Box, Button, Flex, FormControl, FormLabel, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Tab, TabList, Tabs, Text, Textarea, useToast, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { apiErrorMessage } from '../api';
import { ArchiveIcon, LockIcon, PlusIcon, TrashIcon, UsersIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { createBoard, createLabel, deleteLabel, saveMembers, updateBoard, updateLabel } from './api';
import type { MemberInput } from './api';
import { colorHex, groupName, PALETTE, personId, personName } from './logic';
import { Choice } from './Choice';
import { ColorPicker, LabelChip, PersonAvatar } from './parts';
import type { BoardDetail, BoardSummary, Label, Member, Role } from './types';

function Dialog({ title, onClose, children, footer, size = 'md', onSubmit }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: string; onSubmit?: (e: FormEvent) => void }) {
  return (
    <Modal isOpen onClose={onClose} size={size} scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent as={onSubmit ? 'form' : 'section'} onSubmit={onSubmit} mx={3} fontSize="md">
        <ModalHeader fontSize="xl">{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>{children}</ModalBody>
        {footer && <ModalFooter gap={2} flexWrap="wrap" rowGap={2}>{footer}</ModalFooter>}
      </ModalContent>
    </Modal>
  );
}

export function CreateBoardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (b: BoardSummary) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PALETTE[0].name);
  const [secret, setSecret] = useState(false); // K4: a private board
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const board = await createBoard({ name: name.trim(), description: description.trim() || null, color, template: 'basic', private: secret });
      onCreated(board);
      onClose();
    } catch (err) {
      toast({ status: 'error', title: apiErrorMessage(err, t('Could not create the board')) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t('New board')}
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" isLoading={busy} isDisabled={!name.trim()} data-testid="create-board">
            {t('Create board')}
          </Button>
        </>
      }
    >
      <VStack spacing={4} align="stretch">
        <Box h="56px" borderRadius="xl" bgGradient={`linear(135deg, ${colorHex(color)}, ${colorHex(color)}99)`} display="flex" alignItems="flex-end" px={4} pb={2}>
          <Text color="white" fontWeight={700} noOfLines={1}>
            {name || t('Board name')}
          </Text>
        </Box>
        <FormControl isRequired>
          <FormLabel>{t('Name')}</FormLabel>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t('e.g. Weekly production meeting')} data-testid="board-name" />
        </FormControl>
        <FormControl>
          <FormLabel>{t('Description')}</FormLabel>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t('What this board is for (optional)')} />
        </FormControl>
        <FormControl>
          <FormLabel>{t('Who can see the board')}</FormLabel>
          <VisibilityChoice value={secret} onChange={setSecret} />
        </FormControl>
        <FormControl>
          <FormLabel>{t('Colour')}</FormLabel>
          <ColorPicker value={color} onChange={setColor} />
        </FormControl>
        <Text fontSize="xs" color="mutedText">
          {t('The board starts with three stages: To do, In progress and Done.')}
        </Text>
      </VStack>
    </Dialog>
  );
}

/** K4: everyone in the company, or only the board's members (for HR, management...). */
function VisibilityChoice({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const items = [
    { v: false, title: t('Everyone in the company'), text: t('Everyone can look; members change it.') },
    { v: true, title: t('Only its members'), text: t('For boards others should not see, e.g. HR or management.') },
  ];
  return (
    <VStack align="stretch" spacing={2} role="radiogroup" data-testid="board-visibility">
      {items.map((it) => (
        <Box
          key={String(it.v)}
          as="button"
          type="button"
          role="radio"
          aria-checked={value === it.v}
          onClick={() => onChange(it.v)}
          textAlign="left"
          p={3}
          borderRadius="lg"
          border="2px solid"
          borderColor={value === it.v ? 'brand.400' : 'lineColor'}
          bg={value === it.v ? 'rgba(99,102,241,0.08)' : 'transparent'}
          data-testid={it.v ? 'visibility-members' : 'visibility-everyone'}
        >
          <HStack spacing={2}>
            {it.v ? <LockIcon boxSize={4} /> : <UsersIcon boxSize={4} />}
            <Text fontWeight={700}>{it.title}</Text>
          </HStack>
          <Text fontSize="sm" color="mutedText" mt={0.5}>
            {it.text}
          </Text>
        </Box>
      ))}
    </VStack>
  );
}

export function BoardSettingsDialog({ board, canManage, onClose, onSaved, onArchived }: { board: BoardSummary; canManage: boolean; onClose: () => void; onSaved: () => void; onArchived: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? '');
  const [color, setColor] = useState(board.color ?? PALETTE[0].name);
  const [secret, setSecret] = useState(Boolean(board.private));
  const [keep, setKeep] = useState<0 | 7 | 14 | 30>(((board.done_keep_days ?? 14) as 0 | 7 | 14 | 30));
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateBoard(board.id, { name: name.trim(), description: description.trim() || null, color, private: secret, done_keep_days: keep });
      onSaved();
      onClose();
    } catch (err) {
      toast({ status: 'error', title: apiErrorMessage(err, t('Could not save the change')) });
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!window.confirm(t('Hide the board “{name}”? It disappears from the list; you can bring it back from Hidden boards.', { name: board.name }))) return;
    try {
      await updateBoard(board.id, { archived: true });
      onArchived();
    } catch (err) {
      toast({ status: 'error', title: apiErrorMessage(err, t('Could not save the change')) });
    }
  };
  return (
    <Dialog
      title={t('Board settings')}
      onClose={onClose}
      onSubmit={(e) => void save(e)}
      footer={
        <>
          {canManage && (
            <Button variant="ghost" colorScheme="red" leftIcon={<ArchiveIcon boxSize={4} />} mr="auto" onClick={() => void archive()} data-testid="archive-board">
              {t('Hide the board')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" isLoading={busy} isDisabled={!canManage || !name.trim()}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <VStack spacing={4} align="stretch">
        <FormControl isRequired isDisabled={!canManage}>
          <FormLabel>{t('Name')}</FormLabel>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </FormControl>
        <FormControl isDisabled={!canManage}>
          <FormLabel>{t('Description')}</FormLabel>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </FormControl>
        <FormControl isDisabled={!canManage}>
          <FormLabel>{t('Colour')}</FormLabel>
          <ColorPicker value={color} onChange={setColor} />
        </FormControl>
        <FormControl isDisabled={!canManage}>
          <FormLabel>{t('Who can see the board')}</FormLabel>
          <VisibilityChoice value={secret} onChange={setSecret} />
        </FormControl>
        <FormControl isDisabled={!canManage}>
          <FormLabel>{t('Finished tasks stay on the board')}</FormLabel>
          <Choice
            value={String(keep)}
            options={[
              { value: '7', label: t('for 7 days') },
              { value: '14', label: t('for 14 days') },
              { value: '30', label: t('for 30 days') },
              { value: '0', label: t('always') },
            ]}
            onChange={(v) => setKeep(Number(v) as 0 | 7 | 14 | 30)}
            label={t('Finished tasks stay on the board')}
            isDisabled={!canManage}
            testId="board-keep"
          />
          <Text fontSize="sm" color="mutedText" mt={1}>
            {t('After that they are under “Finished earlier” at the bottom of the done stage, still there to open.')}
          </Text>
        </FormControl>
        {!canManage && (
          <Text fontSize="sm" color="mutedText">
            {t('Only the owners of the board change these.')}
          </Text>
        )}
      </VStack>
    </Dialog>
  );
}

interface DraftMember {
  key: string;
  kind: 'user' | 'group';
  user?: number;
  group?: number;
  name: string;
  role: Role;
}

function draftOf(m: Member, detail: BoardDetail): DraftMember | null {
  if (m.user !== null && m.user !== undefined) {
    const id = personId(m.user, detail.people);
    const name = m.name ?? personName(m.user, detail.people);
    return { key: `u${id ?? name}`, kind: 'user', user: id ?? undefined, name, role: m.role };
  }
  if (m.group !== null && m.group !== undefined) {
    const g = m.group;
    const id = typeof g === 'number' ? g : typeof g === 'object' ? (g.id ?? undefined) : detail.groups?.find((x) => x.name === g)?.id;
    const name = m.name ?? detail.groups?.find((x) => x.id === id)?.name ?? groupName(g);
    return { key: `g${id ?? name}`, kind: 'group', group: id, name, role: m.role };
  }
  return null;
}

/** People and groups who change the board: editors change cards and columns, owners also manage the board. */
export function MembersDialog({ detail, canManage, onClose, onSaved }: { detail: BoardDetail; canManage: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const groups = detail.groups ?? [];
  const [members, setMembers] = useState<DraftMember[]>(() => detail.members.map((m) => draftOf(m, detail)).filter((m): m is DraftMember => m !== null));
  const [kind, setKind] = useState(0);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const takenUsers = new Set(members.filter((m) => m.kind === 'user').map((m) => m.user));
  const takenGroups = new Set(members.filter((m) => m.kind === 'group').map((m) => m.group));
  const add = () => {
    if (!pick) return;
    if (kind === 0) {
      const person = detail.people.find((p) => String(p.id) === pick);
      if (person) setMembers((ms) => [...ms, { key: `u${person.id}`, kind: 'user', user: person.id, name: person.username, role: 'editor' }]);
    } else {
      const group = groups.find((g) => String(g.id) === pick);
      if (group) setMembers((ms) => [...ms, { key: `g${group.id}`, kind: 'group', group: group.id, name: group.name, role: 'editor' }]);
    }
    setPick('');
  };
  const save = async () => {
    if (!members.some((m) => m.role === 'owner')) {
      toast({ status: 'warning', title: t('A board needs at least one owner.') });
      return;
    }
    setBusy(true);
    try {
      const body: MemberInput[] = members.map((m) => (m.kind === 'user' ? { user: m.user, role: m.role } : { group: m.group, role: m.role }));
      await saveMembers(detail.board.id, body);
      onSaved();
      onClose();
    } catch (err) {
      toast({ status: 'error', title: apiErrorMessage(err, t('Could not save the members')) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t('Members')}
      onClose={onClose}
      size="lg"
      footer={
        canManage ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void save()} isLoading={busy} data-testid="save-members">
              {t('Save')}
            </Button>
          </>
        ) : (
          <Button variant="subtle" onClick={onClose}>
            {t('Close')}
          </Button>
        )
      }
    >
      <Text fontSize="sm" color="mutedText" mb={4}>
        {t('Everyone signed in can look at this board. Members change it: editors work on tasks and stages, owners also choose the members.')}
      </Text>
      <VStack align="stretch" spacing={2} mb={4} data-testid="members-list">
        {members.map((m) => (
          <Flex key={m.key} align="center" gap={3} p={2} borderRadius="lg" bg="chipBg">
            {m.kind === 'user' ? (
              <PersonAvatar name={m.name} size="sm" />
            ) : (
              <Flex w="32px" h="32px" borderRadius="full" bg="rgba(99,102,241,0.18)" color="brand.400" align="center" justify="center">
                <UsersIcon boxSize={4} />
              </Flex>
            )}
            <Box flex={1} minW={0}>
              <Text fontWeight={600} fontSize="sm" noOfLines={1}>
                {m.name}
              </Text>
              <Text fontSize="xs" color="mutedText">
                {m.kind === 'user' ? t('Person') : t('Group')}
              </Text>
            </Box>
            <Choice
              size="sm"
              value={m.role}
              options={[
                { value: 'editor', label: t('Editor'), hint: t('Works on tasks and stages') },
                { value: 'owner', label: t('Owner'), hint: t('Also chooses the members') },
              ]}
              isDisabled={!canManage}
              onChange={(v) => setMembers((ms) => ms.map((x) => (x.key === m.key ? { ...x, role: v as Role } : x)))}
              label={t('Role of {name}', { name: m.name })}
              testId="member-role"
            />
            {canManage && (
              <Tooltip label={t('Remove {name}', { name: m.name })} hasArrow>
                <IconButton aria-label={t('Remove {name}', { name: m.name })} variant="ghost" icon={<TrashIcon boxSize={4} />} onClick={() => setMembers((ms) => ms.filter((x) => x.key !== m.key))} />
              </Tooltip>
            )}
          </Flex>
        ))}
        {!members.length && (
          <Text fontSize="sm" color="faintText">
            {t('No members yet.')}
          </Text>
        )}
      </VStack>
      {canManage && (
        <Box borderTop="1px solid" borderColor="lineColor" pt={4}>
          <Tabs index={kind} onChange={(i) => { setKind(i); setPick(''); }} size="md" variant="soft-rounded" colorScheme="brand" mb={3}>
            <TabList>
              <Tab>{t('Person')}</Tab>
              <Tab>{t('Group')}</Tab>
            </TabList>
          </Tabs>
          <HStack>
            <Choice
              flex={1}
              minW={0}
              justifyContent="space-between"
              value={pick}
              options={
                kind === 0
                  ? detail.people.filter((p) => p.active !== false && !takenUsers.has(p.id)).map((p) => ({ value: String(p.id), label: p.username }))
                  : groups.filter((g) => !takenGroups.has(g.id)).map((g) => ({ value: String(g.id), label: g.name }))
              }
              onChange={setPick}
              placeholder={kind === 0 ? t('Choose a person') : t('Choose a group')}
              label={kind === 0 ? t('Choose a person') : t('Choose a group')}
              searchable
              testId="member-pick"
            />
            <Button leftIcon={<PlusIcon boxSize={4} />} onClick={add} isDisabled={!pick} data-testid="add-member">
              {t('Add')}
            </Button>
          </HStack>
        </Box>
      )}
    </Dialog>
  );
}

/** The board's labels: name and colour; used on cards and in the filter. */
export function LabelsDialog({ boardId, labels, canEdit, onClose, onChanged }: { boardId: number; labels: Label[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState('teal');
  const [editing, setEditing] = useState<Label | null>(null);
  const run = async (what: () => Promise<unknown>) => {
    try {
      await what();
      onChanged();
    } catch (err) {
      toast({ status: 'error', title: apiErrorMessage(err, t('Could not save the change')) });
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const label = editing;
    void run(() => (label ? updateLabel(label.id, { name: name.trim(), color }) : createLabel(boardId, { name: name.trim(), color }))).then(() => {
      setName('');
      setEditing(null);
    });
  };
  return (
    <Dialog
      title={t('Labels')}
      onClose={onClose}
      footer={
        <Button variant="subtle" onClick={onClose}>
          {t('Close')}
        </Button>
      }
    >
      <VStack align="stretch" spacing={2} mb={4}>
        {labels.map((l) => (
          <Flex key={l.id} align="center" gap={2} p={2} borderRadius="lg" _hover={{ bg: 'panelHover' }}>
            <Box flex={1} minW={0}>
              <LabelChip label={l} />
            </Box>
            {canEdit && (
              <>
                <Button variant="ghost" flexShrink={0} onClick={() => { setEditing(l); setName(l.name); setColor(l.color); }}>
                  {t('Edit')}
                </Button>
                <IconButton aria-label={t('Delete the label {name}', { name: l.name })} title={t('Delete the label {name}', { name: l.name })} variant="ghost" icon={<TrashIcon boxSize={4} />} onClick={() => { if (window.confirm(t('Delete the label “{name}”? Tasks lose it. This cannot be undone.', { name: l.name }))) void run(() => deleteLabel(l.id)); }} />
              </>
            )}
          </Flex>
        ))}
        {!labels.length && (
          <Text fontSize="sm" color="faintText">
            {t('No labels yet. Labels sort tasks by kind of work, e.g. “Maintenance” or “Quality”.')}
          </Text>
        )}
      </VStack>
      {canEdit && (
        <Box as="form" onSubmit={submit} borderTop="1px solid" borderColor="lineColor" pt={4}>
          <Text fontSize="sm" fontWeight={600} mb={2}>
            {editing ? t('Edit the label') : t('New label')}
          </Text>
          <HStack mb={3}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('Label name')} data-testid="label-name" />
            <Button type="submit" isDisabled={!name.trim()} data-testid="save-label">
              {editing ? t('Save') : t('Add')}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => { setEditing(null); setName(''); }}>
                {t('Cancel')}
              </Button>
            )}
          </HStack>
          <ColorPicker value={color} onChange={setColor} />
        </Box>
      )}
    </Dialog>
  );
}
