import { useState } from 'react';
import {
  Badge, Box, Button, Checkbox, CheckboxGroup, Flex, FormControl, FormHelperText, FormLabel, HStack, IconButton, Input, Radio, RadioGroup,
  Select, Skeleton, Stack, Switch, Table, Tbody, Td, Text, Textarea, Th, Thead, Tooltip, Tr, VStack, Wrap, WrapItem, useToast,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, http } from '../api';
import type { SchemaV2 } from '../api';
import { KeyIcon, PencilIcon, PlusIcon, ShieldIcon, TrashIcon, UsersIcon } from '../icons';
import { DialogShell } from '../library/dialogs';
import { queryKeys } from '../lib/queryClient';
import { useWorkspace } from '../workspace/useWorkspace';
import { Panel } from './Panel';
import { connectionsValue, people, useAdminUsers, useGroups, useRowRules } from './peopleApi';
import type { AdminUser, Group } from './peopleApi';

const when = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : 'never');

/** Admin → People: users, groups (databases and collections for many at once) and row-level security. */
export function PeopleSettings() {
  return (
    <VStack align="stretch" spacing={6}>
      <Users />
      <Groups />
      <RowSecurity />
    </VStack>
  );
}

// ---------------------------------------------------------------- choosing databases

function ConnectionsPicker({ value, onChange, allLabel }: { value: '*' | string[]; onChange: (v: '*' | string[]) => void; allLabel: string }) {
  const ws = useWorkspace();
  return (
    <VStack align="stretch" spacing={2}>
      <RadioGroup value={value === '*' ? 'all' : 'some'} onChange={(v) => onChange(v === 'all' ? '*' : [])}>
        <Stack direction="row" spacing={4}>
          <Radio value="all" size="sm">
            {allLabel}
          </Radio>
          <Radio value="some" size="sm">
            Only these
          </Radio>
        </Stack>
      </RadioGroup>
      {value !== '*' && (
        <CheckboxGroup value={value} onChange={(v) => onChange(v as string[])}>
          <Wrap spacing={3}>
            {ws.connections.map((c) => (
              <WrapItem key={c.key}>
                <Checkbox size="sm" value={c.key}>
                  {c.label}
                </Checkbox>
              </WrapItem>
            ))}
          </Wrap>
        </CheckboxGroup>
      )}
    </VStack>
  );
}

// ---------------------------------------------------------------- users

function Users() {
  const toast = useToast();
  const ws = useWorkspace();
  const users = useAdminUsers();
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const act = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ status: 'success', title: done, duration: 1500 });
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again'), duration: 6000, isClosable: true });
    }
  };
  return (
    <Panel
      title="Users"
      subtitle="Who may sign in, which databases they may use (their own setting plus their groups'), and their email for subscriptions."
      actions={
        <Button size="sm" leftIcon={<PlusIcon boxSize={4} />} onClick={() => setEditing('new')} data-testid="add-user">
          Add user
        </Button>
      }
    >
      {users.isPending && <Skeleton h="80px" />}
      <Box overflowX="auto">
        <Table size="sm" data-testid="users-table">
          <Thead>
            <Tr>
              <Th textTransform="none">Name</Th>
              <Th textTransform="none">Groups</Th>
              <Th textTransform="none">Databases</Th>
              <Th textTransform="none">Last sign-in</Th>
              <Th textTransform="none">Active</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {users.data?.map((u) => (
              <Tr key={u.id} opacity={u.is_active ? 1 : 0.55} data-testid="user-row">
                <Td>
                  <HStack spacing={2}>
                    <Text fontWeight={600} fontSize="sm">
                      {u.username}
                    </Text>
                    {u.role === 'admin' && <Badge colorScheme="purple">admin</Badge>}
                    {u.row_rules > 0 && (
                      <Tooltip label={`${u.row_rules} row-level rule(s) from their groups`} hasArrow>
                        <Badge colorScheme="orange">row rules</Badge>
                      </Tooltip>
                    )}
                  </HStack>
                  <Text fontSize="xs" color="mutedText">
                    {u.email ?? 'no email'}
                  </Text>
                </Td>
                <Td fontSize="xs">{u.groups.join(', ') || '—'}</Td>
                <Td fontSize="xs">{u.role === 'admin' ? 'all (admin)' : u.effective_connections.join(', ') || 'none'}</Td>
                <Td fontSize="xs">{when(u.last_login_at)}</Td>
                <Td>
                  <Switch
                    size="sm"
                    isChecked={u.is_active}
                    isDisabled={u.username === ws.user.username}
                    onChange={(e) => void act('Could not change it', () => people.updateUser(u.username, { is_active: e.target.checked }))}
                    aria-label={`${u.username} may sign in`}
                  />
                </Td>
                <Td>
                  <HStack spacing={0} justify="flex-end">
                    <IconButton aria-label="Edit" size="xs" variant="ghost" icon={<PencilIcon boxSize={3.5} />} onClick={() => setEditing(u)} data-testid="edit-user" />
                    <Tooltip label="Set a new password" hasArrow>
                      <IconButton aria-label="Set a new password" size="xs" variant="ghost" icon={<KeyIcon boxSize={3.5} />} onClick={() => setResetting(u)} />
                    </Tooltip>
                    {u.username !== ws.user.username && (
                      <IconButton
                        aria-label="Delete"
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        icon={<TrashIcon boxSize={3.5} />}
                        onClick={() => {
                          if (window.confirm(`Delete ${u.username}? Their questions stay; their own collection becomes admin-only.`))
                            void act('Could not delete', () => people.deleteUser(u.username));
                        }}
                      />
                    )}
                  </HStack>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <PasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </Panel>
  );
}

function UserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const groups = useGroups();
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>(user?.role ?? 'user');
  const [email, setEmail] = useState(user?.email ?? '');
  const [connections, setConnections] = useState<'*' | string[]>(user ? connectionsValue(user.connections) : '*');
  const [memberOf, setMemberOf] = useState<string[]>(user?.groups ?? []);
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={user ? `Edit ${user.username}` : 'Add a user'}
      submitLabel={user ? 'Save' : 'Add user'}
      size="lg"
      canSubmit={!!username.trim() && (!!user || password.length >= 8)}
      onSubmit={() =>
        user
          ? people.updateUser(user.username, { role, email: email.trim() || null, connections, groups: memberOf })
          : people.createUser({ username: username.trim(), password, role, email: email.trim() || null, connections, groups: memberOf })
      }
    >
      {!user && (
        <HStack align="flex-start">
          <FormControl isRequired>
            <FormLabel fontSize="sm">User name</FormLabel>
            <Input size="sm" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoFocus data-testid="new-username" />
            <FormHelperText fontSize="xs">3–64: letters, digits, . _ -</FormHelperText>
          </FormControl>
          <FormControl isRequired>
            <FormLabel fontSize="sm">Password</FormLabel>
            <Input size="sm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" data-testid="new-password" />
            <FormHelperText fontSize="xs">At least 8 characters; they can change it themselves.</FormHelperText>
          </FormControl>
        </HStack>
      )}
      <HStack align="flex-start">
        <FormControl>
          <FormLabel fontSize="sm">Role</FormLabel>
          <Select size="sm" value={role} onChange={(e) => setRole(e.target.value)} data-testid="user-role">
            <option value="user">User</option>
            <option value="admin">Admin (everything, all databases)</option>
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel fontSize="sm">Email</FormLabel>
          <Input size="sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormControl>
      </HStack>
      {role !== 'admin' && (
        <FormControl>
          <FormLabel fontSize="sm">Databases</FormLabel>
          <ConnectionsPicker value={connections} onChange={setConnections} allLabel="All databases" />
          <FormHelperText fontSize="xs">Their groups can add more.</FormHelperText>
        </FormControl>
      )}
      <FormControl>
        <FormLabel fontSize="sm">Groups</FormLabel>
        {groups.data?.length === 0 && (
          <Text fontSize="xs" color="mutedText">
            No groups yet.
          </Text>
        )}
        <CheckboxGroup value={memberOf} onChange={(v) => setMemberOf(v as string[])}>
          <Wrap spacing={3}>
            {groups.data?.map((g) => (
              <WrapItem key={g.id}>
                <Checkbox size="sm" value={g.name}>
                  {g.name}
                </Checkbox>
              </WrapItem>
            ))}
          </Wrap>
        </CheckboxGroup>
      </FormControl>
    </DialogShell>
  );
}

function PasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState('');
  return (
    <DialogShell isOpen onClose={onClose} title={`New password for ${user.username}`} submitLabel="Set password" canSubmit={password.length >= 8}
      onSubmit={() => people.updateUser(user.username, { password })}>
      <Text fontSize="sm" color="mutedText">
        They are signed out everywhere and sign in with this password. Tell it to them in person or by phone.
      </Text>
      <Input size="sm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" placeholder="at least 8 characters" />
    </DialogShell>
  );
}

// ---------------------------------------------------------------- groups

function Groups() {
  const toast = useToast();
  const groups = useGroups();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  return (
    <Panel
      title="Groups"
      subtitle="Give databases and collections to many people at once (Library → a collection → Share → Group), and limit which rows they see."
      actions={
        <Button size="sm" leftIcon={<PlusIcon boxSize={4} />} onClick={() => setEditing('new')} data-testid="add-group">
          Add group
        </Button>
      }
    >
      <VStack align="stretch" spacing={2}>
        {groups.data?.length === 0 && (
          <Text fontSize="sm" color="mutedText">
            No groups yet, e.g. “Sales EU”, “Logistics”, “Management”.
          </Text>
        )}
        {groups.data?.map((g) => (
          <Flex key={g.id} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg" data-testid="group-row">
            <UsersIcon boxSize={4} />
            <Box flex={1} minW={0}>
              <HStack>
                <Text fontSize="sm" fontWeight={600}>
                  {g.name}
                </Text>
                {g.row_rules > 0 && <Badge colorScheme="orange">{g.row_rules} row rule{g.row_rules > 1 ? 's' : ''}</Badge>}
              </HStack>
              <Text fontSize="xs" color="mutedText" noOfLines={1}>
                {g.members.length} member{g.members.length === 1 ? '' : 's'}
                {g.members.length ? `: ${g.members.join(', ')}` : ''} · databases: {g.connections === '*' ? 'all' : g.connections || 'none'}
              </Text>
            </Box>
            <IconButton aria-label="Edit" size="sm" icon={<PencilIcon boxSize={3.5} />} onClick={() => setEditing(g)} />
            <IconButton
              aria-label="Delete"
              size="sm"
              variant="ghost"
              colorScheme="red"
              icon={<TrashIcon boxSize={3.5} />}
              onClick={() => {
                if (window.confirm(`Delete the group ${g.name}? Its members lose what the group gave them, and its row rules go.`))
                  people.deleteGroup(g.id).catch((e: unknown) => toast({ status: 'error', title: 'Could not delete', description: apiErrorMessage(e, 'Please try again') }));
              }}
            />
          </Flex>
        ))}
      </VStack>
      {editing && <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function GroupDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const users = useAdminUsers();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [connections, setConnections] = useState<'*' | string[]>(group ? connectionsValue(group.connections) : []);
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={group ? `Edit ${group.name}` : 'Add a group'}
      submitLabel="Save"
      size="lg"
      canSubmit={!!name.trim()}
      onSubmit={() => people.saveGroup(group?.id ?? null, { name: name.trim(), description: description.trim() || null, connections, members })}
    >
      <FormControl isRequired>
        <FormLabel fontSize="sm">Name</FormLabel>
        <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus data-testid="group-name" />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">Description</FormLabel>
        <Textarea size="sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">Databases the members may use</FormLabel>
        <ConnectionsPicker value={connections} onChange={setConnections} allLabel="All databases" />
      </FormControl>
      <FormControl>
        <FormLabel fontSize="sm">Members</FormLabel>
        <CheckboxGroup value={members} onChange={(v) => setMembers(v as string[])}>
          <Wrap spacing={3} data-testid="group-members">
            {users.data?.map((u) => (
              <WrapItem key={u.id}>
                <Checkbox size="sm" value={u.username}>
                  {u.username}
                </Checkbox>
              </WrapItem>
            ))}
          </Wrap>
        </CheckboxGroup>
      </FormControl>
    </DialogShell>
  );
}

// ---------------------------------------------------------------- row-level security

function RowSecurity() {
  const toast = useToast();
  const ws = useWorkspace();
  const groups = useGroups();
  const rules = useRowRules();
  const [groupId, setGroupId] = useState('');
  const [connection, setConnection] = useState('');
  const [table, setTable] = useState('');
  const [column, setColumn] = useState('');
  const [values, setValues] = useState('');
  const schema = useQuery({
    queryKey: queryKeys.schema(connection),
    enabled: connection !== '',
    queryFn: async () => (await http.get<SchemaV2>(`/api/connections/${connection}/schema`)).data,
  });
  const columns = schema.data?.tables.find((t) => t.name === table)?.columns ?? [];
  const add = async () => {
    try {
      await people.addRule({
        group_id: Number(groupId), connection, table, column,
        values: values.split(/[,\n]/).map((v) => v.trim()).filter(Boolean),
      });
      setValues('');
      toast({ status: 'success', title: 'Rule added', duration: 1500 });
    } catch (e) {
      toast({ status: 'error', title: 'Could not add the rule', description: apiErrorMessage(e, 'Please try again'), duration: 6000, isClosable: true });
    }
  };
  return (
    <Panel
      title="Row-level security"
      subtitle={
        <>
          Members of a group only see the rows a rule allows, in questions, dashboards, subscriptions, Browse and exports. For them, SQL is
          off on that database and Search skips the table. Several rules of one group must all match; with several groups, rows of any of
          them are shown. <b>{'{username}'}</b> or <b>{'{email}'}</b> as a value means the person looking. Admins always see everything.
        </>
      }
    >
      <VStack align="stretch" spacing={2} mb={4}>
        {rules.data?.length === 0 && (
          <Text fontSize="sm" color="mutedText">
            No rules: everyone sees every row of the databases they may use.
          </Text>
        )}
        {rules.data?.map((r) => (
          <Flex key={r.id} align="center" gap={3} px={3} py={2} borderRadius="xl" bg="chipBg" data-testid="rule-row">
            <ShieldIcon boxSize={4} color="orange.400" />
            <Text fontSize="sm" flex={1}>
              <b>{r.group}</b> sees only <code>{r.table}</code> rows where <code>{r.column}</code> is {r.values.map((v) => `“${v}”`).join(' or ')}{' '}
              <Text as="span" color="mutedText" fontSize="xs">
                ({ws.connections.find((c) => c.key === r.connection)?.label ?? r.connection})
              </Text>
            </Text>
            <IconButton
              aria-label="Delete rule"
              size="sm"
              variant="ghost"
              colorScheme="red"
              icon={<TrashIcon boxSize={3.5} />}
              onClick={() => people.deleteRule(r.id).catch((e: unknown) => toast({ status: 'error', title: 'Could not delete', description: apiErrorMessage(e, 'Please try again') }))}
            />
          </Flex>
        ))}
      </VStack>
      <Box border="1px dashed" borderColor="lineColor" borderRadius="xl" p={3}>
        <Text fontSize="sm" fontWeight={600} mb={2}>
          Add a rule
        </Text>
        <Wrap spacing={2} align="flex-end">
          <WrapItem>
            <Select size="sm" w="160px" placeholder="Group…" value={groupId} onChange={(e) => setGroupId(e.target.value)} data-testid="rule-group">
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </WrapItem>
          <WrapItem>
            <Select size="sm" w="160px" placeholder="Database…" value={connection} onChange={(e) => { setConnection(e.target.value); setTable(''); setColumn(''); }} data-testid="rule-connection">
              {ws.connections.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </WrapItem>
          <WrapItem>
            <Select size="sm" w="180px" placeholder="Table…" value={table} onChange={(e) => { setTable(e.target.value); setColumn(''); }} isDisabled={!schema.data} data-testid="rule-table">
              {schema.data?.tables.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
          </WrapItem>
          <WrapItem>
            <Select size="sm" w="160px" placeholder="Column…" value={column} onChange={(e) => setColumn(e.target.value)} isDisabled={!table} data-testid="rule-column">
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </WrapItem>
          <WrapItem>
            <Input size="sm" w="220px" placeholder="is one of: EU, CH  or  {username}" value={values} onChange={(e) => setValues(e.target.value)} data-testid="rule-values" />
          </WrapItem>
          <WrapItem>
            <Button size="sm" variant="brand" onClick={() => void add()} isDisabled={!groupId || !connection || !table || !column || !values.trim()} data-testid="add-rule">
              Add
            </Button>
          </WrapItem>
        </Wrap>
        {groups.data?.length === 0 && (
          <Text fontSize="xs" color="mutedText" mt={2}>
            Rules belong to a group: add a group first.
          </Text>
        )}
      </Box>
    </Panel>
  );
}
