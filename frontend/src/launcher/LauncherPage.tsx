import {
  Badge, Box, Flex, Heading, HStack, IconButton, SimpleGrid, Text, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { useNavigate } from 'react-router-dom';
import { ColorModeButton } from '../components/Sidebar';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { ChevronRightIcon, LogOutIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';
import { BarChartIcon, KanbanIcon } from '../kanban/icons';
import { t } from '../i18n/index.ts';
import { loadService, saveService, SERVICE_GRADIENT, SERVICE_HOME } from './service';
import type { Service } from './service';

interface Tile {
  service: Service;
  name: string;
  text: string;
  glow: string;
}

/** After sign-in: choose between the two Ncode services (the choice is remembered). */
export default function LauncherPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const last = loadService();
  const open = (service: Service) => {
    saveService(service);
    navigate(SERVICE_HOME[service]);
  };
  const tiles: Tile[] = [
    { service: 'bi', name: t('Ncode Search & BI'), text: t('Find any value in your databases, ask questions and build dashboards.'), glow: 'rgba(99,102,241,0.55)' },
    { service: 'kanban', name: t('Ncode - Kanban'), text: t('Boards, cards and action plans to give the team its work.'), glow: 'rgba(20,184,166,0.55)' },
  ];
  return (
    <Flex
      minH="100vh"
      direction="column"
      bgGradient="radial(circle at 15% 0%, rgba(99,102,241,0.20), transparent 45%), radial(circle at 90% 100%, rgba(20,184,166,0.16), transparent 45%)"
      data-testid="launcher"
    >
      <Flex justify="space-between" align="center" px={{ base: 4, md: 8 }} py={4}>
        <HStack spacing={3}>
          <Flex w="36px" h="36px" align="center" justify="center" borderRadius="xl" bgGradient="linear(to-br, brand.400, brand.600)" color="white" fontWeight={800} fontSize="lg" boxShadow="0 6px 16px -4px rgba(79,70,229,0.6)">
            N
          </Flex>
          <Text fontWeight={700} fontSize="lg" letterSpacing="-0.02em">
            Ncode
          </Text>
        </HStack>
        <HStack spacing={1}>
          <LanguageSwitch />
          <ColorModeButton />
          <Tooltip label={t('Sign out')} hasArrow>
            <IconButton aria-label={t('Sign out')} size="sm" icon={<LogOutIcon boxSize={4} />} onClick={ws.onLogout} />
          </Tooltip>
        </HStack>
      </Flex>

      <Flex flex={1} align="center" justify="center" px={4} pb={{ base: 8, md: 16 }}>
        <VStack spacing={{ base: 6, md: 10 }} w="100%" maxW="900px">
          <Box textAlign="center">
            <Heading as="h1" fontSize={{ base: '2xl', md: '4xl' }} letterSpacing="-0.03em" fontWeight={750}>
              {t('Welcome, {name}', { name: ws.user.username })}
            </Heading>
            <Text color="mutedText" mt={2} fontSize={{ base: 'md', md: 'lg' }}>
              {t('Where do you want to work today?')}
            </Text>
          </Box>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 4, md: 6 }} w="100%">
            {tiles.map((tile) => {
              const Icon = tile.service === 'bi' ? BarChartIcon : KanbanIcon;
              return (
                <Box
                  key={tile.service}
                  as="button"
                  type="button"
                  onClick={() => open(tile.service)}
                  textAlign="left"
                  role="group"
                  position="relative"
                  overflow="hidden"
                  bg="panelBg"
                  border="1px solid"
                  borderColor="lineColor"
                  borderRadius="3xl"
                  p={{ base: 6, md: 8 }}
                  boxShadow="tile"
                  transition="transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s"
                  _hover={{ transform: 'translateY(-4px)', borderColor: tile.glow, boxShadow: `0 28px 60px -28px ${tile.glow}` }}
                  _focusVisible={{ outline: 'none', borderColor: tile.glow, boxShadow: `0 0 0 3px ${tile.glow}` }}
                  data-testid={`launch-${tile.service}`}
                  aria-label={tile.name}
                >
                  <Box position="absolute" top="-60px" right="-60px" w="200px" h="200px" borderRadius="full" bg={tile.glow} opacity={0.12} filter="blur(10px)" transition="opacity 0.2s" _groupHover={{ opacity: 0.22 }} />
                  <Flex w={{ base: '56px', md: '68px' }} h={{ base: '56px', md: '68px' }} align="center" justify="center" borderRadius="2xl" bgGradient={SERVICE_GRADIENT[tile.service]} color="white" boxShadow={`0 12px 28px -10px ${tile.glow}`}>
                    <Icon boxSize={{ base: 7, md: 8 }} />
                  </Flex>
                  <HStack mt={{ base: 4, md: 6 }} spacing={2} align="center">
                    <Text fontSize={{ base: 'xl', md: '2xl' }} fontWeight={750} letterSpacing="-0.02em">
                      {tile.name}
                    </Text>
                    {last === tile.service && (
                      <Badge borderRadius="full" px={2} bg="chipBg" color="mutedText" textTransform="none" fontWeight={600}>
                        {t('Last used')}
                      </Badge>
                    )}
                  </HStack>
                  <Text color="mutedText" mt={2} fontSize={{ base: 'sm', md: 'md' }}>
                    {tile.text}
                  </Text>
                  <HStack mt={{ base: 4, md: 6 }} spacing={1} color="brand.400" fontWeight={600} fontSize="sm" transition="gap 0.15s" _groupHover={{ gap: 2 }}>
                    <Text as="span">{t('Open')}</Text>
                    <ChevronRightIcon boxSize={4} />
                  </HStack>
                </Box>
              );
            })}
          </SimpleGrid>
        </VStack>
      </Flex>
    </Flex>
  );
}
