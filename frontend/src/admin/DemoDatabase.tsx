import { useState } from 'react';
import { Flex, Skeleton, Switch, Text, useToast } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, http } from '../api';
import { t } from '../i18n/index.ts';
import { queryClient, queryKeys } from '../lib/queryClient';
import { Panel } from './Panel';

/** GET /api/admin/demo (backend app/demo.py). */
interface DemoStatus {
  enabled: boolean;   // NCODE_DEMO on the server
  hidden: boolean;    // hidden for everyone by an admin
  available: boolean; // created and not replaced by a connection of the same key
  reason: 'conflict' | 'error' | null;
}

const KEY = ['admin', 'demo'] as const;

/** Admin → Databases: show or hide the "Factory demo" database for everyone (M11). */
export function DemoDatabasePanel() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const status = useQuery({ queryKey: KEY, queryFn: async () => (await http.get<DemoStatus>('/api/admin/demo')).data });
  const data = status.data;
  if (status.isError || (data && !data.enabled)) return null; // NCODE_DEMO=0: nothing to switch

  const toggle = async (shown: boolean) => {
    setSaving(true);
    try {
      queryClient.setQueryData(KEY, (await http.put<DemoStatus>('/api/admin/demo', { hidden: !shown })).data);
      await queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    } catch (e) {
      toast({ status: 'error', title: t('Could not change it'), description: apiErrorMessage(e, t('Please try again')) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={t('Demo database')}
      subtitle={t('“Factory demo” is a small car plant with a year of made-up data (work orders, downtime, scrap, vehicles with VINs) for trying things out. Everyone may use it; it does not touch your real databases.')}
    >
      {!data ? (
        <Skeleton h="32px" borderRadius="md" />
      ) : (
        <Flex align="center" gap={3} as="label">
          <Switch
            isChecked={!data.hidden && data.available}
            isDisabled={saving || data.reason !== null}
            onChange={(e) => void toggle(e.target.checked)}
            data-testid="demo-switch"
          />
          <Text fontSize="sm">
            {data.reason === 'conflict'
              ? t('Not available: another database uses the key “demo”.')
              : data.reason === 'error'
                ? t('Not available: it could not be created on the server (see the server log).')
                : data.hidden
                  ? t('Hidden for everyone')
                  : t('Shown to everyone')}
          </Text>
        </Flex>
      )}
    </Panel>
  );
}
