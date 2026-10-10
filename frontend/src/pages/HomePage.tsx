import { Badge, Box, Flex, SimpleGrid, Text, VStack } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { NAV_ITEMS } from '../shell/nav';
import { useWorkspace } from '../workspace/useWorkspace';

const BLURBS: Record<string, string> = {
  '/search': 'Find a value in every table of a database at once.',
  '/browse': 'Page through any table, sort, filter and export it to CSV.',
  '/questions': 'Build questions without SQL: join, filter, group and chart.',
  '/sql': 'Write read-only SQL with autocomplete and safe limits.',
  '/dashboards': 'Put questions together on a dashboard with shared filters.',
  '/admin': 'Connections, the data model and (later) users and permissions.',
};

export default function HomePage() {
  const { user, isAdmin, connections, loaded } = useWorkspace();
  const items = NAV_ITEMS.filter((item) => item.to !== '/' && (isAdmin || !item.adminOnly));
  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader
        title={`Hello, ${user.username}`}
        subtitle={loaded ? `${connections.length} database${connections.length === 1 ? '' : 's'} available to you` : ' '}
      />
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={4}>
        {items.map((item) => (
          <Box
            as={RouterLink}
            key={item.to}
            to={item.to}
            bg="panelBg"
            border="1px solid"
            borderColor="lineColor"
            borderRadius="2xl"
            p={5}
            transition="border-color 0.15s, transform 0.15s"
            _hover={{ borderColor: 'brand.400', transform: 'translateY(-1px)' }}
          >
            <Flex align="center" gap={3} mb={2}>
              <Flex w="36px" h="36px" align="center" justify="center" borderRadius="lg" bg="chipBg" color="brand.300">
                <item.icon boxSize={5} />
              </Flex>
              <Text fontWeight={700} flex={1}>
                {item.label}
              </Text>
              {item.milestone && (
                <Badge bg="chipBg" color="faintText" borderRadius="full" px={2} fontSize="0.65rem">
                  {item.milestone}
                </Badge>
              )}
            </Flex>
            <Text fontSize="sm" color="mutedText">
              {BLURBS[item.to]}
            </Text>
          </Box>
        ))}
      </SimpleGrid>
    </VStack>
  );
}
