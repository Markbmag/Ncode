import { useState } from 'react';
import {
  Alert, AlertIcon as ChakraAlertIcon, Badge, Box, Button, Flex, HStack, IconButton, Input, Link, Skeleton, Switch, Text, Tooltip, VStack,
  useToast,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { CopyIcon, GlobeIcon, KeyIcon, LayoutIcon, ChartIcon, TrashIcon } from '../icons';
import { absolute, sharing, useAllLinks } from '../sharing/api';
import { admin, useAdminSettings } from './api';
import { Panel } from './Panel';

/** Admin → Sharing: switch public links and embedding on or off, the embedding key, everything shared. */
export function SharingSettings() {
  const toast = useToast();
  const settings = useAdminSettings();
  const links = useAllLinks();
  const [key, setKey] = useState<string | null>(null);
  const [chosen, setFlags] = useState<{ public_links: boolean; embedding: boolean } | null>(null);
  if (settings.isPending) return <Skeleton h="300px" borderRadius="2xl" />;
  if (!settings.data) return <Text color="red.400">{apiErrorMessage(settings.error, 'Could not load the settings')}</Text>;
  const s = settings.data.sharing;
  const flags = chosen ?? { public_links: s.public_links, embedding: s.embedding };
  const site = settings.data.general.site_url;
  const fail = (what: string) => (e: unknown) => toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again') });
  const toggle = (patch: Partial<{ public_links: boolean; embedding: boolean }>) => {
    // both switches are saved together: build on what was last chosen, not on the last server answer
    const next = { ...flags, ...patch };
    setFlags(next);
    admin.saveSharing(next).catch(fail('Could not save'));
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ status: 'success', title: 'Copied', duration: 1200 });
    } catch {
      toast({ status: 'warning', title: 'Copy it by hand', description: text, duration: 8000, isClosable: true });
    }
  };
  return (
    <VStack align="stretch" spacing={6}>
      <Panel title="Public links" subtitle="Admins can make a link to a dashboard or question that anyone can open without signing in: read-only, results only, optionally with a password and an expiry.">
        <HStack>
          <Switch isChecked={flags.public_links} onChange={(e) => toggle({ public_links: e.target.checked })} data-testid="public-links-switch" />
          <Text fontSize="sm">{flags.public_links ? 'On: links work' : 'Off: every public link stops working'}</Text>
        </HStack>
        {!site && (
          <Alert status="info" borderRadius="md" fontSize="sm" mt={3}>
            <ChakraAlertIcon />
            <Box>
              Set the site address under{' '}
              <Link as={RouterLink} to="/admin?tab=delivery" textDecoration="underline">
                Delivery
              </Link>{' '}
              so the links use the address others can reach (not localhost).
            </Box>
          </Alert>
        )}
      </Panel>

      <Panel title="Embedding" subtitle="Show a dashboard or question inside another website (an intranet, a portal). The website signs a short-lived token with the embedding key; filters can be locked to what that website decides.">
        <VStack align="stretch" spacing={3}>
          <HStack>
            <Switch isChecked={flags.embedding} onChange={(e) => toggle({ embedding: e.target.checked })} data-testid="embedding-switch" />
            <Text fontSize="sm">{flags.embedding ? 'On' : 'Off: every embed stops working'}</Text>
          </HStack>
          <HStack>
            <KeyIcon boxSize={4} />
            <Input size="sm" maxW="520px" fontFamily="mono" fontSize="xs" isReadOnly value={key ?? (s.embedding_key_set ? '•'.repeat(40) : 'no key yet')} data-testid="embedding-key" />
            {s.embedding_key_set && key === null && (
              <Button size="sm" variant="subtle" onClick={() => void admin.embeddingKey().then(setKey).catch(fail('Could not read the key'))}>
                Show
              </Button>
            )}
            {key && <IconButton aria-label="Copy the key" size="sm" icon={<CopyIcon boxSize={4} />} onClick={() => void copy(key)} />}
            <Button
              size="sm"
              variant={s.embedding_key_set ? 'ghost' : 'brand'}
              onClick={() => {
                if (s.embedding_key_set && !window.confirm('A new key stops every embed until the websites use the new key. Continue?')) return;
                void admin.newEmbeddingKey().then(setKey).catch(fail('Could not create a key'));
              }}
              data-testid="new-embedding-key"
            >
              {s.embedding_key_set ? 'New key' : 'Create the key'}
            </Button>
          </HStack>
          <Text fontSize="xs" color="mutedText">
            Keep the key on the website's server, never in a web page. To allow embedding a dashboard or question, open it → ⋯ → Public link / embed.
          </Text>
        </VStack>
      </Panel>

      <Panel title="Shared outside Ncode" subtitle="Every public link and embed. Stopping one takes effect at once.">
        {links.isPending && <Skeleton h="60px" />}
        {links.data?.length === 0 && (
          <Text fontSize="sm" color="mutedText">
            Nothing is shared.
          </Text>
        )}
        <VStack align="stretch" spacing={2}>
          {links.data?.map((l) => (
            <Flex key={l.id} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg" wrap="wrap" data-testid="shared-item">
              {l.target_type === 'dashboard' ? <LayoutIcon boxSize={4} /> : <ChartIcon boxSize={4} />}
              <Box flex={1} minW="200px">
                <HStack spacing={2}>
                  <Link as={RouterLink} to={`/${l.target_type === 'dashboard' ? 'dashboards' : 'questions'}/${l.target_id}`} fontSize="sm" fontWeight={600}>
                    {l.target_name ?? `${l.target_type} ${l.target_id}`}
                  </Link>
                  <Badge colorScheme={l.kind === 'public' ? 'green' : 'purple'}>{l.kind === 'public' ? 'public link' : 'embed'}</Badge>
                  {!l.active && <Badge colorScheme="red">expired</Badge>}
                  {l.has_password && <Badge>password</Badge>}
                </HStack>
                <Text fontSize="xs" color="mutedText">
                  by {l.created_by} · {l.views} view{l.views === 1 ? '' : 's'}
                  {l.expires_at ? ` · expires ${new Date(l.expires_at * 1000).toLocaleDateString()}` : ''}
                  {l.last_used_at ? ` · last used ${new Date(l.last_used_at * 1000).toLocaleString()}` : ''}
                </Text>
              </Box>
              {l.kind === 'public' && l.path && (
                <Tooltip label="Copy the link" hasArrow>
                  <IconButton aria-label="Copy the link" size="sm" icon={<GlobeIcon boxSize={4} />} onClick={() => void copy(absolute(l.path!, site))} />
                </Tooltip>
              )}
              {l.kind === 'public' ? (
                <Tooltip label="Stop this link" hasArrow>
                  <IconButton aria-label="Revoke" size="sm" variant="ghost" colorScheme="red" icon={<TrashIcon boxSize={4} />} onClick={() => void sharing.revoke(l.id).catch(fail('Could not revoke'))} />
                </Tooltip>
              ) : (
                <Tooltip label="Stop embedding" hasArrow>
                  <IconButton
                    aria-label="Stop embedding"
                    size="sm"
                    variant="ghost"
                    colorScheme="red"
                    icon={<TrashIcon boxSize={4} />}
                    onClick={() => void sharing.setEmbed({ target_type: l.target_type, target_id: l.target_id, enabled: false, params: l.params ?? {} }).catch(fail('Could not change it'))}
                  />
                </Tooltip>
              )}
            </Flex>
          ))}
        </VStack>
      </Panel>
    </VStack>
  );
}
