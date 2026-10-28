import { useState } from 'react';
import {
  Avatar, Badge, Box, Button, Flex, HStack, IconButton, Text, Tooltip, VStack, useColorMode,
} from '@chakra-ui/react';
import { NavLink } from 'react-router-dom';
import type { Connection, User } from '../api';
import { LockIcon, LogOutIcon, MailIcon, MoonIcon, PencilIcon, PlusIcon, SunIcon } from '../icons';
import { AccountDialog } from '../account/AccountDialog';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { navTestId, visibleGroups } from '../shell/nav';
import type { NavItem } from '../shell/nav';
import { EngineBadge } from './EngineBadge';
import { engineMeta } from '../lib/engines';
import { isDemo } from '../lib/names';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';

interface SidebarProps {
  connections: Connection[];
  activeKey: string;
  onSelect: (key: string) => void;
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (key: string) => void;
  user: User;
  onLogout: () => void;
}

export function Logo() {
  return (
    <HStack spacing={3}>
      <Flex
        w="36px"
        h="36px"
        align="center"
        justify="center"
        borderRadius="xl"
        bgGradient="linear(to-br, brand.400, brand.600)"
        color="white"
        fontWeight={800}
        fontSize="lg"
        boxShadow="0 6px 16px -4px rgba(79,70,229,0.6)"
      >
        N
      </Flex>
      <Box lineHeight="1.15">
        <Text fontWeight={700} fontSize="lg" letterSpacing="-0.02em">
          Ncode
        </Text>
        <Text fontSize="xs" color="mutedText">
          {t('Data workspace')}
        </Text>
      </Box>
    </HStack>
  );
}

export function ColorModeButton() {
  const { colorMode, toggleColorMode } = useColorMode();
  return (
    <Tooltip label={colorMode === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')} hasArrow>
      <IconButton
        aria-label={t('Toggle color theme')}
        size="sm"
        icon={colorMode === 'dark' ? <SunIcon boxSize={4} /> : <MoonIcon boxSize={4} />}
        onClick={toggleColorMode}
      />
    </Tooltip>
  );
}

/** The app's sections, grouped (shell/nav.ts). `compact` is the horizontal strip used on small screens. */
export function NavLinks({ isAdmin, compact = false }: { isAdmin: boolean; compact?: boolean }) {
  return (
    <Flex
      as="nav"
      aria-label={t('Sections')}
      direction={compact ? 'row' : 'column'}
      align={compact ? 'center' : 'stretch'}
      gap={compact ? 1 : 0}
      overflowX={compact ? 'auto' : undefined}
    >
      {visibleGroups(isAdmin).map((group, index) => (
        <Flex
          key={group.id}
          role="group"
          aria-label={group.label ?? undefined}
          direction={compact ? 'row' : 'column'}
          align={compact ? 'center' : 'stretch'}
          gap={compact ? 1 : 0.5}
          flexShrink={0}
          data-testid={`nav-group-${group.id}`}
        >
          {compact
            ? index > 0 && <Box w="1px" h="18px" bg="lineColor" mx={1} flexShrink={0} aria-hidden />
            : group.label
              ? (
                <Text px={3} pt={3} pb={1} fontSize="2xs" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase" color="faintText">
                  {group.label}
                </Text>
              )
              : index > 0 && <Box h={3} aria-hidden />}
          {group.items.map((item) => (
            <NavEntry key={item.to} item={item} compact={compact} />
          ))}
        </Flex>
      ))}
    </Flex>
  );
}

function NavEntry({ item, compact }: { item: NavItem; compact: boolean }) {
  const sub = item.sub && !compact;
  return (
    <Tooltip label={item.hint} placement="right" openDelay={700} hasArrow isDisabled={compact}>
      <Box
        as={NavLink}
        to={item.to}
        end={item.end}
        display="flex"
        alignItems="center"
        gap={sub ? 2.5 : 3}
        pl={sub ? 9 : 3}
        pr={3}
        py={sub ? 1 : 1.5}
        flexShrink={0}
        borderRadius="lg"
        fontSize={sub ? 'xs' : 'sm'}
        fontWeight={600}
        color="mutedText"
        _hover={{ bg: 'panelHover', color: 'bodyText' }}
        sx={{ '&.active': { bg: 'rgba(99,102,241,0.14)', color: 'bodyText' } }}
        data-testid={navTestId(item.to)}
      >
        <item.icon boxSize={sub ? 3.5 : 4} />
        <Text as="span" flex={1} whiteSpace="nowrap">
          {item.label}
        </Text>
        {item.milestone && !compact && (
          <Tooltip label={t('Coming in milestone {milestone} of the roadmap', { milestone: item.milestone })} hasArrow>
            <Badge fontSize="0.6rem" bg="chipBg" color="faintText" borderRadius="full" px={1.5}>
              {t('soon')}
            </Badge>
          </Tooltip>
        )}
      </Box>
    </Tooltip>
  );
}

export function Sidebar({ connections, activeKey, onSelect, isAdmin, onAdd, onEdit, user, onLogout }: SidebarProps) {
  const { connectionsError, reloadConnections } = useWorkspace();
  const [email, setEmail] = useState<string | null>(user.email ?? null);
  const [editingEmail, setEditingEmail] = useState(false);
  return (
    <Flex
      as="aside"
      direction="column"
      w="290px"
      flexShrink={0}
      h="100vh"
      position="sticky"
      top={0}
      bg="sidebarBg"
      borderRight="1px solid"
      borderColor="lineColor"
      display={{ base: 'none', md: 'flex' }}
    >
      <Box px={5} pt={5} pb={4}>
        <Logo />
      </Box>

      <Box px={3} pb={4}>
        <NavLinks isAdmin={isAdmin} />
      </Box>

      <Flex px={5} pb={2} align="center" justify="space-between">
        <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
          {t('DATABASES')}
        </Text>
        <Badge bg="chipBg" color="mutedText" borderRadius="full" px={2}>
          {connections.length}
        </Badge>
      </Flex>

      <VStack flex={1} align="stretch" spacing={1} px={3} overflowY="auto">
        {connections.map((connection) => {
          const active = connection.key === activeKey;
          return (
            <Flex
              key={connection.key}
              role="group"
              align="center"
              gap={3}
              px={3}
              py={2.5}
              borderRadius="xl"
              cursor="pointer"
              border="1px solid"
              borderColor={active ? 'rgba(99,102,241,0.45)' : 'transparent'}
              bg={active ? 'rgba(99,102,241,0.14)' : 'transparent'}
              _hover={{ bg: active ? 'rgba(99,102,241,0.14)' : 'panelHover' }}
              onClick={() => onSelect(connection.key)}
            >
              <EngineBadge engine={connection.engine} size={34} />
              <Box flex={1} minW={0}>
                <Text fontWeight={600} fontSize="sm" noOfLines={1}>
                  {connection.label}
                </Text>
                <Text fontSize="xs" color="mutedText" noOfLines={1}>
                  {/* non-admins get no file paths: the engine name stands in; the demo says what it is (M11) */}
                  {isDemo(connection)
                    ? t('Sample data to try things out')
                    : connection.database || engineMeta(connection.engine).label}
                </Text>
              </Box>
              {connection.source === 'env' && (
                <Tooltip label={t('Defined in the .env file — edit it there')} hasArrow>
                  <Box color="faintText">
                    <LockIcon boxSize={3.5} />
                  </Box>
                </Tooltip>
              )}
              {connection.editable && (
                <Tooltip label={t('Edit connection')} hasArrow>
                  <IconButton
                    aria-label={t('Edit {name}', { name: connection.label })}
                    size="xs"
                    variant="ghost"
                    icon={<PencilIcon boxSize={3.5} />}
                    opacity={0}
                    _groupHover={{ opacity: 1 }}
                    _focus={{ opacity: 1 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(connection.key);
                    }}
                  />
                </Tooltip>
              )}
            </Flex>
          );
        })}

        {connections.length === 0 && !connectionsError && (
          <Text fontSize="sm" color="mutedText" px={3} py={4}>
            {t('No databases yet.')}
          </Text>
        )}
        {connectionsError !== null && connections.length === 0 && (
          <Box px={3} py={3} fontSize="sm">
            <Text color="red.300">{t('Could not load your databases')}</Text>
            <Button size="xs" variant="subtle" mt={2} onClick={reloadConnections} data-testid="sidebar-retry">
              {t('Try again')}
            </Button>
          </Box>
        )}
      </VStack>

      {isAdmin && (
        <Box px={4} pt={3}>
          <Button w="100%" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={onAdd}>
            {t('Add a database')}
          </Button>
        </Box>
      )}

      <Flex align="center" columnGap={1} rowGap={2} wrap="wrap" p={4} mt={2} borderTop="1px solid" borderColor="lineColor">
        <Flex align="center" gap={3} flex="1 0 100%" minW={0}>
          <Avatar size="sm" name={user.username} bg="brand.500" color="white" />
          <Box flex={1} minW={0}>
            <Text fontSize="sm" fontWeight={600} noOfLines={1}>
              {user.username}
            </Text>
            <Text fontSize="xs" color="mutedText" noOfLines={1}>
              {user.role === 'admin' ? t('Administrator') : t('User')}
            </Text>
          </Box>
        </Flex>
        <Box flex={1} />
        <Tooltip label={email ? t('Your account ({email})', { email }) : t('Your account: add your email address for subscriptions')} hasArrow>
          <IconButton aria-label={t('Your account')} size="sm" variant="ghost" color={email ? undefined : 'orange.400'} icon={<MailIcon boxSize={4} />} onClick={() => setEditingEmail(true)} data-testid="account-email-button" />
        </Tooltip>
        <LanguageSwitch />
        <ColorModeButton />
        <Tooltip label={t('Sign out')} hasArrow>
          <IconButton aria-label={t('Sign out')} size="sm" icon={<LogOutIcon boxSize={4} />} onClick={onLogout} />
        </Tooltip>
      </Flex>
      {editingEmail && <AccountDialog username={user.username} email={email} onClose={() => setEditingEmail(false)} onEmail={setEmail} />}
    </Flex>
  );
}
