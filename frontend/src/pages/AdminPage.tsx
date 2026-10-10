import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, HStack, IconButton, Input, InputGroup, InputLeftElement, Select,
  SimpleGrid, Skeleton, Table, Tbody, Td, Text, Th, Thead, Tooltip, Tr, VStack,
} from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import type { SchemaTable, SchemaV2 } from '../api';
import { EngineBadge } from '../components/EngineBadge';
import { PageHeader } from '../components/PageHeader';
import { KeyIcon, LinkIcon, LockIcon, PencilIcon, PlusIcon, RefreshIcon, SearchIcon } from '../icons';
import { engineMeta } from '../lib/engines';
import { queryKeys } from '../lib/queryClient';
import { useWorkspace } from '../workspace/useWorkspace';

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="2xl" p={{ base: 4, md: 5 }}>
      <Flex align="center" justify="space-between" mb={4} gap={3} wrap="wrap">
        <Text fontWeight={700}>{title}</Text>
        {actions}
      </Flex>
      {children}
    </Box>
  );
}

function TableCard({ table }: { table: SchemaTable }) {
  return (
    <Box border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      <Flex px={3} py={2} bg="chipBg" align="center" justify="space-between">
        <Text fontWeight={700} fontSize="sm" noOfLines={1}>
          {table.name}
        </Text>
        <Text fontSize="xs" color="mutedText">
          {table.columns.length} columns
        </Text>
      </Flex>
      <Table size="sm">
        <Tbody>
          {table.columns.map((col) => (
            <Tr key={col.name}>
              <Td py={1.5} px={3} fontFamily="mono" fontSize="xs">
                <HStack spacing={1.5}>
                  {col.primary_key && (
                    <Tooltip label="Primary key" hasArrow>
                      <Box color="yellow.400" display="flex">
                        <KeyIcon boxSize={3} />
                      </Box>
                    </Tooltip>
                  )}
                  {col.foreign_key && (
                    <Tooltip label={`References ${col.foreign_key.table}.${col.foreign_key.column}`} hasArrow>
                      <Box color="brand.300" display="flex">
                        <LinkIcon boxSize={3} />
                      </Box>
                    </Tooltip>
                  )}
                  <Text as="span">{col.name}</Text>
                </HStack>
              </Td>
              <Td py={1.5} px={3} textAlign="right">
                <Tooltip label={col.db_type} hasArrow>
                  <Badge fontSize="0.6rem" bg="chipBg" color="mutedText" textTransform="none">
                    {col.type}
                  </Badge>
                </Tooltip>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
}

function DataModel({ connectionKey }: { connectionKey: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const schemaQuery = useQuery({
    queryKey: queryKeys.schema(connectionKey),
    queryFn: async () => (await http.get<SchemaV2>(`/api/connections/${connectionKey}/schema`)).data,
    enabled: connectionKey !== '',
  });

  const reload = async () => {
    // refresh=true makes the server read the structure again instead of using its cache
    const fresh = (await http.get<SchemaV2>(`/api/connections/${connectionKey}/schema`, { params: { refresh: true } })).data;
    queryClient.setQueryData(queryKeys.schema(connectionKey), fresh);
    void queryClient.resetQueries({ queryKey: queryKeys.tables(connectionKey) });
  };

  const data = schemaQuery.data;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (data?.tables ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle)).slice(0, 60);
  }, [data, filter]);

  if (schemaQuery.isPending) return <Skeleton h="240px" borderRadius="xl" />;
  if (schemaQuery.isError)
    return (
      <Alert status="error" borderRadius="xl">
        <AlertIcon />
        {apiErrorMessage(schemaQuery.error, 'Could not read the database structure')}
      </Alert>
    );

  const total = data?.tables.length ?? 0;
  return (
    <VStack align="stretch" spacing={4}>
      <Flex gap={3} wrap="wrap" align="center">
        <InputGroup size="sm" maxW="280px">
          <InputLeftElement pointerEvents="none" color="faintText">
            <SearchIcon boxSize={3.5} />
          </InputLeftElement>
          <Input placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </InputGroup>
        <Text fontSize="sm" color="mutedText" flex={1}>
          {total} tables · {data?.relationships.length ?? 0} relationships
          {shown.length < total && !filter && ` · showing the first ${shown.length}`}
        </Text>
        <Tooltip label="Read the structure from the database again" hasArrow>
          <IconButton aria-label="Reload structure" size="sm" icon={<RefreshIcon boxSize={4} />} onClick={() => void reload()} />
        </Tooltip>
      </Flex>

      {data && data.relationships.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText" mb={2}>
            RELATIONSHIPS (FOREIGN KEYS)
          </Text>
          <Box maxH="220px" overflowY="auto" border="1px solid" borderColor="lineColor" borderRadius="xl">
            <Table size="sm">
              <Thead>
                <Tr>
                  <Th>From</Th>
                  <Th>To</Th>
                </Tr>
              </Thead>
              <Tbody fontFamily="mono" fontSize="xs">
                {data.relationships.map((r) => (
                  <Tr key={`${r.from_table}.${r.from_columns.join(',')}->${r.to_table}`}>
                    <Td>
                      {r.from_table}.{r.from_columns.join(', ')}
                    </Td>
                    <Td>
                      {r.to_table}.{r.to_columns.join(', ')}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </Box>
      )}
      {data && data.relationships.length === 0 && (
        <Text fontSize="sm" color="mutedText">
          This database declares no foreign keys. Manual relationships arrive with the semantic layer (M7).
        </Text>
      )}

      <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={3}>
        {shown.map((t) => (
          <TableCard key={t.name} table={t} />
        ))}
      </SimpleGrid>
    </VStack>
  );
}

export default function AdminPage() {
  const ws = useWorkspace();
  const [modelKey, setModelKey] = useState('');
  if (!ws.isAdmin) return <Navigate to="/" replace />;
  const selected = ws.connections.some((c) => c.key === modelKey) ? modelKey : ws.activeKey;

  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader title="Admin" subtitle="Databases and their data model. Users and permissions get a screen in M9." />

      <Panel
        title="Databases"
        actions={
          <Button size="sm" leftIcon={<PlusIcon boxSize={4} />} onClick={ws.openAddConnection}>
            Add a database
          </Button>
        }
      >
        {ws.connections.length === 0 ? (
          <Text fontSize="sm" color="mutedText">
            No databases yet.
          </Text>
        ) : (
          <VStack align="stretch" spacing={2}>
            {ws.connections.map((c) => (
              <Flex key={c.key} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg">
                <EngineBadge engine={c.engine} size={30} />
                <Box flex={1} minW={0}>
                  <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                    {c.label}{' '}
                    <Text as="span" color="faintText" fontWeight={400} fontFamily="mono" fontSize="xs">
                      {c.key}
                    </Text>
                  </Text>
                  <Text fontSize="xs" color="mutedText" noOfLines={1}>
                    {engineMeta(c.engine).label} · {c.database}
                  </Text>
                </Box>
                {c.editable ? (
                  <IconButton
                    aria-label={`Edit ${c.label}`}
                    size="sm"
                    icon={<PencilIcon boxSize={3.5} />}
                    onClick={() => ws.openEditConnection(c.key)}
                  />
                ) : (
                  <Tooltip label="Defined in the .env file — edit it there" hasArrow>
                    <Box color="faintText" px={2}>
                      <LockIcon boxSize={3.5} />
                    </Box>
                  </Tooltip>
                )}
              </Flex>
            ))}
          </VStack>
        )}
      </Panel>

      {ws.connections.length > 0 && (
        <Panel
          title="Data model"
          actions={
            <Select size="sm" maxW="260px" value={selected} onChange={(e) => setModelKey(e.target.value)}>
              {ws.connections.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          }
        >
          <DataModel key={selected} connectionKey={selected} />
        </Panel>
      )}
    </VStack>
  );
}
