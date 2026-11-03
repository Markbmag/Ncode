/**
 * Destructive builder changes ask first (M12): "Changing the table removes 2 filters and the
 * summary. Change anyway?" - and once done, a toast offers Undo.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, useToast } from '@chakra-ui/react';
import { ConfirmDialog } from '../../library/dialogs';
import { t } from '../../i18n/index.ts';

export interface ChangeQuestion {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** `ask` opens the dialog; `dialog` goes into the page. */
export function useConfirmChange(): { ask: (q: ChangeQuestion) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<ChangeQuestion | null>(null);
  const dialog = pending ? (
    <ConfirmDialog
      isOpen
      onClose={() => setPending(null)}
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      onConfirm={async () => pending.onConfirm()}
    />
  ) : null;
  return { ask: setPending, dialog };
}

/** A short note that something was removed, with an Undo button. */
export function useUndoToast(): (title: string, onUndo: () => void) => void {
  const toast = useToast();
  return (title, onUndo) => {
    const id = toast({
      status: 'info',
      title,
      duration: 6000,
      isClosable: true,
      description: (
        <Button
          size="xs"
          variant="outline"
          colorScheme="whiteAlpha"
          color="inherit"
          mt={1}
          onClick={() => {
            onUndo();
            toast.close(id);
          }}
          data-testid="toast-undo"
        >
          {t('Undo')}
        </Button>
      ),
    });
  };
}
