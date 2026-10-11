import { useMemo, useState } from 'react';
import {
  Alert, AlertIcon as ChakraAlertIcon, Badge, Box, Button, Checkbox, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerFooter,
  DrawerHeader, DrawerOverlay, Flex, FormControl, FormLabel, HStack, IconButton, Input, Link, Modal, ModalBody,
  ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, NumberInput, NumberInputField, Select, Skeleton, Switch, Tag, TagCloseButton,
  TagLabel, Text, Textarea, Tooltip, VStack, Wrap, WrapItem, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { BellIcon, MailIcon, PencilIcon, PlusIcon, SendIcon, TrashIcon } from '../icons';
import { FilterBar } from '../dashboards/FilterBar';
import { runValues } from '../dashboards/logic';
import type { FilterValues } from '../dashboards/logic';
import type { DashFilter } from '../dashboards/types';
import { ParametersBar } from '../library/ParametersBar';
import type { ParameterDef, ParamValues } from '../library/params';
import { useWorkspace } from '../workspace/useWorkspace';
import { subscriptions, useSubscription, useSubscriptionOptions, useSubscriptions } from './api';
import {
  DAY_SHORT, STATUS_LABEL, changeEvery, describeAlert, describeSchedule, domainAllowed, newSubscription, pad2, parseEmails, problem,
  recipientCount, timeAgo,
} from './logic';
import type { Preview, Subscription, SubscriptionBody, SubscriptionOptions, SubscriptionRun, TargetType } from './types';

export interface SubscriptionTarget {
  type: TargetType;
  id: number;
  name: string;
  filters?: DashFilter[];          // dashboards
  parameters?: ParameterDef[];     // questions
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  target: SubscriptionTarget;
  /** open straight into a new alert (question menu → "Set up an alert") */
  startWith?: 'subscription' | 'alert' | null;
}

const DEST_LABEL: Record<string, string> = { slack: 'Slack', teams: 'Teams', telegram: 'Telegram', webhook: 'Webhook' };

/** Subscriptions and alerts of one dashboard or question: the list, an editor, the run history. */
export function SubscriptionsDrawer({ isOpen, onClose, target, startWith = null }: Props) {
  return (
    <Drawer isOpen={isOpen} onClose={onClose} size="md" placement="right">
      <DrawerOverlay />
      <DrawerContent data-testid="subscriptions-drawer">
        <DrawerCloseButton />
        {/* the content mounts when the drawer opens: each opening starts fresh */}
        <DrawerInner target={target} startWith={startWith} />
      </DrawerContent>
    </Drawer>
  );
}

function DrawerInner({ target, startWith }: { target: SubscriptionTarget; startWith: Props['startWith'] }) {
  const ws = useWorkspace();
  const list = useSubscriptions({ target_type: target.type, target_id: target.id });
  const options = useSubscriptionOptions();
  const [editing, setEditing] = useState<{ id: number | null; body: SubscriptionBody } | null>(() =>
    startWith ? { id: null, body: newSubscription(target.type, target.id, ws.user.username, startWith === 'alert') } : null,
  );

  const startNew = (alert: boolean) => setEditing({ id: null, body: newSubscription(target.type, target.id, ws.user.username, alert) });
  const edit = (s: Subscription) =>
    setEditing({ id: s.id, body: { name: s.name, target_type: s.target_type, target_id: s.target_id, schedule: s.schedule, recipients: s.recipients, options: s.options, alert: s.alert, enabled: s.enabled } });

  return (
    <>
      <DrawerHeader fontSize="md" borderBottom="1px solid" borderColor="lineColor">
        {editing ? (editing.id ? 'Edit' : editing.body.alert ? 'New alert' : 'New subscription') : 'Subscriptions and alerts'}
        <Text fontSize="xs" color="mutedText" fontWeight={400} noOfLines={1}>
          {target.name}
        </Text>
      </DrawerHeader>
      {editing && options.data ? (
        <Editor key={editing.id ?? 'new'} id={editing.id} initial={editing.body} target={target} options={options.data} onDone={() => setEditing(null)} />
      ) : (
        <>
          <DrawerBody py={4}>
            <VStack align="stretch" spacing={3}>
              {options.data && !options.data.email_configured && (
                <Alert status="info" borderRadius="md" fontSize="sm">
                  <ChakraAlertIcon />
                  <Box>
                    Email is not set up yet, so only Slack, Teams, Telegram or webhooks can be used.{' '}
                    {ws.isAdmin ? (
                      <Link as={RouterLink} to="/admin?tab=delivery" textDecoration="underline">
                        Set up email
                      </Link>
                    ) : (
                      'Ask an admin to set it up.'
                    )}
                  </Box>
                </Alert>
              )}
              {list.isPending && <Skeleton h="80px" borderRadius="lg" />}
              {list.data?.length === 0 && (
                <Text fontSize="sm" color="mutedText">
                  {target.type === 'dashboard'
                    ? 'Get this dashboard by email or in a chat on a schedule: every morning, every Monday, on the first of the month…'
                    : 'Get this question on a schedule, or set up an alert that only sends when something happens.'}
                </Text>
              )}
              {list.data?.map((s) => <Row key={s.id} sub={s} onEdit={() => edit(s)} />)}
            </VStack>
          </DrawerBody>
          <DrawerFooter borderTop="1px solid" borderColor="lineColor" gap={2}>
            {target.type === 'question' && (
              <Button size="sm" variant="subtle" leftIcon={<BellIcon boxSize={4} />} onClick={() => startNew(true)} data-testid="new-alert" isDisabled={!options.data}>
                New alert
              </Button>
            )}
            <Button size="sm" variant="brand" leftIcon={<PlusIcon boxSize={4} />} onClick={() => startNew(false)} data-testid="new-subscription" isDisabled={!options.data}>
              New subscription
            </Button>
          </DrawerFooter>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- one subscription in the list

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge fontSize="2xs">not sent yet</Badge>;
  const s = STATUS_LABEL[status] ?? { label: status, color: 'gray' };
  return (
    <Badge fontSize="2xs" colorScheme={s.color}>
      {s.label}
    </Badge>
  );
}

function Row({ sub, onEdit }: { sub: Subscription; onEdit: () => void }) {
  const toast = useToast();
  const act = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ status: 'success', title: done, duration: 2000 });
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again') });
    }
  };
  return (
    <Box border="1px solid" borderColor="lineColor" borderRadius="lg" p={3} bg="panelBg" opacity={sub.enabled ? 1 : 0.6} data-testid="subscription-row">
      <Flex align="center" gap={2}>
        {sub.alert ? <BellIcon boxSize={4} color="orange.400" /> : <MailIcon boxSize={4} color="brand.400" />}
        <Text fontWeight={600} fontSize="sm" flex={1} noOfLines={1}>
          {sub.name || (sub.alert ? describeAlert(sub.alert) : describeSchedule(sub.schedule))}
        </Text>
        <StatusBadge status={sub.running ? 'running' : sub.last_status} />
        {sub.can_manage && (
          <Tooltip label={sub.enabled ? 'On: click to pause' : 'Paused: click to switch on'} hasArrow>
            <Box>
              <Switch size="sm" isChecked={sub.enabled} onChange={(e) => void act('Could not change it', () => subscriptions.setEnabled(sub.id, e.target.checked))} aria-label="On or paused" />
            </Box>
          </Tooltip>
        )}
      </Flex>
      <Text fontSize="xs" color="mutedText" mt={1}>
        {sub.alert ? `${describeAlert(sub.alert)} · checked ${describeSchedule(sub.schedule).toLowerCase()}` : describeSchedule(sub.schedule)}
        {' · '}
        {recipientCount(sub.recipients)} recipient{recipientCount(sub.recipients) === 1 ? '' : 's'}
        {!sub.can_manage && sub.owner && ` · set up by ${sub.owner}`}
      </Text>
      <Text fontSize="xs" color="faintText">
        Last {timeAgo(sub.last_run_at)}
        {sub.enabled && sub.next_run_at ? ` · next ${timeAgo(sub.next_run_at)}` : ''}
      </Text>
      {sub.last_error && (
        <Text fontSize="xs" color="red.400" mt={1} noOfLines={2}>
          {sub.last_error}
        </Text>
      )}
      <HStack spacing={1} mt={2}>
        {sub.can_manage ? (
          <>
            <Button size="xs" variant="ghost" leftIcon={<PencilIcon boxSize={3} />} onClick={onEdit} data-testid="edit-subscription">
              Edit
            </Button>
            <Button size="xs" variant="ghost" leftIcon={<SendIcon boxSize={3} />} onClick={() => void act('Could not send', () => subscriptions.sendNow(sub.id), 'Sending now: the result shows here in a moment')} data-testid="send-now">
              Send now
            </Button>
          </>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => void act('Could not unsubscribe', () => subscriptions.unsubscribe(sub.id), 'You will not get this any more')}>
            Unsubscribe me
          </Button>
        )}
      </HStack>
    </Box>
  );
}

// ---------------------------------------------------------------- editor

function Editor({ id, initial, target, options, onDone }: { id: number | null; initial: SubscriptionBody; target: SubscriptionTarget; options: SubscriptionOptions; onDone: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [body, setBody] = useState<SubscriptionBody>(initial);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const saved = useSubscription(id, true);
  const set = (patch: Partial<SubscriptionBody>) => setBody((b) => ({ ...b, ...patch }));
  const s = body.schedule;
  const setSchedule = (patch: Partial<SubscriptionBody['schedule']>) => set({ schedule: { ...s, ...patch } });
  const issue = problem(body);

  // filter values: dashboards keep them as the run sends them, the bar edits FilterValues
  const [filterValues, setFilterValues] = useState<FilterValues>(() => (target.type === 'dashboard' ? (initial.options.filters as FilterValues) : {}));
  const [paramValues, setParamValues] = useState<ParamValues>(() => (target.type === 'question' ? (initial.options.filters as ParamValues) : {}));
  const filters = useMemo(
    () => (target.type === 'dashboard' ? runValues(target.filters ?? [], filterValues) : (paramValues as Record<string, unknown>)),
    [target, filterValues, paramValues],
  );
  const full: SubscriptionBody = { ...body, options: { ...body.options, filters } };

  const save = async () => {
    setBusy(true);
    try {
      if (id) await subscriptions.replace(id, full);
      else await subscriptions.create(full);
      toast({ status: 'success', title: body.alert ? 'Alert saved' : 'Subscription saved', duration: 1500 });
      onDone();
    } catch (e) {
      toast({ status: 'error', title: 'Could not save', description: apiErrorMessage(e, 'Please try again'), duration: 6000, isClosable: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await subscriptions.remove(id);
      onDone();
    } catch (e) {
      toast({ status: 'error', title: 'Could not delete', description: apiErrorMessage(e, 'Please try again') });
    } finally {
      setBusy(false);
    }
  };
  const showPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await subscriptions.preview(full));
    } catch (e) {
      toast({ status: 'error', title: 'No preview', description: apiErrorMessage(e, 'Please try again') });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <>
      <DrawerBody py={4}>
        <VStack align="stretch" spacing={5}>
          {body.alert && (
            <Section title="Send when">
              <Select size="sm" value={body.alert.type} onChange={(e) => set({ alert: { ...body.alert!, type: e.target.value as 'rows' } })} data-testid="alert-type">
                <option value="rows">the question has results (any rows)</option>
                <option value="above">a number goes above a value</option>
                <option value="below">a number drops below a value</option>
              </Select>
              {body.alert.type !== 'rows' && (
                <HStack>
                  <Input size="sm" placeholder="column (empty: the first number)" value={body.alert.column ?? ''} onChange={(e) => set({ alert: { ...body.alert!, column: e.target.value.trim() || null } })} />
                  <NumberInput size="sm" w="160px" value={body.alert.value ?? ''} onChange={(_t, n) => set({ alert: { ...body.alert!, value: Number.isNaN(n) ? null : n } })}>
                    <NumberInputField placeholder="value" data-testid="alert-value" />
                  </NumberInput>
                </HStack>
              )}
              <Text fontSize="xs" color="mutedText">
                {body.alert.type === 'rows'
                  ? 'Tip: filter the question so it only returns the rows that need attention (e.g. stock below 10).'
                  : 'Checks the last row: for a question by month, that is the latest month.'}
              </Text>
              <Checkbox size="sm" isChecked={body.alert.once} onChange={(e) => set({ alert: { ...body.alert!, once: e.target.checked } })}>
                Only once, then switch the alert off
              </Checkbox>
            </Section>
          )}

          <Section title={body.alert ? 'Check' : 'When'}>
            <HStack wrap="wrap" spacing={2}>
              <Select size="sm" w="150px" value={s.every} onChange={(e) => set({ schedule: changeEvery(s, e.target.value as 'day') })} data-testid="schedule-every">
                <option value="hour">Every hour</option>
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </Select>
              {s.every === 'month' && (
                <Select size="sm" w="150px" value={s.monthday} onChange={(e) => setSchedule({ monthday: Number(e.target.value) })} aria-label="Day of the month">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      on the {d}.
                    </option>
                  ))}
                  <option value={-1}>on the last day</option>
                </Select>
              )}
              {s.every !== 'hour' ? (
                <HStack spacing={1}>
                  <Text fontSize="sm">at</Text>
                  <Select size="sm" w="80px" value={s.hour} onChange={(e) => setSchedule({ hour: Number(e.target.value) })} aria-label="Hour" data-testid="schedule-hour">
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {pad2(h)}
                      </option>
                    ))}
                  </Select>
                  <Text>:</Text>
                  <Select size="sm" w="80px" value={s.minute} onChange={(e) => setSchedule({ minute: Number(e.target.value) })} aria-label="Minute">
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>
                        {pad2(m)}
                      </option>
                    ))}
                  </Select>
                </HStack>
              ) : (
                <HStack spacing={1}>
                  <Text fontSize="sm">at minute</Text>
                  <Select size="sm" w="80px" value={s.minute} onChange={(e) => setSchedule({ minute: Number(e.target.value) })} aria-label="Minute">
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>
                        :{pad2(m)}
                      </option>
                    ))}
                  </Select>
                </HStack>
              )}
            </HStack>
            {s.every !== 'month' && (
              <HStack spacing={1} data-testid="schedule-days">
                {DAY_SHORT.map((d, i) => {
                  const on = s.days.includes(i);
                  return (
                    <Button
                      key={d}
                      size="xs"
                      variant={on ? 'brand' : 'subtle'}
                      onClick={() =>
                        setSchedule({ days: s.every === 'week' ? [i] : on ? s.days.filter((x) => x !== i) : [...s.days, i].sort((a, b) => a - b) })
                      }
                    >
                      {d}
                    </Button>
                  );
                })}
              </HStack>
            )}
            <Text fontSize="xs" color="mutedText" data-testid="schedule-text">
              {describeSchedule(s)} · time zone {s.timezone}
              {!options.scheduler && ' · the scheduler is switched off on this server: only "Send now" works'}
            </Text>
          </Section>

          <Section title="To">
            <Recipients body={body} set={set} options={options} isAdmin={ws.isAdmin} me={ws.user.username} />
          </Section>

          {target.type === 'dashboard' && (target.filters?.length ?? 0) > 0 && (
            <Section title="Filter values">
              <FilterBar filters={target.filters ?? []} values={filterValues} onChange={setFilterValues} />
              <Text fontSize="xs" color="mutedText">
                Empty filters use the dashboard's defaults. Relative dates (like "last 30 days") are worked out on each send.
              </Text>
            </Section>
          )}
          {target.type === 'question' && (target.parameters?.length ?? 0) > 0 && (
            <Section title="Parameter values">
              <Box border="1px solid" borderColor="lineColor" borderRadius="md">
                <ParametersBar defs={target.parameters ?? []} values={paramValues} onValues={setParamValues} onDefs={null} />
              </Box>
            </Section>
          )}

          <Section title="Content">
            <FormControl>
              <FormLabel fontSize="xs">Name (optional, used as the email subject)</FormLabel>
              <Input size="sm" value={body.name} maxLength={200} placeholder={target.name} onChange={(e) => set({ name: e.target.value })} />
            </FormControl>
            <FormControl>
              <FormLabel fontSize="xs">Note above the results (optional)</FormLabel>
              <Textarea size="sm" rows={2} value={body.options.message} maxLength={2000} onChange={(e) => set({ options: { ...body.options, message: e.target.value } })} />
            </FormControl>
            <HStack spacing={4} wrap="wrap">
              <FormControl w="auto">
                <FormLabel fontSize="xs">Attach the results</FormLabel>
                <Select size="sm" w="170px" value={body.options.attach} onChange={(e) => set({ options: { ...body.options, attach: e.target.value as 'none' } })} data-testid="attach">
                  <option value="none">No files</option>
                  <option value="csv">CSV files</option>
                  <option value="xlsx">Excel files</option>
                </Select>
              </FormControl>
              <FormControl w="auto">
                <FormLabel fontSize="xs">Rows shown per card</FormLabel>
                <NumberInput size="sm" w="100px" min={1} max={50} value={body.options.rows} onChange={(_t, n) => set({ options: { ...body.options, rows: Number.isNaN(n) ? 10 : Math.min(50, Math.max(1, n)) } })}>
                  <NumberInputField />
                </NumberInput>
              </FormControl>
            </HStack>
            {!body.alert && (
              <Checkbox size="sm" isChecked={body.options.skip_empty} onChange={(e) => set({ options: { ...body.options, skip_empty: e.target.checked } })}>
                Don't send when there are no results
              </Checkbox>
            )}
            <Text fontSize="xs" color="mutedText">
              Recipients see what you can see: the results are run with your permissions.
            </Text>
          </Section>

          {id && saved.data?.runs && saved.data.runs.length > 0 && (
            <Section title="Recent sends">
              <VStack align="stretch" spacing={1}>
                {saved.data.runs.slice(0, 8).map((r) => (
                  <RunLine key={r.id} run={r} />
                ))}
              </VStack>
            </Section>
          )}
        </VStack>
      </DrawerBody>
      <DrawerFooter borderTop="1px solid" borderColor="lineColor" gap={2}>
        {id && (
          <IconButton aria-label="Delete" size="sm" variant="ghost" colorScheme="red" icon={<TrashIcon boxSize={4} />} onClick={() => void remove()} isDisabled={busy} data-testid="delete-subscription" />
        )}
        <Box flex={1} />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Back
        </Button>
        <Button size="sm" variant="subtle" onClick={() => void showPreview()} isLoading={previewing} data-testid="preview-subscription">
          Preview
        </Button>
        <Tooltip label={issue ?? ''} isDisabled={!issue} hasArrow>
          <Button size="sm" variant="brand" onClick={() => void save()} isLoading={busy} isDisabled={!!issue} data-testid="save-subscription">
            Save
          </Button>
        </Tooltip>
      </DrawerFooter>
      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack align="stretch" spacing={2}>
      <Text fontSize="2xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.06em">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

function Recipients({ body, set, options, isAdmin, me }: { body: SubscriptionBody; set: (p: Partial<SubscriptionBody>) => void; options: SubscriptionOptions; isAdmin: boolean; me: string }) {
  const r = body.recipients;
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const people = options.people;
  const noEmail = new Set(people.filter((p) => !p.has_email).map((p) => p.username));
  const addTyped = () => {
    const { valid, invalid } = parseEmails(typed);
    const blocked = isAdmin ? [] : valid.filter((e) => !domainAllowed(e.toLowerCase(), options.allowed_domains));
    const ok = valid.filter((e) => !blocked.includes(e));
    set({ recipients: { ...r, emails: [...new Set([...r.emails, ...ok])] } });
    setError(
      invalid.length ? `Not an address: ${invalid.join(', ')}` : blocked.length ? `Only ${options.allowed_domains.join(', ')} addresses: ${blocked.join(', ')}` : null,
    );
    setTyped(invalid.join(' '));
  };
  return (
    <VStack align="stretch" spacing={2}>
      <Wrap spacing={1}>
        {r.users.map((u) => (
          <WrapItem key={u}>
            <Tag size="sm" colorScheme={noEmail.has(u) ? 'orange' : 'purple'} borderRadius="full">
              <TagLabel>{u === me ? `${u} (you)` : u}</TagLabel>
              <TagCloseButton onClick={() => set({ recipients: { ...r, users: r.users.filter((x) => x !== u) } })} />
            </Tag>
          </WrapItem>
        ))}
        {r.emails.map((e) => (
          <WrapItem key={e}>
            <Tag size="sm" borderRadius="full">
              <TagLabel>{e}</TagLabel>
              <TagCloseButton onClick={() => set({ recipients: { ...r, emails: r.emails.filter((x) => x !== e) } })} />
            </Tag>
          </WrapItem>
        ))}
      </Wrap>
      {r.users.some((u) => noEmail.has(u)) && (
        <Text fontSize="xs" color="orange.400">
          Orange names have no email address yet: they can add it with the envelope button next to their name (bottom left).
        </Text>
      )}
      <HStack>
        <Select
          size="sm"
          placeholder="Add a person…"
          value=""
          onChange={(e) => e.target.value && set({ recipients: { ...r, users: [...r.users, e.target.value].sort() } })}
          data-testid="add-person"
        >
          {people.filter((p) => !r.users.includes(p.username)).map((p) => (
            <option key={p.username} value={p.username}>
              {p.username}
              {p.has_email ? '' : ' (no email address)'}
            </option>
          ))}
        </Select>
      </HStack>
      <HStack align="flex-start">
        <Input
          size="sm"
          placeholder="Other addresses, e.g. boss@company.com"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTyped();
            }
          }}
          onBlur={() => typed.trim() && addTyped()}
          data-testid="add-emails"
        />
        <Button size="sm" variant="subtle" onClick={addTyped} isDisabled={!typed.trim()}>
          Add
        </Button>
      </HStack>
      {error && (
        <Text fontSize="xs" color="red.400">
          {error}
        </Text>
      )}
      {options.allowed_domains.length > 0 && !isAdmin && (
        <Text fontSize="xs" color="mutedText">
          Addresses must end with {options.allowed_domains.map((d) => `@${d}`).join(', ')}.
        </Text>
      )}
      {options.destinations.length > 0 && (
        <VStack align="stretch" spacing={1} pt={1}>
          {options.destinations.map((d) => (
            <Checkbox
              key={d.id}
              size="sm"
              isChecked={r.destinations.includes(d.id)}
              onChange={(e) =>
                set({ recipients: { ...r, destinations: e.target.checked ? [...r.destinations, d.id] : r.destinations.filter((x) => x !== d.id) } })
              }
              data-testid={`destination-${d.id}`}
            >
              {DEST_LABEL[d.kind]}: {d.name}
            </Checkbox>
          ))}
        </VStack>
      )}
      {options.destinations.length === 0 && isAdmin && (
        <Text fontSize="xs" color="mutedText">
          Slack, Teams, Telegram and webhooks are added under{' '}
          <Link as={RouterLink} to="/admin?tab=delivery" textDecoration="underline">
            Admin → Delivery
          </Link>
          .
        </Text>
      )}
    </VStack>
  );
}

function RunLine({ run }: { run: SubscriptionRun }) {
  const problems = run.detail?.channels?.filter((c) => c.status !== 'sent') ?? [];
  const sent = run.detail?.channels?.filter((c) => c.status === 'sent').length ?? 0;
  return (
    <Box fontSize="xs" borderBottom="1px solid" borderColor="lineColor" pb={1}>
      <HStack>
        <StatusBadge status={run.status} />
        <Text color="mutedText">{new Date(run.started_at * 1000).toLocaleString()}</Text>
        <Text color="faintText">{run.trigger === 'manual' ? 'sent by hand' : 'on schedule'}</Text>
        {sent > 0 && <Text color="faintText">· to {sent}</Text>}
      </HStack>
      {run.detail?.condition && <Text color="mutedText">{run.detail.condition}</Text>}
      {run.detail?.reason && <Text color="mutedText">{run.detail.reason}</Text>}
      {run.detail?.error && <Text color="red.400">{run.detail.error}</Text>}
      {problems.map((p, i) => (
        <Text key={i} color="red.400" noOfLines={2}>
          {p.channel}: {p.status}
        </Text>
      ))}
      {run.detail?.cards?.filter((c) => c.error).map((c, i) => (
        <Text key={`c${i}`} color="orange.400" noOfLines={2}>
          {c.title}: {c.error}
        </Text>
      ))}
    </Box>
  );
}

function PreviewModal({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  return (
    <Modal isOpen onClose={onClose} size="3xl" scrollBehavior="inside">
      {/* opened from the drawer: it must sit above it */}
      <ModalOverlay zIndex={1500} />
      <ModalContent containerProps={{ zIndex: 1500 }}>
        <ModalHeader fontSize="md">Preview of the email</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={4}>
          {preview.alert && (
            <Alert status={preview.alert.met ? 'warning' : 'info'} borderRadius="md" fontSize="sm" mb={3}>
              <ChakraAlertIcon />
              {preview.alert.met ? `Right now this alert would send: ${preview.alert.note}` : `Right now this alert would not send: ${preview.alert.note}`}
            </Alert>
          )}
          {/* sandboxed: the HTML is built by the server with every value escaped, and runs no scripts */}
          <Box as="iframe" title="Email preview" srcDoc={preview.html} sandbox="" w="100%" h="65vh" border="1px solid" borderColor="lineColor" borderRadius="md" bg="white" data-testid="email-preview" />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
