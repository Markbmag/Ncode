import {
  Avatar, Badge, Box, Button, Flex, HStack, IconButton, Text, Tooltip, VStack, useColorMode,
} from '@chakra-ui/react';
import { NavLink } from 'react-router-dom';
import type { Connection, User } from '../api';
import { LockIcon, LogOutIcon, MoonIcon, PencilIcon, PlusIcon, SunIcon } from '../icons';
import { NAV_ITEMS } from '../shell/nav';
import { EngineBadge } from './EngineBadge';

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
          Data workspace
        </Text>
      </Box>
    </HStack>
  );
}

export function ColorModeButton() {
  const { colorMode, toggleColorMode } = useColorMode();
  return (
    <Tooltip label={colorMode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} hasArrow>
      <IconButton
        aria-label="Toggle color theme"
        size="sm"
        icon={colorMode === 'dark' ? <SunIcon boxSize={4} /> : <MoonIcon boxSize={4} />}
        onClick={toggleColorMode}
      />
    </Tooltip>
  );
}

/** The app's sections. `compact` is the horizontal strip used on small screens. */
export function NavLinks({ isAdmin, compact = false }: { isAdmin: boolean; compact?: boolean }) {
  return (
    <Flex
      as="nav"
      aria-label="Sections"
      direction={compact ? 'row' : 'column'}
      gap={compact ? 1 : 0.5}
      overflowX={compact ? 'auto' : undefined}
    >
      {NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly).map((item) => (
        <Box
          as={NavLink}
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          display="flex"
          alignItems="center"
          gap={3}
          px={3}
          py={compact ? 1.5 : 2}
          flexShrink={0}
          borderRadius="lg"
          fontSize="sm"
          fontWeight={600}
          color="mutedText"
          _hover={{ bg: 'panelHover', color: 'bodyText' }}
          sx={{ '&.active': { bg: 'rgba(99,102,241,0.14)', color: 'bodyText' } }}
        >
          <item.icon boxSize={4} />
          <Text as="span" flex={1} whiteSpace="nowrap">
            {item.label}
          </Text>
          {item.milestone && !compact && (
            <Tooltip label={`Coming in milestone ${item.milestone} of the roadmap`} hasArrow>
              <Badge fontSize="0.6rem" bg="chipBg" color="faintText" borderRadius="full" px={1.5}>
                soon
              </Badge>
            </Tooltip>
          )}
        </Box>
      ))}
    </Flex>
  );
}

export function Sidebar({ connections, activeKey, onSelect, isAdmin, onAdd, onEdit, user, onLogout }: SidebarProps) {
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
          DATABASES
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
                  {connection.database}
                </Text>
              </Box>
              {connection.source === 'env' && (
                <Tooltip label="Defined in the .env file — edit it there" hasArrow>
                  <Box color="faintText">
                    <LockIcon boxSize={3.5} />
                  </Box>
                </Tooltip>
              )}
              {connection.editable && (
                <Tooltip label="Edit connection" hasArrow>
                  <IconButton
                    aria-label={`Edit ${connection.label}`}
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

        {connections.length === 0 && (
          <Text fontSize="sm" color="mutedText" px={3} py={4}>
            No databases yet.
          </Text>
        )}
      </VStack>

      {isAdmin && (
        <Box px={4} pt={3}>
          <Button w="100%" variant="subtle" leftIcon={<PlusIcon boxSize={4} />} onClick={onAdd}>
            Add a database
          </Button>
        </Box>
      )}

      <Flex align="center" gap={3} p={4} mt={2} borderTop="1px solid" borderColor="lineColor">
        <Avatar size="sm" name={user.username} bg="brand.500" color="white" />
        <Box flex={1} minW={0}>
          <Text fontSize="sm" fontWeight={600} noOfLines={1}>
            {user.username}
          </Text>
          <Text fontSize="xs" color="mutedText">
            {user.role === 'admin' ? 'Administrator' : 'User'}
          </Text>
        </Box>
        <ColorModeButton />
        <Tooltip label="Sign out" hasArrow>
          <IconButton aria-label="Sign out" size="sm" icon={<LogOutIcon boxSize={4} />} onClick={onLogout} />
        </Tooltip>
      </Flex>
    </Flex>
  );
}
