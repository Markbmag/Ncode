import { ButtonGroup, IconButton, Tooltip } from '@chakra-ui/react';
import { RedoIcon, UndoIcon } from '../../icons';
import type { DraftHistory } from '../../query/useDraftHistory';
import { t } from '../../i18n/index.ts';

/** Undo / redo of the whole draft (M12), next to Run. */
export function UndoButtons({ history }: { history: DraftHistory }) {
  return (
    <ButtonGroup size="sm" variant="ghost" spacing={0}>
      <Tooltip label={t('Undo (Ctrl/Cmd + Z)')} hasArrow openDelay={300}>
        <IconButton aria-label={t('Undo')} icon={<UndoIcon boxSize={4} />} onClick={history.undo} isDisabled={!history.canUndo} data-testid="undo" />
      </Tooltip>
      <Tooltip label={t('Redo (Ctrl/Cmd + Shift + Z)')} hasArrow openDelay={300}>
        <IconButton aria-label={t('Redo')} icon={<RedoIcon boxSize={4} />} onClick={history.redo} isDisabled={!history.canRedo} data-testid="redo" />
      </Tooltip>
    </ButtonGroup>
  );
}
