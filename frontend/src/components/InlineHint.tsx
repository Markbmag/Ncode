import type { ReactNode } from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { t } from '../i18n/index.ts';

interface Props {
  icon?: ReactNode;
  title?: string;
  /** what goes here, in plain words */
  children: ReactNode;
  /** one example ("Example: …") */
  example?: string;
  /** one button or link */
  action?: ReactNode;
  testId?: string;
}

/** An empty list that teaches (M11): what goes here, one example and one action - inside a panel. */
export function InlineHint({ icon, title, children, example, action, testId = 'inline-hint' }: Props) {
  return (
    <Flex direction={{ base: 'column', sm: 'row' }} align={{ base: 'flex-start', sm: 'center' }} gap={3} px={3} py={4} data-testid={testId}>
      {icon && (
        <Flex w="32px" h="32px" align="center" justify="center" borderRadius="lg" bg="chipBg" color="brand.300" flexShrink={0}>
          {icon}
        </Flex>
      )}
      <Box flex={1} minW={0}>
        {title && (
          <Text fontSize="sm" fontWeight={600}>
            {title}
          </Text>
        )}
        <Text fontSize="sm" color="mutedText">
          {children}
        </Text>
        {example && (
          <Text fontSize="xs" color="faintText" mt={1}>
            {t('Example: {example}', { example })}
          </Text>
        )}
      </Box>
      {action && <Box flexShrink={0}>{action}</Box>}
    </Flex>
  );
}
