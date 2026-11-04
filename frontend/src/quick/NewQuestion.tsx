import type { ReactNode } from 'react';
import {
  HStack, Skeleton, Switch, Text,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import type { QuerySpec } from '../query/types';
import type { VizState } from '../viz/state';
import { QuickQuestion } from './QuickQuestion';
import type { EditorMode } from './quick';
import { useEditorChoice } from './useEditorChoice';
import { t } from '../i18n/index.ts';

/** The builder's draft of a database in this tab (pages/QuestionsPage.tsx reads it when it opens). */
const builderDraftKey = (connection: string) => `ncode_question_${connection}`;

function handOver(connection: string, spec: QuerySpec, viz: VizState) {
  try {
    sessionStorage.setItem(builderDraftKey(connection), JSON.stringify(spec));
    sessionStorage.setItem(`${builderDraftKey(connection)}_viz`, JSON.stringify(viz));
  } catch {
    // without storage the full editor starts empty
  }
}

/** "Full editor" on / off: the choice is remembered for the person. */
export function EditorSwitch({ mode, onChange }: { mode: EditorMode; onChange: (mode: EditorMode) => void }) {
  return (
    <Tooltip
      label={mode === 'full' ? t('Off: the quick question, a few plain choices on one screen') : t('Every step: joins, formulas, sorting, calculations')}
      hasArrow
      openDelay={300}
    >
      <HStack spacing={1.5}>
        <Switch size="sm" id="full-editor" isChecked={mode === 'full'} onChange={(e) => onChange(e.target.checked ? 'full' : 'quick')} data-testid="editor-switch" />
        <Text as="label" htmlFor="full-editor" fontSize="xs" color="mutedText" whiteSpace="nowrap">
          {t('Full editor')}
        </Text>
      </HStack>
    </Tooltip>
  );
}

/**
 * "New question" (M12): the quick question for newcomers, or the full builder for those who
 * switched to it. `full` renders the builder with the switch in its header.
 */
export function NewQuestion({ connection, full }: { connection: string; full: (modeSwitch: ReactNode) => ReactNode }) {
  const choice = useEditorChoice();
  if (!choice.ready) return <Skeleton h="400px" borderRadius="2xl" />;
  const modeSwitch = <EditorSwitch mode={choice.mode} onChange={choice.choose} />;
  if (choice.mode === 'full') return <>{full(modeSwitch)}</>;
  return (
    <QuickQuestion
      key={connection}
      connection={connection}
      modeSwitch={modeSwitch}
      onOpenFull={(spec, viz) => {
        handOver(connection, spec, viz);
        choice.open('full');
      }}
    />
  );
}
