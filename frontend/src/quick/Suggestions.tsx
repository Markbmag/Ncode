import { useMemo } from 'react';
import { Button, Flex, Text, Wrap, WrapItem } from '@chakra-ui/react';
import { SparklesIcon } from '../icons';
import type { SchemaInfo } from '../query/draft';
import { quickModel } from './quick';
import { suggestQuestions } from './suggest';
import type { Suggestion } from './suggest';
import { t } from '../i18n/index.ts';

interface Props {
  connection: string;
  schema: SchemaInfo;
  table: string;
  onPick: (suggestion: Suggestion) => void;
  /** the one now shown (quick question) */
  active?: string | null;
}

/** "Ready questions" for a table (M12): one click fills the question. */
export function QuestionSuggestions({ connection, schema, table, onPick, active = null }: Props) {
  const list = useMemo(() => {
    const model = quickModel(schema, table);
    return model ? suggestQuestions(model, schema, connection) : [];
  }, [schema, table, connection]);
  if (list.length === 0) return null;
  return (
    <Flex direction="column" gap={1.5} mt={2} data-testid="suggestions">
      <Text fontSize="xs" color="mutedText" fontWeight={700}>
        <SparklesIcon boxSize={3} mr={1} color="brand.300" />
        {t('Ready questions')}
        <Text as="span" fontWeight={400} color="faintText">
          {' '}
          {t('(one click fills in the question)')}
        </Text>
      </Text>
      <Wrap spacing={1.5}>
        {list.map((s) => (
          <WrapItem key={s.key} maxW="100%">
            <Button
              size="xs"
              variant={active === s.key ? 'brand' : 'subtle'}
              fontWeight={500}
              whiteSpace="normal"
              textAlign="left"
              h="auto"
              py={1}
              onClick={() => onPick(s)}
              data-testid={`suggestion-${s.key}`}
            >
              {s.title}
            </Button>
          </WrapItem>
        ))}
      </Wrap>
    </Flex>
  );
}
