/**
 * "See glossary: Scrap rate" next to a metric or a column that a glossary term explains (M11).
 *
 *   <GlossaryLinks target={{ metric: 3 }} />
 *   <GlossaryLinks target={{ connection: 'mes', table: 'scrap', column: 'rate' }} plain />   (inside a button)
 */
import { Fragment } from 'react';
import { Link, Text } from '@chakra-ui/react';
import type { TextProps } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { t } from '../i18n/index.ts';
import { useGlossaryFor } from './api';
import { termName } from './logic.ts';
import type { GlossaryTarget } from './logic.ts';

export function GlossaryLinks({ target, plain = false, ...props }: { target: GlossaryTarget; plain?: boolean } & TextProps) {
  const found = useGlossaryFor(target);
  if (found.length === 0) return null;
  return (
    <Text fontSize="xs" color="mutedText" noOfLines={plain ? 1 : undefined} data-testid="glossary-links" {...props}>
      {t('See glossary:')}{' '}
      {found.map((term, i) => (
        <Fragment key={term.id}>
          {i > 0 && ', '}
          {plain ? (
            <Text as="span" fontWeight={600}>
              {termName(term)}
            </Text>
          ) : (
            <Link as={RouterLink} to={`/glossary?term=${term.id}`} color="brand.400" fontWeight={600}>
              {termName(term)}
            </Link>
          )}
        </Fragment>
      ))}
    </Text>
  );
}
