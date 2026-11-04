/**
 * "Follow" (M15): a daily or weekly email to yourself with the biggest changes of a dashboard,
 * question or metric, in plain sentences. A digest is a subscription (options.digest), so it
 * shows on the Subscriptions page with its send history; "Unfollow" deletes it.
 */
import { useState } from 'react';
import {
  Box, Button, type ButtonProps, HStack, Input, Popover, PopoverArrow, PopoverBody, PopoverContent, PopoverTrigger, Radio, RadioGroup, Text,
  VStack, useDisclosure, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { lang, t } from '../i18n/index.ts';
import { CheckIcon, EyeIcon } from '../icons';
import { homeApi } from '../home/api';
import { useWorkspace } from '../workspace/useWorkspace';
import { subscriptions, useSubscriptionOptions, useSubscriptions } from './api';
import { type DigestEvery, digestLabel, followBody, followingOf, parseEmails } from './logic';
import type { FollowTargetType } from './types';

export interface FollowTarget {
  type: FollowTargetType;
  id: number;
  name: string;
}

export function FollowButton({ target, size = { base: 'md', md: 'sm' } }: { target: FollowTarget; size?: ButtonProps['size'] }) {
  const ws = useWorkspace();
  const me = ws.user.username;
  const toast = useToast();
  const popover = useDisclosure();
  const list = useSubscriptions({ target_type: target.type, target_id: target.id });
  const options = useSubscriptionOptions();
  const [every, setEvery] = useState<DigestEvery>('day');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const following = followingOf(list.data ?? [], me);
  const emailReady = options.data?.email_configured ?? false;
  const needsEmail = !options.data?.my_email;
  const typed = parseEmails(address);
  const addressOk = typed.valid.length === 1 && typed.invalid.length === 0;

  const follow = async () => {
    setBusy(true);
    try {
      if (needsEmail) await subscriptions.setMyEmail(address.trim());
      // the digest is written in the language you use Ncode in
      await homeApi.savePrefs({ language: lang() }).catch(() => undefined);
      await subscriptions.create(followBody(target.type, target.id, me, every));
      popover.onClose();
      toast({
        status: 'success', duration: 3000,
        title: every === 'day' ? t('You follow “{name}”: a digest comes every morning', { name: target.name })
          : t('You follow “{name}”: a digest comes every Monday', { name: target.name }),
      });
    } catch (e) {
      toast({ status: 'error', title: t('Could not follow'), description: apiErrorMessage(e, t('Please try again')) });
    } finally {
      setBusy(false);
    }
  };

  const unfollow = async () => {
    if (!following) return;
    setBusy(true);
    try {
      await subscriptions.remove(following.id);
      popover.onClose();
      toast({ status: 'success', duration: 2000, title: t('You do not follow “{name}” any more', { name: target.name }) });
    } catch (e) {
      toast({ status: 'error', title: t('Could not unfollow'), description: apiErrorMessage(e, t('Please try again')) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover isOpen={popover.isOpen} onOpen={popover.onOpen} onClose={popover.onClose} placement="bottom-end" isLazy>
      <PopoverTrigger>
        <Button
          size={size}
          variant={following ? 'subtle' : 'outline'}
          leftIcon={following ? <CheckIcon boxSize={4} /> : <EyeIcon boxSize={4} />}
          isDisabled={list.isPending}
          data-testid="follow-button"
          aria-label={following ? t('Following') : t('Follow')}
        >
          {following ? t('Following') : t('Follow')}
        </Button>
      </PopoverTrigger>
      <PopoverContent w={{ base: '92vw', sm: '340px' }} data-testid="follow-popover">
        <PopoverArrow />
        <PopoverBody p={4}>
          {following ? (
            <VStack align="stretch" spacing={3}>
              <Text fontSize="md">
                {t('You get a {digest} of “{name}” by email: the biggest changes in a few sentences.', {
                  digest: (digestLabel(following.options.digest) ?? '').toLowerCase(), name: target.name,
                })}
              </Text>
              <HStack justify="space-between">
                <Button as={RouterLink} to="/subscriptions" size="sm" variant="ghost">
                  {t('All subscriptions')}
                </Button>
                <Button size="md" colorScheme="red" variant="outline" onClick={() => void unfollow()} isLoading={busy} data-testid="unfollow">
                  {t('Unfollow')}
                </Button>
              </HStack>
            </VStack>
          ) : (
            <VStack align="stretch" spacing={3}>
              <Text fontSize="md" fontWeight={600}>
                {t('Get the biggest changes by email')}
              </Text>
              <Text fontSize="sm" color="mutedText">
                {t('A short email in plain sentences, for example: “Scrap on the paint line rose 18 % vs. the week before, mostly paint drips.”')}
              </Text>
              {!emailReady && options.isSuccess ? (
                <Text fontSize="sm" color="orange.400" data-testid="follow-no-email-server">
                  {t('Email is not set up yet. An admin sets it up under Admin → Delivery.')}
                </Text>
              ) : (
                <>
                  <RadioGroup value={every} onChange={(v) => setEvery(v as DigestEvery)}>
                    <VStack align="stretch" spacing={2}>
                      <Radio value="day" size="lg" data-testid="follow-daily">
                        <Text fontSize="md">{t('Every morning: yesterday vs. the day before')}</Text>
                      </Radio>
                      <Radio value="week" size="lg" data-testid="follow-weekly">
                        <Text fontSize="md">{t('Every Monday: last week vs. the week before')}</Text>
                      </Radio>
                    </VStack>
                  </RadioGroup>
                  {needsEmail && (
                    <Box border="1px solid" borderColor="orange.400" borderRadius="md" p={2}>
                      <Text fontSize="sm" mb={1}>
                        {t('You have no email address yet. Where should it go?')}
                      </Text>
                      <Input size="md" type="email" placeholder="you@company.com" value={address} onChange={(e) => setAddress(e.target.value)}
                        aria-label={t('Your email address')} data-testid="follow-email" />
                    </Box>
                  )}
                  <Button size="md" variant="brand" onClick={() => void follow()} isLoading={busy}
                    isDisabled={needsEmail && !addressOk} data-testid="follow-confirm">
                    {t('Follow')}
                  </Button>
                </>
              )}
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
