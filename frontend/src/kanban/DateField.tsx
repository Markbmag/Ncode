/** A date in the app's own look and language (Mark: the date block was "chopped" and hard to use): the
 * button says "Mon, 9 November 2026" / "Пн, 9 ноября 2026" instead of the browser's mm/dd/yyyy, and
 * opens a month calendar (Monday first) with Today / Tomorrow / Next week and Remove the date. */
import { useState } from 'react';
import { Box, Button, Flex, Grid, HStack, IconButton, Popover, PopoverBody, PopoverContent, PopoverTrigger, Portal, Text, type ButtonProps } from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { CalendarIcon } from './icons';
import { dateLabel, monthGrid, monthTitle, shiftIso, shiftMonth, todayIso, weekdayNames } from './logic';

interface Props extends Omit<ButtonProps, 'onChange' | 'value'> {
  value: string | null;
  onChange: (iso: string | null) => void;
  label: string; // what the date is, for screen readers
  placeholder: string; // shown without a date
  testId: string;
  isDisabled?: boolean;
  tone?: string; // colour of the text (late: red)
  min?: string | null; // days before it cannot be chosen
  max?: string | null; // days after it cannot be chosen
  limitNote?: string; // says why some days cannot be chosen
}

export function DateField({ value, onChange, label, placeholder, testId, isDisabled = false, tone, min, max, limitNote, ...button }: Props) {
  const today = todayIso();
  const start = value ?? today;
  const [shown, setShown] = useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 });
  const weeks = monthGrid(shown.year, shown.month);
  const names = weekdayNames();
  const inMonth = (iso: string) => Number(iso.slice(5, 7)) - 1 === shown.month;
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  return (
    <Popover
      placement="bottom-start"
      isLazy
      onOpen={() => {
        const at = value ?? todayIso();
        setShown({ year: Number(at.slice(0, 4)), month: Number(at.slice(5, 7)) - 1 });
      }}
    >
      {({ isOpen, onClose }) => {
        const pick = (iso: string | null) => {
          onChange(iso);
          onClose();
        };
        return (
          <>
            <PopoverTrigger>
              <Button
                variant="outline"
                fontWeight={value ? 600 : 500}
                color={value ? tone : 'mutedText'}
                borderColor={tone && value ? tone : undefined}
                leftIcon={<CalendarIcon boxSize={4} />}
                isDisabled={isDisabled}
                _disabled={{ opacity: 1, cursor: 'default' }}
                whiteSpace="normal"
                h="auto"
                minH="40px"
                py={2}
                textAlign="left"
                aria-label={`${label}: ${value ? dateLabel(value) : placeholder}`}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && isOpen) {
                    e.stopPropagation(); // closes the calendar, not the task around it
                    onClose();
                  }
                }}
                data-testid={testId}
                data-value={value ?? ''}
                {...button}
              >
                {value ? dateLabel(value) : placeholder}
              </Button>
            </PopoverTrigger>
            <Portal>
              <PopoverContent w="304px" maxW="calc(100vw - 24px)" zIndex={1700} onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()} data-testid={`${testId}-picker`}>
                <PopoverBody p={3}>
                  <Flex align="center" justify="space-between" mb={2}>
                    <IconButton aria-label={t('Previous month')} variant="ghost" size="sm" icon={<ChevronLeftIcon boxSize={4} />} onClick={() => setShown(shiftMonth(shown.year, shown.month, -1))} data-testid={`${testId}-prev`} />
                    <Text fontWeight={700} data-testid={`${testId}-month`}>
                      {monthTitle(shown.year, shown.month)}
                    </Text>
                    <IconButton aria-label={t('Next month')} variant="ghost" size="sm" icon={<ChevronRightIcon boxSize={4} />} onClick={() => setShown(shiftMonth(shown.year, shown.month, 1))} data-testid={`${testId}-next`} />
                  </Flex>
                  <Grid templateColumns="repeat(7, 1fr)" gap={0.5} textAlign="center">
                    {names.map((n, i) => (
                      <Text key={n} fontSize="xs" fontWeight={700} color={i > 4 ? 'faintText' : 'mutedText'} py={1}>
                        {n}
                      </Text>
                    ))}
                    {weeks.flat().map((iso) => {
                      const chosen = iso === value;
                      const isToday = iso === today;
                      return (
                        <Button
                          key={iso}
                          size="sm"
                          h="36px"
                          minW={0}
                          px={0}
                          variant={chosen ? 'solid' : 'ghost'}
                          fontWeight={isToday || chosen ? 800 : 500}
                          color={chosen ? undefined : inMonth(iso) ? (isToday ? 'brand.400' : 'bodyText') : 'faintText'}
                          border={isToday && !chosen ? '1px solid' : undefined}
                          borderColor="brand.400"
                          onClick={() => pick(iso)}
                          isDisabled={!allowed(iso)}
                          aria-label={dateLabel(iso)}
                          aria-pressed={chosen}
                          data-testid={`${testId}-day`}
                          data-date={iso}
                        >
                          {Number(iso.slice(8, 10))}
                        </Button>
                      );
                    })}
                  </Grid>
                  <HStack spacing={1.5} mt={3} wrap="wrap">
                    <Button size="sm" variant="subtle" onClick={() => pick(today)} isDisabled={!allowed(today)} data-testid={`${testId}-today`}>
                      {t('Today')}
                    </Button>
                    <Button size="sm" variant="subtle" onClick={() => pick(shiftIso(today, 1))} isDisabled={!allowed(shiftIso(today, 1))}>
                      {t('Tomorrow')}
                    </Button>
                    <Button size="sm" variant="subtle" onClick={() => pick(shiftIso(today, 7))} isDisabled={!allowed(shiftIso(today, 7))}>
                      {t('In a week')}
                    </Button>
                  </HStack>
                  {limitNote && (min || max) && (
                    <Text fontSize="sm" color="mutedText" mt={2} data-testid={`${testId}-limit`}>
                      {limitNote}
                    </Text>
                  )}
                  {value && (
                    <Box mt={2}>
                      <Button size="sm" variant="ghost" color="mutedText" leftIcon={<XIcon boxSize={3.5} />} onClick={() => pick(null)} data-testid={`${testId}-clear`}>
                        {t('Remove the date')}
                      </Button>
                    </Box>
                  )}
                </PopoverBody>
              </PopoverContent>
            </Portal>
          </>
        );
      }}
    </Popover>
  );
}
