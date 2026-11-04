import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box, Flex, HStack, IconButton, Text,
} from '@chakra-ui/react';
import { Tooltip } from '../Tooltip';
import { EyeIcon } from '../../icons';
import { PREVIEW_ROWS } from '../../query/preview';
import { t } from '../../i18n/index.ts';

interface StepProps {
  title: string;
  color: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
  testId?: string;
  /** which step this is (the builder scrolls to a step opened from "More steps") */
  anchor?: string;
  /** the first rows after this step (M12), shown under it while the eye button is on */
  preview?: () => ReactNode;
}

/** One block of the notebook-style builder (Data, Join, Filter, Summarise ...). */
export function Step({ title, color, hint, children, actions, testId, anchor, preview }: StepProps) {
  const [previewing, setPreviewing] = useState(false);
  const label = previewing ? t('Hide the preview') : t('Show the first {n} rows after this step', { n: PREVIEW_ROWS });
  return (
    <Box data-testid={testId} data-step={anchor}>
      <Flex align="center" justify="space-between" mb={1.5} gap={2}>
        <Text fontSize="xs" fontWeight={800} letterSpacing="0.08em" color={color} textTransform="uppercase">
          {title}
        </Text>
        <HStack spacing={0}>
          {preview && (
            <Tooltip label={label} hasArrow openDelay={300}>
              <IconButton
                aria-label={label}
                aria-pressed={previewing}
                size="xs"
                variant={previewing ? 'subtle' : 'ghost'}
                color={previewing ? undefined : 'faintText'}
                icon={<EyeIcon boxSize={3.5} />}
                onClick={() => setPreviewing((v) => !v)}
                data-testid="step-preview-toggle"
              />
            </Tooltip>
          )}
          {actions}
        </HStack>
      </Flex>
      <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderLeft="3px solid" borderLeftColor={color} borderRadius="xl" p={3}>
        {children}
        {hint && (
          <Text fontSize="xs" color="faintText" mt={2}>
            {hint}
          </Text>
        )}
      </Box>
      {preview && previewing && preview()}
    </Box>
  );
}
