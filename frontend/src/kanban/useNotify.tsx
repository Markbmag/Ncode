import { useCallback } from 'react';
import { Box, Button, HStack, Text, useToast } from '@chakra-ui/react';
import { CheckIcon } from '../icons';
import { t } from '../i18n/index.ts';

interface NotifyOptions {
  undo?: () => void; // shows an "Undo" button
  error?: boolean;
}

let counter = 0;
let lastNotice: string | null = null; // shared by every page: one notice on screen at a time

/**
 * A short sentence at the bottom of the screen ("Moved to Done"), with Undo when the change can be
 * taken back. One at a time: a new one replaces the one before.
 */
export function useNotify() {
  const toast = useToast();
  return useCallback(
    (message: string, { undo, error }: NotifyOptions = {}) => {
      if (lastNotice) toast.close(lastNotice);
      counter += 1;
      const id = `notice-${counter}`;
      lastNotice = id;
      toast({
        id,
        position: 'bottom',
        duration: undo ? 7000 : error ? 6000 : 3000,
        render: ({ onClose }) => (
          <HStack
            bg={error ? 'red.500' : 'gray.800'}
            color="white"
            borderRadius="xl"
            boxShadow="xl"
            pl={4}
            pr={undo ? 2 : 4}
            py={2}
            spacing={3}
            minH="48px"
            data-testid="notice"
          >
            {!error && (
              <Box color="#4ade80">
                <CheckIcon boxSize={4} />
              </Box>
            )}
            <Text fontSize="md" fontWeight={500}>
              {message}
            </Text>
            {undo && (
              <Button
                size="sm"
                variant="ghost"
                color="#a5b4fc"
                _hover={{ bg: 'whiteAlpha.200' }}
                onClick={() => {
                  onClose();
                  undo();
                }}
                data-testid="notice-undo"
              >
                {t('Undo')}
              </Button>
            )}
          </HStack>
        ),
      });
    },
    [toast],
  );
}
