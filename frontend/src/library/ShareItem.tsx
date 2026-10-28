/**
 * "Share" on a question or a dashboard, for everyone who can see it (M11). The dialog says in
 * plain words who can see the item now and offers the ways to share it: move it to a shared
 * collection, give people access to its collection (the collection's own sharing dialog),
 * copy its link - and, for admins, a public link or an embed.
 */
import { useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Box, Button, Checkbox, Flex, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader,
  ModalOverlay, Select, Skeleton, Text, VStack, useDisclosure, useToast,
} from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { apiErrorMessage } from '../api';
import { dashboards } from '../dashboards/api';
import { CopyIcon, FolderIcon, GlobeIcon, LockIcon, UsersIcon } from '../icons';
import { ShareDialog as PublicShareDialog } from '../sharing/ShareDialog';
import { useWorkspace } from '../workspace/useWorkspace';
import { t, tc, tn } from '../i18n/index.ts';
import { library, useCollection, useCollections } from './api';
import { ShareDialog as AccessDialog } from './dialogs';
import { audienceOf, questionsToMove, shareTargets } from './shareLogic';

export interface ShareTarget {
  type: 'question' | 'dashboard';
  id: number;
  name: string;
  collectionId: number;
  /** may move it (edit access) */
  canEdit: boolean;
  /** dashboards: the questions on its cards (the ones in your own collection can move along) */
  questionIds?: (number | null | undefined)[];
  /** parameters, for a public link */
  params: { name: string; label: string }[];
}

/** The header button; the dialog mounts only while open. */
export function ShareButton({ target }: { target: ShareTarget }) {
  const dialog = useDisclosure();
  return (
    <>
      <Button size="sm" variant="subtle" leftIcon={<UsersIcon boxSize={4} />} onClick={dialog.onOpen} data-testid="share-button">
        {tc('verb', 'Share')}
      </Button>
      {dialog.isOpen && <ShareItemDialog target={target} onClose={dialog.onClose} />}
    </>
  );
}

const NEW = 'new';

function Option({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Box border="1px solid" borderColor="lineColor" borderRadius="lg" p={3}>
      <HStack spacing={2} mb={1.5}>
        <Box color="brand.300">{icon}</Box>
        <Text fontSize="sm" fontWeight={700}>
          {title}
        </Text>
      </HStack>
      <VStack align="stretch" spacing={2} fontSize="sm">
        {children}
      </VStack>
    </Box>
  );
}

export function ShareItemDialog({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const collections = useCollections();
  const [collectionId, setCollectionId] = useState(target.collectionId); // changes after a move
  const [pick, setPick] = useState('');
  const [newName, setNewName] = useState('');
  const [alsoQuestions, setAlsoQuestions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const access = useDisclosure();
  const publicLink = useDisclosure();

  const all = useMemo(() => collections.data?.collections ?? [], [collections.data]);
  const col = all.find((c) => c.id === collectionId) ?? null;
  const audience = col ? audienceOf(all, col.id) : null;
  const targets = useMemo(() => shareTargets(all, collectionId), [all, collectionId]);
  // a dashboard moved out of your collection takes the questions on it from there too (or people see empty cards)
  const personalId = collections.data?.personal_id ?? null;
  const own = useCollection(target.type === 'dashboard' && target.canEdit && collectionId === personalId ? personalId : null);
  const moveAlong = target.type === 'dashboard' ? questionsToMove(target.questionIds ?? [], (own.data?.questions ?? []).map((q) => q.id)) : [];
  const path = `/${target.type === 'dashboard' ? 'dashboards' : 'questions'}/${target.id}`;

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      let dest = Number(pick);
      let destName = targets.find((c) => c.id === dest)?.name ?? '';
      if (pick === NEW) {
        const created = await library.createCollection({ name: newName.trim(), parent_id: null });
        dest = created.id;
        destName = created.name;
      }
      if (target.type === 'dashboard') {
        await dashboards.update(target.id, { collection_id: dest });
        if (alsoQuestions) for (const qid of moveAlong) await library.updateQuestion(qid, { collection_id: dest });
      } else {
        await library.updateQuestion(target.id, { collection_id: dest });
      }
      setCollectionId(dest);
      setPick('');
      setNewName('');
      toast({ status: 'success', title: t('Moved to “{name}”', { name: destName }), duration: 2500 });
    } catch (e) {
      setError(apiErrorMessage(e, t('That did not work')));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const link = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ status: 'success', title: t('Link copied'), duration: 1500 });
    } catch {
      toast({ status: 'warning', title: t('Copy it by hand'), description: link, duration: 8000, isClosable: true });
    }
  };

  const canMove = pick !== '' && (pick !== NEW || newName.trim() !== '') && !busy;
  return (
    <Modal isOpen onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent data-testid="share-item-dialog">
        <ModalHeader fontSize="md" pr={10}>
          {tc('item', 'Share “{name}”', { name: target.name })}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={5}>
          {collections.isPending && <Skeleton h="140px" borderRadius="lg" />}
          {collections.isError && (
            <Alert status="error" borderRadius="md" fontSize="sm">
              <AlertIcon />
              {apiErrorMessage(collections.error, t('Could not load collections'))}
            </Alert>
          )}
          {collections.data && (
            <VStack align="stretch" spacing={3}>
              {/* who can see it now */}
              <Flex gap={3} align="flex-start" bg="chipBg" borderRadius="lg" p={3} data-testid="share-audience">
                <Box color={audience === 'shared' ? 'green.300' : 'orange.300'} pt={0.5}>
                  {audience === 'shared' ? <UsersIcon boxSize={4} /> : <LockIcon boxSize={4} />}
                </Box>
                <Text fontSize="sm">
                  {!col
                    ? t('It is in a collection you cannot open. People who can open that collection can see it.')
                    : audience === 'private'
                      ? col.mine
                        ? t('It is in your private collection: only you and admins can see it.')
                        : t('It is in “{name}”, a private collection: only its owner and admins can see it.', { name: col.name })
                      : audience === 'restricted'
                        ? t('It is in “{name}”. Nobody has been given access to that collection yet: only its owner and admins can see it.', { name: col.name })
                        : t('It is in “{name}”: everyone who can open that collection can see it.', { name: col.name })}
                </Text>
              </Flex>

              {/* 1. move it */}
              {target.canEdit && (
                <Option icon={<FolderIcon boxSize={4} />} title={audience === 'shared' ? t('Move it to another collection') : t('Move it to a shared collection')}>
                  <Text color="mutedText">
                    {targets.length
                      ? target.type === 'dashboard'
                        ? t('Pick a collection your team can open: the dashboard moves there.')
                        : t('Pick a collection your team can open: the question moves there.')
                      : audience === 'shared'
                        ? t('To move it, make a new collection: choose “A new collection…”.')
                        : t('There is no shared collection you can add to yet. Make one, for example “Production reports”, then give people access to it.')}
                  </Text>
                  <Select size="sm" value={pick} onChange={(e) => setPick(e.target.value)} placeholder={t('Choose a collection…')} aria-label={t('Collection')} data-testid="share-move-target">
                    {targets.map((c) => (
                      <option key={c.id} value={c.id}>
                        {'  '.repeat(c.depth)}
                        {c.name}
                        {audienceOf(all, c.id) === 'shared' ? ` · ${t('shared')}` : ''}
                      </option>
                    ))}
                    <option value={NEW}>{t('A new collection…')}</option>
                  </Select>
                  {pick === NEW && (
                    <Input size="sm" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} placeholder={t('Name of the new collection')} autoFocus data-testid="share-new-collection" />
                  )}
                  {moveAlong.length > 0 && (
                    <Checkbox size="sm" isChecked={alsoQuestions} onChange={(e) => setAlsoQuestions(e.target.checked)}>
                      {tn(moveAlong.length, 'Also move the {n} question on it from your collection (otherwise people see an empty card)', 'Also move the {n} questions on it from your collection (otherwise people see empty cards)')}
                    </Checkbox>
                  )}
                  <Box>
                    <Button size="sm" variant="brand" onClick={() => void move()} isDisabled={!canMove} isLoading={busy} data-testid="share-move">
                      {pick === NEW ? t('Create and move') : t('Move')}
                    </Button>
                  </Box>
                </Option>
              )}

              {/* 2. give people access to its collection */}
              {col && (
                <Option icon={<UsersIcon boxSize={4} />} title={t('Give a person or group access to its collection')}>
                  {audience === 'private' ? (
                    <Text color="mutedText">{t('Your own collection cannot be shared. Move it to a shared collection first.')}</Text>
                  ) : col.can_manage ? (
                    <>
                      <Text color="mutedText">{t('Everyone you add sees everything in “{name}”, not only this.', { name: col.name })}</Text>
                      <Box>
                        <Button size="sm" variant="subtle" onClick={access.onOpen} data-testid="share-access">
                          {t('Choose people…')}
                        </Button>
                      </Box>
                    </>
                  ) : (
                    <Text color="mutedText">{t('Only the owner of “{name}” or an admin can give more people access. Ask them, or move it to a collection you manage.', { name: col.name })}</Text>
                  )}
                </Option>
              )}

              {/* 3. the link */}
              <Option icon={<CopyIcon boxSize={4} />} title={t('Send the link')}>
                <Text color="mutedText">{t('People who can see it open it with this link; others are asked to sign in or see “not found”.')}</Text>
                <Box>
                  <Button size="sm" variant="subtle" leftIcon={<CopyIcon boxSize={4} />} onClick={() => void copyLink()} data-testid="share-copy-link">
                    {t('Copy link')}
                  </Button>
                </Box>
              </Option>

              {/* 4. admins: outside Ncode */}
              {ws.isAdmin && (
                <Option icon={<GlobeIcon boxSize={4} />} title={t('Public link / embed')}>
                  <Text color="mutedText">{t('Anyone with a public link sees the results, without an account. Admins only.')}</Text>
                  <Box>
                    <Button size="sm" variant="subtle" leftIcon={<GlobeIcon boxSize={4} />} onClick={publicLink.onOpen} data-testid="share-public">
                      {t('Public link / embed…')}
                    </Button>
                  </Box>
                </Option>
              )}

              {error && (
                <Alert status="error" borderRadius="md" fontSize="sm">
                  <AlertIcon />
                  {error}
                </Alert>
              )}
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
      {col && col.can_manage && audience !== 'private' && <AccessDialog isOpen={access.isOpen} onClose={access.onClose} collection={col} />}
      {publicLink.isOpen && <PublicShareDialog isOpen onClose={publicLink.onClose} target={{ type: target.type, id: target.id, name: target.name, params: target.params }} />}
    </Modal>
  );
}
