import { Suspense } from 'react';
import { Box, Flex, HStack, IconButton, Skeleton, VStack } from '@chakra-ui/react';
import { Outlet } from 'react-router-dom';
import { ColorModeButton, Logo, NavLinks, Sidebar } from '../components/Sidebar';
import { LogOutIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';

function PageFallback() {
  return (
    <VStack align="stretch" spacing={4}>
      <Skeleton h="120px" borderRadius="2xl" />
      <Skeleton h="280px" borderRadius="2xl" />
    </VStack>
  );
}

/** Sidebar (sections + databases) around the current page. */
export default function AppShell() {
  const ws = useWorkspace();
  return (
    <Flex minH="100vh" align="flex-start">
      <Sidebar
        connections={ws.connections}
        activeKey={ws.activeKey}
        onSelect={ws.selectConnection}
        isAdmin={ws.isAdmin}
        onAdd={ws.openAddConnection}
        onEdit={ws.openEditConnection}
        user={ws.user}
        onLogout={ws.onLogout}
      />

      <Box flex={1} minW={0}>
        <Box display={{ base: 'block', md: 'none' }} bg="sidebarBg" borderBottom="1px solid" borderColor="lineColor">
          <Flex align="center" justify="space-between" px={4} py={3}>
            <Logo />
            <HStack>
              <ColorModeButton />
              <IconButton aria-label="Sign out" size="sm" icon={<LogOutIcon boxSize={4} />} onClick={ws.onLogout} />
            </HStack>
          </Flex>
          <Box px={2} pb={2}>
            <NavLinks isAdmin={ws.isAdmin} compact />
          </Box>
        </Box>

        <Box maxW="1180px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 5, md: 8 }}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </Box>
      </Box>
    </Flex>
  );
}
