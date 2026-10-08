import {
  Badge, Box, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay, Flex, HStack,
  IconButton, Text, Tooltip, VStack, useToast,
} from '@chakra-ui/react';
import type { MatchMode, SearchHit } from '../api';
import { CopyIcon } from '../icons';
import { Highlight } from './Highlight';

interface RowDrawerProps {
  hit: SearchHit | null;
  onClose: () => void;
  phrase: string;
  matchMode: MatchMode;
  caseSensitive: boolean;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function RowDrawer({ hit, onClose, phrase, matchMode, caseSensitive }: RowDrawerProps) {
  const toast = useToast();

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied`, status: 'success', duration: 1800 });
    } catch {
      toast({ title: 'Copy is not available in this browser context', status: 'warning', duration: 2500 });
    }
  };

  return (
    <Drawer isOpen={hit !== null} onClose={onClose} placement="right" size="md">
      <DrawerOverlay backdropFilter="blur(2px)" />
      <DrawerContent>
        <DrawerCloseButton />
        {hit && (
          <>
            <DrawerHeader borderBottom="1px solid" borderColor="lineColor" pr={12}>
              <Text fontSize="xs" color="mutedText" fontWeight={500}>
                Record from table
              </Text>
              <HStack spacing={3} mt={1} flexWrap="wrap">
                <Text fontFamily="mono" fontSize="lg">
                  {hit.table}
                </Text>
                {hit.id_column && (
                  <Badge colorScheme="brand" fontSize="xs" textTransform="none">
                    {hit.id_column}: {asText(hit.row[hit.id_column])}
                  </Badge>
                )}
              </HStack>
              <Tooltip label="Copy the whole record as JSON" hasArrow>
                <IconButton
                  aria-label="Copy as JSON"
                  size="xs"
                  icon={<CopyIcon boxSize={3.5} />}
                  position="absolute"
                  right={14}
                  top={4}
                  onClick={() => copy(JSON.stringify(hit.row, null, 2), 'Record')}
                />
              </Tooltip>
            </DrawerHeader>
            <DrawerBody px={0} py={0}>
              <VStack align="stretch" spacing={0}>
                {hit.cols.map((column) => {
                  const value = hit.row[column];
                  const isMatch = hit.matched_columns.includes(column);
                  const text = asText(value);
                  return (
                    <Flex
                      key={column}
                      direction="column"
                      gap={1}
                      px={6}
                      py={3}
                      borderBottom="1px solid"
                      borderColor="lineColor"
                      bg={isMatch ? 'rgba(99,102,241,0.08)' : undefined}
                      role="group"
                    >
                      <HStack justify="space-between">
                        <Text fontFamily="mono" fontSize="xs" color={isMatch ? 'brand.300' : 'mutedText'}>
                          {column}
                          {isMatch && ' · match'}
                        </Text>
                        {value !== null && value !== undefined && (
                          <IconButton
                            aria-label={`Copy ${column}`}
                            size="xs"
                            variant="ghost"
                            icon={<CopyIcon boxSize={3} />}
                            opacity={0}
                            _groupHover={{ opacity: 1 }}
                            _focus={{ opacity: 1 }}
                            onClick={() => copy(text, column)}
                          />
                        )}
                      </HStack>
                      <Box fontSize="sm" wordBreak="break-word" whiteSpace="pre-wrap">
                        {value === null || value === undefined ? (
                          <Text as="i" color="faintText">
                            NULL
                          </Text>
                        ) : isMatch ? (
                          <Highlight text={text} phrase={phrase} mode={matchMode} caseSensitive={caseSensitive} />
                        ) : (
                          text
                        )}
                      </Box>
                    </Flex>
                  );
                })}
              </VStack>
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
