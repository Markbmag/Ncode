/** K3: pick a Search & BI dashboard or question to link from a task. Only what the person may open is
 * offered (the lists come from the BI side with their permissions). */
import { useState } from 'react';
import { Box, Button, Input, InputGroup, InputLeftElement, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Skeleton, Text, VStack } from '@chakra-ui/react';
import { useDashboards } from '../dashboards/api';
import { SearchIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { useQuestions } from '../library/api';
import { BarChartIcon } from './icons';

export function LinkPicker({ onPick, onClose }: { onPick: (kind: 'dashboard' | 'question', id: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = q.trim() || undefined;
  const dashboards = useDashboards({ q: term, limit: 20 });
  const questions = useQuestions({ q: term, limit: 20 });
  const list = (title: string, kind: 'dashboard' | 'question', items: { id: number; name: string; description?: string | null }[] | undefined, pending: boolean) => (
    <Box>
      <Text fontWeight={700} color="mutedText" fontSize="sm" mb={1.5} textTransform="uppercase" letterSpacing="0.04em">
        {title}
      </Text>
      {pending ? (
        <Skeleton h="44px" borderRadius="lg" />
      ) : items?.length ? (
        <VStack align="stretch" spacing={1.5}>
          {items.map((it) => (
            <Button key={it.id} variant="subtle" h="auto" minH="48px" py={2} justifyContent="flex-start" textAlign="left" whiteSpace="normal" onClick={() => onPick(kind, it.id)} data-testid="link-option" data-kind={kind}>
              <Box>
                <Text fontWeight={600}>{it.name}</Text>
                {it.description && (
                  <Text fontSize="sm" color="mutedText" fontWeight={400} noOfLines={1}>
                    {it.description}
                  </Text>
                )}
              </Box>
            </Button>
          ))}
        </VStack>
      ) : (
        <Text color="mutedText">{term ? t('Nothing found.') : t('Nothing here yet.')}</Text>
      )}
    </Box>
  );
  return (
    <Modal isOpen onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={3} data-testid="link-picker">
        <ModalHeader display="flex" alignItems="center" gap={2}>
          <BarChartIcon boxSize={5} color="brand.400" />
          {t('Link a dashboard or question')}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <Text color="mutedText" mb={3}>
            {t('People who may open it in Search & BI see its name on the task and can open it from there.')}
          </Text>
          <InputGroup mb={4}>
            <InputLeftElement pointerEvents="none">
              <SearchIcon boxSize={4} color="mutedText" />
            </InputLeftElement>
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name')} data-testid="link-search" />
          </InputGroup>
          <VStack align="stretch" spacing={5}>
            {list(t('Dashboards'), 'dashboard', dashboards.data, dashboards.isPending)}
            {list(t('Questions'), 'question', questions.data, questions.isPending)}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
