/** A drop-down in the app's own look (Mark: "drop-down lists are sometimes default"): the browser's
 * <select> opens the system's list (white on Windows, a wheel on iPhone), this one opens a themed menu
 * everywhere. The button grows with its text, so Russian words are never cut. With `searchable` a
 * search field sits on top (long lists of people). */
import { useRef, useState, type ReactNode } from 'react';
import { Box, Button, HStack, Input, Menu, MenuButton, MenuItemOption, MenuList, MenuOptionGroup, Portal, Text, type ButtonProps } from '@chakra-ui/react';
import { ChevronDownIcon } from '../icons';
import { t } from '../i18n/index.ts';

export interface ChoiceOption {
  value: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

interface Props extends Omit<ButtonProps, 'onChange' | 'value'> {
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  label: string; // for screen readers: what is chosen
  placeholder?: string; // shown when value matches no option
  searchable?: boolean;
  testId?: string;
  isDisabled?: boolean;
}

export function Choice({ value, options, onChange, label, placeholder, searchable = false, testId, isDisabled = false, ...button }: Props) {
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const picked = options.find((o) => o.value === value);
  const term = q.trim().toLocaleLowerCase();
  const shown = term ? options.filter((o) => o.label.toLocaleLowerCase().includes(term)) : options;
  return (
    <Menu isLazy placement="bottom-start" onClose={() => setQ('')} initialFocusRef={searchable ? search : undefined} autoSelect={!searchable}>
      <MenuButton
        as={Button}
        variant="outline"
        fontWeight={600}
        rightIcon={isDisabled ? undefined : <ChevronDownIcon boxSize={4} />}
        isDisabled={isDisabled}
        _disabled={{ opacity: 1, cursor: 'default' }}
        aria-label={`${label}: ${picked?.label ?? placeholder ?? ''}`}
        data-testid={testId}
        data-value={value}
        flexShrink={0}
        maxW="100%"
        h="auto"
        minH={button.size === 'sm' ? '32px' : '40px'}
        py={1.5}
        whiteSpace="normal"
        textAlign="left"
        {...button}
      >
        <HStack as="span" spacing={2}>
          {picked?.icon}
          <Text as="span" color={picked ? undefined : 'mutedText'} fontWeight={picked ? 600 : 500}>
            {picked?.label ?? placeholder ?? t('Choose')}
          </Text>
        </HStack>
      </MenuButton>
      <Portal>
        <MenuList zIndex={1700} maxH="320px" overflowY="auto" minW="200px" maxW="min(360px, calc(100vw - 24px))" fontSize="md" onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()} data-testid={testId ? `${testId}-menu` : undefined}>
          {searchable && (
            <Box px={3} pb={2} pt={1}>
              <Input
                ref={search}
                size="sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') e.stopPropagation(); // typing is not the menu's "jump to item"
                }}
                placeholder={t('Type to search')}
                aria-label={t('Type to search')}
                data-testid={testId ? `${testId}-search` : undefined}
              />
            </Box>
          )}
          <MenuOptionGroup type="radio" value={value} onChange={(v) => v !== value && onChange(String(v))}>
            {shown.map((o) => (
              <MenuItemOption key={o.value} value={o.value} data-testid={testId ? `${testId}-option` : undefined} data-value={o.value}>
                <HStack spacing={2} align="center">
                  {o.icon}
                  <Box>
                    <Text as="span">{o.label}</Text>
                    {o.hint && (
                      <Text fontSize="sm" color="mutedText">
                        {o.hint}
                      </Text>
                    )}
                  </Box>
                </HStack>
              </MenuItemOption>
            ))}
          </MenuOptionGroup>
          {!shown.length && (
            <Text px={3} py={2} color="mutedText">
              {t('Nothing found.')}
            </Text>
          )}
        </MenuList>
      </Portal>
    </Menu>
  );
}
