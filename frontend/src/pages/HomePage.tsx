import { useEffect } from 'react';
import { Box, Button, Link, SimpleGrid, Skeleton, VStack } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { InlineHint } from '../components/InlineHint';
import { LoadError } from '../components/LoadError';
import { ActivityIcon, LayoutIcon } from '../icons';
import { useHome } from '../home/api';
import { rememberChecklist, setChecklistHidden } from '../home/checklist';
import { EverythingSection, FirstSteps, ItemList, Panel, StartHereSection } from '../home/HomeSections';
import { progress } from '../home/steps';
import { useWorkspace } from '../workspace/useWorkspace';
import { t, tn } from '../i18n/index.ts';

const DEMO_KEY = 'demo'; // the "Factory demo" database that ships with Ncode (app/demo.py)

/**
 * The home page per person (M11): first steps for newcomers, the admins' "Start here" collection,
 * what you opened last, your dashboards - then everything Ncode can do, in plain words.
 */
export default function HomePage() {
  const { user, isAdmin, connections, loaded, connectionsError, reloadConnections } = useWorkspace();
  const home = useHome();
  const data = home.data;
  useEffect(() => {
    if (data) rememberChecklist(data.checklist); // the other pages then tick steps without asking first
  }, [data]);
  const demo = connections.find((c) => c.key === DEMO_KEY)?.label ?? null;
  // the first steps link to a real dashboard when there is one: the official ones first
  const firstDashboard = data
    ? (data.start_here?.items.find((i) => i.type === 'dashboard') ?? data.dashboards[0] ?? data.recent.find((i) => i.type === 'dashboard') ?? null)
    : null;
  const steps = data ? progress(data.checklist) : null;
  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader
        title={t('Hello, {name}', { name: user.username })}
        subtitle={loaded && !connectionsError ? tn(connections.length, '{n} database available to you', '{n} databases available to you') : ' '}
      />
      {connectionsError !== null && <LoadError error={connectionsError} title={t('Could not load your databases')} onRetry={reloadConnections} />}
      {home.isError && <LoadError compact error={home.error} title={t('Could not load your home page')} onRetry={() => void home.refetch()} />}
      {home.isPending && <Skeleton h="180px" borderRadius="2xl" />}

      {data && (
        <>
          <FirstSteps state={data.checklist} dashboardTo={firstDashboard ? `/dashboards/${firstDashboard.id}` : null} demo={demo} />
          <StartHereSection startHere={data.start_here} isAdmin={isAdmin} />
          <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4} alignItems="start">
            <Panel title={t('Recently viewed')} testId="home-recent">
              <ItemList
                items={data.recent}
                empty={
                  <InlineHint icon={<ActivityIcon boxSize={4} />} example={t('a dashboard you check every morning')}>
                    {t('Questions and dashboards you open show up here, so you can get back to them in one click.')}
                  </InlineHint>
                }
              />
            </Panel>
            <Panel
              title={t('Your dashboards')}
              subtitle={t('Starred first, then the ones you opened or made.')}
              actions={
                <Link as={RouterLink} to="/dashboards" fontSize="xs">
                  {t('All dashboards')}
                </Link>
              }
              testId="home-dashboards"
            >
              <ItemList
                items={data.dashboards}
                empty={
                  <InlineHint
                    icon={<LayoutIcon boxSize={4} />}
                    example={t('“Line output this week”, with a date filter on top')}
                    action={
                      <Button as={RouterLink} to="/dashboards" size="sm" variant="subtle">
                        {t('Open dashboards')}
                      </Button>
                    }
                  >
                    {t('Star a dashboard you use, or make your own from saved questions: it then shows up here.')}
                  </InlineHint>
                }
              />
            </Panel>
          </SimpleGrid>
        </>
      )}

      <EverythingSection
        isAdmin={isAdmin}
        footer={
          data && data.checklist.hidden && steps?.next ? (
            <Box mt={3}>
              <Button size="xs" variant="ghost" onClick={() => void setChecklistHidden(false).catch(() => undefined)} data-testid="first-steps-show">
                {t('Show the first steps again')}
              </Button>
            </Box>
          ) : undefined
        }
      />
    </VStack>
  );
}
