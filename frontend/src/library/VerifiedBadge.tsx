/** The Verified badge and the admins' "Mark as verified" action (M11), for questions and dashboards. */
import { Badge, MenuItem, Tooltip, useToast } from '@chakra-ui/react';
import { apiErrorMessage } from '../api';
import { BadgeCheckIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';
import { verifiedTooltip } from './verified.ts';
import { setVerified } from './verifyApi';
import type { VerifiableKind } from './verifyApi';
import type { Verified } from './verified.ts';

export function VerifiedBadge({ verified, size = 'sm' }: { verified?: Verified | null; size?: 'xs' | 'sm' }) {
  if (!verified) return null;
  return (
    <Tooltip label={verifiedTooltip(verified)} hasArrow>
      <Badge
        colorScheme="green"
        display="inline-flex"
        alignItems="center"
        gap={1}
        flexShrink={0}
        fontSize={size === 'xs' ? '2xs' : 'xs'}
        textTransform="none"
        tabIndex={0}
        data-testid="verified-badge"
      >
        <BadgeCheckIcon boxSize={size === 'xs' ? 3 : 3.5} />
        {t('Verified')}
      </Badge>
    </Tooltip>
  );
}

/** "Mark as verified" / "Remove verification" in an item's ⋯ menu; shown to admins only. */
export function VerifyMenuItem({ kind, id, verified }: { kind: VerifiableKind; id: number; verified?: Verified | null }) {
  const ws = useWorkspace();
  const toast = useToast();
  if (!ws.isAdmin) return null;
  const toggle = async () => {
    try {
      await setVerified(kind, id, !verified);
      toast({
        status: 'success',
        title: verified ? t('Verification removed') : t('Marked as verified'),
        description: verified ? undefined : t('It now shows the Verified badge and comes first in lists and search.'),
        duration: 3000,
      });
    } catch (e) {
      toast({ status: 'error', title: t('Could not change it'), description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };
  return (
    <MenuItem icon={<BadgeCheckIcon boxSize={4} />} onClick={() => void toggle()} data-testid={`${kind}-verify`}>
      {verified ? t('Remove verification') : t('Mark as verified')}
    </MenuItem>
  );
}
