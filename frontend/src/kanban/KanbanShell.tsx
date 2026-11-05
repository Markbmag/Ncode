import { Suspense, useEffect, useState } from 'react';
import {
  Box, Flex, HStack, IconButton, Input, InputGroup, InputLeftElement, InputRightElement, Menu, MenuButton, MenuDivider, MenuGroup, MenuItem, MenuList, Skeleton, Text, useBreakpointValue, useColorMode,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { Link as RouterLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AccountDialog } from '../account/AccountDialog';
import { ChevronDownIcon, LogOutIcon, MailIcon, MoonIcon, SearchIcon, SunIcon, XIcon } from '../icons';
import { LANGUAGES, lang, setLang, t } from '../i18n/index.ts';
import { ServiceMark, ServiceSwitcher } from '../launcher/ServiceSwitcher';
import { useWorkspace } from '../workspace/useWorkspace';
import { useBoards } from './api';
import { KanbanIcon, UserIcon } from './icons';
import { colorHex } from './logic';
import { PersonAvatar } from './parts';
import { KanbanOfflineBanner, OfflineSync } from './offline/OfflineSync';
import { setAppIdentity } from '../pwa/identity';

export function KanbanLogo() {
  return (
    <HStack as={RouterLink} to="/kanban" spacing={2.5} _hover={{ textDecoration: 'none' }} data-testid="kanban-logo" flexShrink={0}>
      <ServiceMark service="kanban" size={34} />
      <Text fontWeight={750} fontSize="md" letterSpacing="-0.02em" whiteSpace="nowrap" display={{ base: 'none', sm: 'block' }}>
        Ncode - Kanban
      </Text>
    </HStack>
  );
}

function BoardsMenu() {
  const boards = useBoards(false);
  const navigate = useNavigate();
  const { board } = useParams();
  const current = boards.data?.find((b) => String(b.id) === board);
  return (
    <Menu isLazy placement="bottom-start">
      <MenuButton
        as={Box}
        role="button"
        tabIndex={0}
        px={3}
        py={2}
        borderRadius="lg"
        cursor="pointer"
        _hover={{ bg: 'panelHover' }}
        fontSize="md"
        fontWeight={600}
        data-testid="boards-menu"
        minW={0}
      >
        <HStack spacing={2} minW={0}>
          {current ? <Box w="10px" h="10px" borderRadius="sm" bg={colorHex(current.color)} flexShrink={0} /> : <KanbanIcon boxSize={4} color="mutedText" />}
          <Text as="span" noOfLines={1} maxW={{ base: '110px', md: '240px' }}>
            {current ? current.name : t('Boards')}
          </Text>
          <ChevronDownIcon boxSize={4} color="mutedText" />
        </HStack>
      </MenuButton>
      <MenuList zIndex={1600} maxH="60vh" overflowY="auto" minW="240px">
        <MenuItem icon={<KanbanIcon boxSize={4} />} onClick={() => navigate('/kanban')} fontWeight={600}>
          {t('All boards')}
        </MenuItem>
        <MenuItem icon={<UserIcon boxSize={4} />} onClick={() => navigate('/kanban/my')} fontWeight={600} data-testid="menu-my-tasks">
          {t('My tasks')}
        </MenuItem>
        {(boards.data?.length ?? 0) > 0 && <MenuDivider />}
        <MenuGroup title={t('Boards')} fontSize="xs" color="faintText">
          {boards.data?.map((b) => (
            <MenuItem key={b.id} onClick={() => navigate(`/kanban/b/${b.id}`)} fontSize="md">
              <HStack spacing={2.5}>
                <Box w="10px" h="10px" borderRadius="sm" bg={colorHex(b.color)} />
                <Text as="span" noOfLines={1}>
                  {b.name}
                </Text>
              </HStack>
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuList>
    </Menu>
  );
}

/** On a phone a board shows its own name and a back arrow, so the top bar leaves the boards menu out. */
function PhoneAwareBoardsMenu() {
  const { board } = useParams();
  return (
    <Box display={{ base: board ? 'none' : 'block', md: 'block' }} minW={0}>
      <BoardsMenu />
    </Box>
  );
}

/** Search in the top bar: boards on the boards page, cards on a board (kept in the address as ?q=). */
function TopSearch() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const { board } = useParams();
  const set = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };
  const compact = useBreakpointValue({ base: true, md: false }) ?? false;
  const [open, setOpen] = useState(false);
  if (compact && !open && !q) {
    return (
      <Tooltip label={board ? t('Search tasks') : t('Search boards')} hasArrow>
        <IconButton aria-label={board ? t('Search tasks') : t('Search boards')} variant="ghost" icon={<SearchIcon boxSize={5} />} onClick={() => setOpen(true)} data-testid="kanban-search-open" />
      </Tooltip>
    );
  }
  return (
    <InputGroup
      size="md"
      maxW={{ base: 'none', md: '320px' }}
      flex={1}
      {...(compact ? { position: 'absolute', left: 3, right: 3, top: '12px', w: 'auto', zIndex: 2, bg: 'sidebarBg' } : {})}
    >
      <InputLeftElement pointerEvents="none" color="faintText">
        <SearchIcon boxSize={4} />
      </InputLeftElement>
      <Input
        value={q}
        autoFocus={compact}
        onBlur={() => !q && setOpen(false)}
        onChange={(e) => set(e.target.value)}
        placeholder={board ? t('Search tasks') : t('Search boards')}
        aria-label={board ? t('Search tasks') : t('Search boards')}
        borderRadius="lg"
        data-testid="kanban-search"
      />
      {q && (
        <InputRightElement>
          <IconButton aria-label={t('Clear')} title={t('Clear')} size="sm" variant="ghost" icon={<XIcon boxSize={3.5} />} onClick={() => { set(''); setOpen(false); }} />
        </InputRightElement>
      )}
    </InputGroup>
  );
}

function AccountMenu() {
  const ws = useWorkspace();
  const { colorMode, toggleColorMode } = useColorMode();
  const [email, setEmail] = useState<string | null>(ws.user.email ?? null);
  const [editing, setEditing] = useState(false);
  const current = lang();
  return (
    <>
      <Menu placement="bottom-end" isLazy>
        <Tooltip label={t('Your account, language, theme, sign out')} hasArrow>
          <MenuButton aria-label={t('Your account')} borderRadius="full" data-testid="account-menu">
            <PersonAvatar name={ws.user.username} size="sm" />
          </MenuButton>
        </Tooltip>
        <MenuList zIndex={1600} fontSize="md">
          <Box px={3} pb={2}>
            <Text fontWeight={600}>{ws.user.username}</Text>
            <Text fontSize="xs" color="mutedText">
              {ws.isAdmin ? t('Administrator') : t('User')}
            </Text>
          </Box>
          <MenuDivider />
          <MenuItem icon={<MailIcon boxSize={4} />} onClick={() => setEditing(true)}>
            {email ? t('Your account ({email})', { email }) : t('Your account')}
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
          <MenuItem icon={<LogOutIcon boxSize={4} />} onClick={ws.onLogout}>
            {t('Sign out')}
          </MenuItem>
        </MenuList>
      </Menu>
      {editing && <AccountDialog username={ws.user.username} email={email} onClose={() => setEditing(false)} onEmail={setEmail} />}
    </>
  );
}

/** Ncode - Kanban's own frame: a top bar (logo, boards, search, services, you) over the page. */
export default function KanbanShell() {
  const ws = useWorkspace();
  // "Add to Home Screen" here makes a Kanban icon that opens Kanban (K2)
  useEffect(() => {
    setAppIdentity('kanban');
    return () => setAppIdentity('bi');
  }, []);
  return (
    <Flex direction="column" h="100vh" sx={{ '@supports (height: 100dvh)': { height: '100dvh' } }} bg="boardBg" fontSize="md" data-testid="kanban-shell">
      <Flex
        as="header"
        align="center"
        gap={{ base: 1.5, md: 3 }}
        px={{ base: 3, md: 5 }}
        h="60px"
        flexShrink={0}
        bg="sidebarBg"
        borderBottom="1px solid"
        borderColor="lineColor"
        position="relative"
        zIndex={10}
      >
        <ServiceSwitcher />
        <KanbanLogo />
        <Box w="1px" h="22px" bg="lineColor" mx={1} display={{ base: 'none', md: 'block' }} />
        <PhoneAwareBoardsMenu />
        <Flex flex={1} justify="flex-end" minW={0}>
          <TopSearch />
        </Flex>
        <AccountMenu />
      </Flex>
      <KanbanOfflineBanner />
      <OfflineSync user={ws.user.username} />
      <Box flex={1} minH={0} position="relative">
        <Suspense fallback={<Skeleton m={6} h="200px" borderRadius="2xl" />}>
          <Outlet />
        </Suspense>
      </Box>
    </Flex>
  );
}
