/** "Who does it": Ncode users and, by name, anyone else (Mark: "I type a random name and this name is now
 * tasked on the card, not only the accounts"). One field: type to find a person or to add a name. */
import { useState } from 'react';
import { Box, Button, Checkbox, Flex, HStack, IconButton, Input, Popover, PopoverBody, PopoverContent, PopoverTrigger, Portal, Text, VStack } from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { PlusIcon, XIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { personName } from './logic';
import { PersonAvatar } from './parts';
import type { Person } from './types';

interface Props {
  assignees: number[];
  names: string[];
  people: Person[];          // everyone who can be chosen (active users)
  allPeople: Person[];       // for showing names of the ones already chosen
  canEdit: boolean;
  onChange: (change: { assignees?: number[]; assignee_names?: string[] }) => void;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function WhoPicker({ assignees, names, people, allPeople, canEdit, onChange }: Props) {
  const [text, setText] = useState('');
  const typed = text.replace(/\s+/g, ' ').trim();
  const matching = typed ? people.filter((p) => p.username.toLocaleLowerCase().includes(typed.toLocaleLowerCase())) : people;
  const exactUser = people.find((p) => same(p.username, typed));
  const canAddName = typed.length > 0 && !exactUser && !names.some((n) => same(n, typed));
  const toggle = (id: number) => onChange({ assignees: assignees.includes(id) ? assignees.filter((x) => x !== id) : [...assignees, id] });
  const addName = () => {
    if (!canAddName) return;
    onChange({ assignee_names: [...names, typed.slice(0, 80)] });
    setText('');
  };
  const empty = !assignees.length && !names.length;

  return (
    <Flex gap={1.5} wrap="wrap" align="center">
      {assignees.map((id) => {
        const name = personName(id, allPeople);
        return (
          <HStack key={`u${id}`} spacing={1.5} pl={1} pr={canEdit ? 0.5 : 2.5} py={0.5} borderRadius="full" bg="chipBg" data-testid="assignee">
            <PersonAvatar name={name} size="xs" />
            <Text fontWeight={600}>{name}</Text>
            {canEdit && (
              <IconButton aria-label={t('Take {name} off this task', { name })} size="xs" variant="ghost" borderRadius="full" icon={<XIcon boxSize={3} />} onClick={() => toggle(id)} />
            )}
          </HStack>
        );
      })}
      {names.map((name) => (
        <Tooltip key={`n${name}`} label={t('Added by name: not an Ncode user')} hasArrow>
          <HStack spacing={1.5} pl={1} pr={canEdit ? 0.5 : 2.5} py={0.5} borderRadius="full" border="1px dashed" borderColor="lineColor" data-testid="assignee-name">
            <PersonAvatar name={name} size="xs" />
            <Text fontWeight={600}>{name}</Text>
            {canEdit && (
              <IconButton aria-label={t('Take {name} off this task', { name })} size="xs" variant="ghost" borderRadius="full" icon={<XIcon boxSize={3} />} onClick={() => onChange({ assignee_names: names.filter((n) => n !== name) })} />
            )}
          </HStack>
        </Tooltip>
      ))}
      {canEdit && (
        <Popover placement="bottom-start" isLazy onClose={() => setText('')}>
          <PopoverTrigger>
            <Button size="sm" variant="ghost" leftIcon={<PlusIcon boxSize={3.5} />} color="brand.500" _dark={{ color: 'brand.200' }} data-testid="assignees-button">
              {empty ? t('Choose who does it') : t('Add')}
            </Button>
          </PopoverTrigger>
          <Portal>
            <PopoverContent w="300px" zIndex={1700} data-testid="who-picker">
              <PopoverBody p={3}>
                <Input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (exactUser) {
                      toggle(exactUser.id);
                      setText('');
                    } else addName();
                  }}
                  placeholder={t('Type a name or pick someone')}
                  maxLength={80}
                  aria-label={t('Type a name or pick someone')}
                  data-testid="assignee-name-input"
                />
                {canAddName && (
                  <Button mt={2} w="100%" justifyContent="flex-start" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={addName} whiteSpace="normal" h="auto" py={2} textAlign="left" data-testid="assignee-name-add">
                    <Box>
                      <Text fontWeight={700}>{t('Add “{name}”', { name: typed })}</Text>
                      <Text fontSize="sm" color="mutedText" fontWeight={400}>
                        {t('For someone without an Ncode account')}
                      </Text>
                    </Box>
                  </Button>
                )}
                <Text fontSize="sm" color="mutedText" mt={3} mb={1}>
                  {t('Ncode users')}
                </Text>
                <VStack align="stretch" spacing={0} maxH="240px" overflowY="auto">
                  {matching.map((p) => (
                    <Checkbox key={p.id} isChecked={assignees.includes(p.id)} onChange={() => toggle(p.id)} px={1.5} py={1.5} borderRadius="md" _hover={{ bg: 'panelHover' }} data-testid="assignee-option">
                      <HStack spacing={2}>
                        <PersonAvatar name={p.username} size="xs" />
                        <Text as="span">{p.username}</Text>
                      </HStack>
                    </Checkbox>
                  ))}
                  {!matching.length && <Text color="mutedText" px={1.5}>{t('No Ncode user with this name.')}</Text>}
                </VStack>
              </PopoverBody>
            </PopoverContent>
          </Portal>
        </Popover>
      )}
      {!canEdit && empty && <Text color="mutedText">{t('Nobody yet')}</Text>}
    </Flex>
  );
}
