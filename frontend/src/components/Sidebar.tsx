import { useEffect, useState } from 'react';
import {
  Avatar, Badge, Box, Button, Flex, HStack, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Text, Tooltip,
  useColorMode, useMediaQuery,
} from '@chakra-ui/react';
import { NavLink } from 'react-router-dom';
import type { Connection, User } from '../api';
import { CheckIcon, ChevronDownIcon, LockIcon, LogOutIcon, MailIcon, MoonIcon, PanelLeftIcon, PencilIcon, PlusIcon, SunIcon } from '../icons';
import { AccountDialog } from '../account/AccountDialog';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { navTestId, visibleGroups } from '../shell/nav';
import type { NavItem } from '../shell/nav';
import { EngineBadge } from './EngineBadge';
import { engineMeta } from '../lib/engines';
import { isDemo } from '../lib/names';
import { useWorkspace } from '../workspace/useWorkspace';
import { loadJson, saveJson } from '../lib/storage';
import { LANGUAGES, lang, setLang, t } from '../i18n/index.ts';

// On short windows the menu gets tighter, so more of it (and the databases) fits without scrolling.
const SHORT = '@media (max-height: 760px)';

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

export function Logo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <HStack spacing={3} title={markOnly ? 'Ncode' : undefined}>
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
      {!markOnly && (
        <Box lineHeight="1.15">
          <Text fontWeight={700} fontSize="lg" letterSpacing="-0.02em">
            Ncode
          </Text>
          <Text fontSize="xs" color="mutedText">
            {t('Data workspace')}
          </Text>
        </Box>
      )}
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

/**
 * The app's sections, grouped (shell/nav.ts). `compact` is the horizontal strip used on small
 * screens; `collapsed` is the narrow sidebar (icons with their names as tooltips).
 */
export function NavLinks({ isAdmin, compact = false, collapsed = false }: { isAdmin: boolean; compact?: boolean; collapsed?: boolean }) {
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
            : collapsed
              ? index > 0 && <Box h="1px" bg="lineColor" mx={2} my={2} aria-hidden />
              : group.label
                ? (
                  <Text px={3} pt={3} pb={1} fontSize="2xs" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase" color="faintText" sx={{ [SHORT]: { pt: 2, pb: 0.5 } }}>
                    {group.label}
                  </Text>
                )
                : index > 0 && <Box h={3} aria-hidden />}
          {group.items.map((item) => (
            <NavEntry key={item.to} item={item} compact={compact} collapsed={collapsed} />
          ))}
        </Flex>
      ))}
    </Flex>
  );
}

function NavEntry({ item, compact, collapsed }: { item: NavItem; compact: boolean; collapsed: boolean }) {
  const sub = item.sub && !compact && !collapsed;
  return (
    <Tooltip
      label={collapsed ? item.label : item.hint}
      placement="right"
      openDelay={collapsed ? 150 : 700}
      hasArrow
      isDisabled={compact}
    >
      <Box
        as={NavLink}
        to={item.to}
        end={item.end}
        display="flex"
        alignItems="center"
        gap={sub ? 2.5 : 3}
        justifyContent={collapsed ? 'center' : undefined}
        pl={collapsed ? 0 : sub ? 9 : 3}
        pr={collapsed ? 0 : 3}
        py={sub ? 1 : collapsed ? 2 : 1.5}
        flexShrink={0}
        borderRadius="lg"
        fontSize={sub ? 'xs' : 'sm'}
        fontWeight={600}
        color="mutedText"
        _hover={{ bg: 'panelHover', color: 'bodyText' }}
        sx={{ '&.active': { bg: 'rgba(99,102,241,0.14)', color: 'bodyText' }, [SHORT]: { py: sub ? 0.5 : collapsed ? 1.5 : 1 } }}
        aria-label={collapsed ? item.label : undefined}
        data-testid={navTestId(item.to)}
      >
        <item.icon boxSize={sub ? 3.5 : collapsed && item.sub ? 3.5 : 4} />
        {!collapsed && (
          <Text as="span" flex={1} whiteSpace="nowrap">
            {item.label}
          </Text>
        )}
        {item.milestone && !compact && !collapsed && (
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

const SIDEBAR_KEY = 'ncode_sidebar'; // "open" | "collapsed"; nothing stored = narrow windows collapse

/** Which database the pages work on: always visible under the logo, whatever the window height. */
export function DatabaseSwitcher({ connections, activeKey, onSelect, isAdmin, onAdd, onEdit, collapsed }: Omit<SidebarProps, 'user' | 'onLogout'> & { collapsed: boolean }) {
  const { connectionsError, reloadConnections } = useWorkspace();
  const active = connections.find((c) => c.key === activeKey);
  const subtitle = (c: Connection) => (isDemo(c) ? t('Sample data to try things out') : c.database || engineMeta(c.engine).label);
  if (connectionsError !== null && connections.length === 0) {
    return collapsed ? null : (
      <Box px={2} py={1} fontSize="sm">
        <Text color="red.300">{t('Could not load your databases')}</Text>
        <Button size="xs" variant="subtle" mt={2} onClick={reloadConnections} data-testid="sidebar-retry">
          {t('Try again')}
        </Button>
      </Box>
    );
  }
  if (connections.length === 0) {
    if (!isAdmin) return collapsed ? null : <Text fontSize="sm" color="mutedText" px={2}>{t('No databases yet.')}</Text>;
    return collapsed ? (
      <Tooltip label={t('Add a database')} placement="right" hasArrow>
        <IconButton aria-label={t('Add a database')} icon={<PlusIcon boxSize={4} />} variant="subtle" w="100%" onClick={onAdd} />
      </Tooltip>
    ) : (
      <Button w="100%" size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={onAdd}>
        {t('Add a database')}
      </Button>
    );
  }
  return (
    <Menu placement={collapsed ? 'right-start' : 'bottom-start'} isLazy>
      <Tooltip label={collapsed ? t('Database: {name}', { name: active?.label ?? '' }) : t('Change the database the pages work on')} placement="right" hasArrow openDelay={collapsed ? 150 : 600}>
        <MenuButton
          as={Box}
          role="button"
          tabIndex={0}
          w="100%"
          px={collapsed ? 0 : 2.5}
          py={2}
          borderRadius="xl"
          border="1px solid"
          borderColor="rgba(99,102,241,0.45)"
          bg="rgba(99,102,241,0.10)"
          cursor="pointer"
          _hover={{ bg: 'rgba(99,102,241,0.16)' }}
          aria-label={t('Database: {name}', { name: active?.label ?? '' })}
          data-testid="database-switcher"
        >
          <Flex align="center" gap={2.5} justify={collapsed ? 'center' : undefined}>
            {active && <EngineBadge engine={active.engine} size={collapsed ? 30 : 32} />}
            {!collapsed && (
              <>
                <Box flex={1} minW={0} textAlign="left">
                  <Text fontSize="2xs" fontWeight={700} letterSpacing="0.08em" color="faintText" textTransform="uppercase" lineHeight="1.4">
                    {t('Database')}
                  </Text>
                  <Text fontWeight={600} fontSize="sm" noOfLines={1}>
                    {active?.label ?? t('Pick a database')}
                  </Text>
                </Box>
                <Badge bg="chipBg" color="mutedText" borderRadius="full" px={2} title={t('Databases you can use')}>
                  {connections.length}
                </Badge>
                <ChevronDownIcon boxSize={4} color="mutedText" />
              </>
            )}
          </Flex>
        </MenuButton>
      </Tooltip>
      <MenuList maxH="70vh" overflowY="auto" minW="280px" zIndex={1500}>
        {connections.map((c) => (
          <MenuItem key={c.key} onClick={() => onSelect(c.key)} data-testid={`database-${c.key}`}>
            <Flex align="center" gap={3} w="100%">
              <EngineBadge engine={c.engine} size={28} />
              <Box flex={1} minW={0}>
                <Text fontWeight={600} fontSize="sm" noOfLines={1}>
                  {c.label}
                </Text>
                <Text fontSize="xs" color="mutedText" noOfLines={1}>
                  {subtitle(c)}
                </Text>
              </Box>
              {c.key === activeKey && <CheckIcon boxSize={4} color="brand.300" />}
              {c.source === 'env' && (
                <Tooltip label={t('Defined in the .env file — edit it there')} hasArrow>
                  <Box color="faintText">
                    <LockIcon boxSize={3.5} />
                  </Box>
                </Tooltip>
              )}
              {c.editable && (
                <IconButton
                  as="span"
                  aria-label={t('Edit {name}', { name: c.label })}
                  size="xs"
                  variant="ghost"
                  icon={<PencilIcon boxSize={3.5} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit(c.key);
                  }}
                />
              )}
            </Flex>
          </MenuItem>
        ))}
        {isAdmin && (
          <>
            <MenuDivider />
            <MenuItem icon={<PlusIcon boxSize={4} />} onClick={onAdd} data-testid="database-add">
              {t('Add a database')}
            </MenuItem>
          </>
        )}
      </MenuList>
    </Menu>
  );
}

/** The narrow sidebar's "you" corner: one avatar that opens account, language, theme and sign-out. */
function CollapsedAccountMenu({ user, email, onAccount, onLogout }: { user: User; email: string | null; onAccount: () => void; onLogout: () => void }) {
  const { colorMode, toggleColorMode } = useColorMode();
  const current = lang();
  return (
    <Menu placement="right-end" isLazy>
      <Tooltip label={`${user.username} · ${user.role === 'admin' ? t('Administrator') : t('User')}`} placement="right" hasArrow>
        <MenuButton aria-label={t('Your account')} borderRadius="full" data-testid="account-menu">
          <Avatar size="sm" name={user.username} bg="brand.500" color="white" />
        </MenuButton>
      </Tooltip>
      <MenuList zIndex={1500} fontSize="sm">
        <Box px={3} pb={2}>
          <Text fontWeight={600}>{user.username}</Text>
          <Text fontSize="xs" color="mutedText">
            {user.role === 'admin' ? t('Administrator') : t('User')}
          </Text>
        </Box>
        <MenuDivider />
        <MenuItem icon={<MailIcon boxSize={4} />} onClick={onAccount} color={email ? undefined : 'orange.400'} data-testid="account-email-button">
          {email ? t('Your account ({email})', { email }) : t('Your account: add your email address for subscriptions')}
        </MenuItem>
        <MenuItem icon={colorMode === 'dark' ? <SunIcon boxSize={4} /> : <MoonIcon boxSize={4} />} onClick={toggleColorMode}>
          {colorMode === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
        </MenuItem>
        {LANGUAGES.filter((l) => l.code !== current).map((l) => (
          <MenuItem key={l.code} icon={<Text as="span" fontSize="xs" fontWeight={700}>{l.short}</Text>} onClick={() => setLang(l.code)} data-testid={`language-${l.code}`}>
            {l.label}
          </MenuItem>
        ))}
        <MenuDivider />
        <MenuItem icon={<LogOutIcon boxSize={4} />} onClick={onLogout}>
          {t('Sign out')}
        </MenuItem>
      </MenuList>
    </Menu>
  );
}

export function Sidebar({ connections, activeKey, onSelect, isAdmin, onAdd, onEdit, user, onLogout }: SidebarProps) {
  const [email, setEmail] = useState<string | null>(user.email ?? null);
  const [editingEmail, setEditingEmail] = useState(false);
  // collapsed to icons: the person's choice, else automatically on narrow windows
  const [narrow] = useMediaQuery('(max-width: 1199px)');
  const [choice, setChoice] = useState<'open' | 'collapsed' | null>(() => loadJson<'open' | 'collapsed' | null>(SIDEBAR_KEY, null));
  const collapsed = choice ? choice === 'collapsed' : narrow;
  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'open';
  }, [collapsed]);
  const toggle = () => {
    const next = collapsed ? 'open' : 'collapsed';
    setChoice(next);
    saveJson(SIDEBAR_KEY, next);
  };
  const toggleButton = (
    <Tooltip label={collapsed ? t('Show the menu with names') : t('Make the menu narrow')} placement="right" hasArrow>
      <IconButton
        aria-label={collapsed ? t('Show the menu with names') : t('Make the menu narrow')}
        size="sm"
        variant="ghost"
        icon={<PanelLeftIcon boxSize={4} />}
        onClick={toggle}
        data-testid="sidebar-toggle"
      />
    </Tooltip>
  );
  return (
    <Flex
      as="aside"
      direction="column"
      w={collapsed ? '68px' : '272px'}
      flexShrink={0}
      position="sticky"
      top={0}
      bg="sidebarBg"
      borderRight="1px solid"
      borderColor="lineColor"
      display={{ base: 'none', md: 'flex' }}
      sx={{ height: '100vh', '@supports (height: 100dvh)': { height: '100dvh' } }}
      data-testid="sidebar"
    >
      {/* top: logo, menu width, the database (always visible) */}
      <Flex px={collapsed ? 2 : 4} pt={4} pb={3} align="center" justify={collapsed ? 'center' : 'space-between'} direction={collapsed ? 'column' : 'row'} gap={2} flexShrink={0}>
        <Logo markOnly={collapsed} />
        {toggleButton}
      </Flex>
      <Box px={collapsed ? 2 : 3} pb={3} flexShrink={0}>
        <DatabaseSwitcher connections={connections} activeKey={activeKey} onSelect={onSelect} isAdmin={isAdmin} onAdd={onAdd} onEdit={onEdit} collapsed={collapsed} />
      </Box>

      {/* middle: the sections, scrolling on short windows */}
      <Box flex={1} minH={0} overflowY="auto" px={collapsed ? 2 : 3} pb={3} borderTop="1px solid" borderColor="lineColor" pt={1}>
        <NavLinks isAdmin={isAdmin} collapsed={collapsed} />
      </Box>

      {/* bottom: you */}
      {collapsed ? (
        <Flex justify="center" py={3} borderTop="1px solid" borderColor="lineColor" flexShrink={0}>
          <CollapsedAccountMenu user={user} email={email} onAccount={() => setEditingEmail(true)} onLogout={onLogout} />
        </Flex>
      ) : (
        <Flex align="center" gap={1} px={3} py={3} borderTop="1px solid" borderColor="lineColor" flexShrink={0}>
          <Avatar size="sm" name={user.username} bg="brand.500" color="white" mr={1.5} />
          <Box flex={1} minW={0}>
            <Text fontSize="sm" fontWeight={600} noOfLines={1}>
              {user.username}
            </Text>
            <Text fontSize="xs" color="mutedText" noOfLines={1}>
              {user.role === 'admin' ? t('Administrator') : t('User')}
            </Text>
          </Box>
          <Tooltip label={email ? t('Your account ({email})', { email }) : t('Your account: add your email address for subscriptions')} hasArrow>
            <IconButton aria-label={t('Your account')} size="sm" variant="ghost" color={email ? undefined : 'orange.400'} icon={<MailIcon boxSize={4} />} onClick={() => setEditingEmail(true)} data-testid="account-email-button" />
          </Tooltip>
          <LanguageSwitch />
          <ColorModeButton />
          <Tooltip label={t('Sign out')} hasArrow>
            <IconButton aria-label={t('Sign out')} size="sm" icon={<LogOutIcon boxSize={4} />} onClick={onLogout} />
          </Tooltip>
        </Flex>
      )}
      {editingEmail && <AccountDialog username={user.username} email={email} onClose={() => setEditingEmail(false)} onEmail={setEmail} />}
    </Flex>
  );
}
