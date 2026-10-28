import { useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, Button, Text,
} from '@chakra-ui/react';
import { isEditConflict } from './conflict';
import { t } from '../i18n/index.ts';

interface Choices {
  reload: () => unknown; // drop my changes, show what is saved now
  overwrite: () => Promise<unknown>; // save mine again, without the check
}

/**
 * Offers "Reload their version" / "Save mine anyway" when a save hit an edit conflict.
 * `offer(error, choices)` returns false for any other error (the caller shows it as usual).
 */
export function useEditConflict() {
  const [choices, setChoices] = useState<Choices | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const offer = (error: unknown, next: Choices): boolean => {
    if (!isEditConflict(error)) return false;
    setChoices(next);
    return true;
  };
  const close = () => setChoices(null);
  const dialog = (
    <AlertDialog isOpen={choices !== null} leastDestructiveRef={cancelRef} onClose={close} isCentered>
      <AlertDialogOverlay />
      <AlertDialogContent data-testid="edit-conflict">
        <AlertDialogHeader fontSize="md">{t('Someone else saved this meanwhile')}</AlertDialogHeader>
        <AlertDialogBody>
          <Text fontSize="sm">
            {t('It changed after you opened it. Reload to see their version (your changes are dropped), or save yours anyway and replace theirs.')}
          </Text>
        </AlertDialogBody>
        <AlertDialogFooter gap={2}>
          <Button
            ref={cancelRef}
            size="sm"
            variant="subtle"
            onClick={() => {
              void choices?.reload();
              close();
            }}
            data-testid="conflict-reload"
          >
            {t('Reload their version')}
          </Button>
          <Button
            size="sm"
            colorScheme="red"
            isLoading={busy}
            onClick={() => {
              if (!choices) return;
              setBusy(true);
              void choices.overwrite().finally(() => {
                setBusy(false);
                close();
              });
            }}
            data-testid="conflict-overwrite"
          >
            {t('Save mine anyway')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { offer, dialog };
}
