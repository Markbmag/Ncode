/** K4: tasks that left the board because they were finished a while ago: search them, open one. */
import { useState } from 'react';
import { Button, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Skeleton, Text, VStack } from '@chakra-ui/react';
import { t, tn } from '../i18n/index.ts';
import { useFinishedEarlier } from './api';
import { fullTime } from './logic';

export function FinishedEarlier({ boardId, onOpen, onClose }: { boardId: number; onOpen: (id: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useFinishedEarlier(boardId, q.trim());
  return (
    <Modal isOpen onClose={onClose} size="md" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={3} data-testid="finished-earlier-list">
        <ModalHeader>{t('Finished earlier')}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <Text color="mutedText" mb={3}>
            {list.data
              ? tn(list.data.keep_days, 'Tasks finished more than {n} day ago. They are kept; open one to look at it or to move it back.', 'Tasks finished more than {n} days ago. They are kept; open one to look at it or to move it back.')
              : ' '}
          </Text>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name')} mb={3} data-testid="finished-search" />
          {list.isPending ? (
            <Skeleton h="44px" borderRadius="lg" />
          ) : list.data?.cards.length ? (
            <VStack align="stretch" spacing={2}>
              {list.data.cards.map((c) => (
                <Button key={c.id} variant="subtle" h="auto" minH="48px" py={2} justifyContent="flex-start" textAlign="left" whiteSpace="normal" onClick={() => { onClose(); onOpen(c.id); }} data-testid="finished-task">
                  <VStack align="flex-start" spacing={0}>
                    <Text fontWeight={600}>{c.title}</Text>
                    {c.completed_at && (
                      <Text fontSize="sm" color="mutedText" fontWeight={400}>
                        {t('Finished {when}', { when: fullTime(c.completed_at) })}
                      </Text>
                    )}
                  </VStack>
                </Button>
              ))}
              {list.data.total > list.data.cards.length && (
                <Text fontSize="sm" color="mutedText">
                  {t('The newest 100 are shown; search to find older ones.')}
                </Text>
              )}
            </VStack>
          ) : (
            <Text>{q.trim() ? t('Nothing found.') : t('Nothing here yet.')}</Text>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
