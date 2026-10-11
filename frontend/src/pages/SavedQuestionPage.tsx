import { useEffect, useRef } from 'react';
import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Code, Skeleton, Text, VStack } from '@chakra-ui/react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { useQuestion } from '../library/api';
import type { SavedQuestion } from '../library/api';
import { QuestionHeader } from '../library/QuestionHeader';
import { useWorkspace } from '../workspace/useWorkspace';
import { Builder } from './QuestionsPage';
import { SqlWorkbench } from './SqlPage';

/** /questions/:id - a saved question, opened in the builder or the SQL editor. */
export default function SavedQuestionPage() {
  const id = Number(useParams().id);
  const ws = useWorkspace();
  const question = useQuestion(id);
  const q = question.data;
  const { selectConnection, activeKey } = ws;
  const usable = !!q && ws.connections.some((c) => c.key === q.connection);

  // Opening a question also selects its database in the sidebar, once. The editors work on the
  // question's own database either way, so picking another one in the sidebar later is harmless.
  const synced = useRef<number | null>(null);
  useEffect(() => {
    if (!q || !usable || synced.current === q.id) return;
    synced.current = q.id;
    if (q.connection !== activeKey) selectConnection(q.connection);
  }, [q, usable, activeKey, selectConnection]);

  if (question.isPending || !ws.loaded) return <Skeleton h="400px" borderRadius="2xl" />;
  if (question.isError || !q)
    return (
      <Alert status="error" borderRadius="xl" flexDirection="column" alignItems="flex-start" gap={2}>
        <AlertTitle>This question could not be opened</AlertTitle>
        <AlertDescription fontSize="sm">{apiErrorMessage(question.error, 'It may have been deleted, or it was not shared with you.')}</AlertDescription>
        <Button as={RouterLink} to="/library" size="sm">
          Go to the library
        </Button>
      </Alert>
    );
  if (q.kind === 'federated') return <FederatedQuestion q={q} />;
  if (!usable) return <NoDatabase q={q} />;
  return q.kind === 'sql' ? (
    <SqlWorkbench key={q.id} connection={q.connection} initialSql={null} saved={q} />
  ) : (
    <Builder key={q.id} connection={q.connection} saved={q} />
  );
}

function NoDatabase({ q }: { q: SavedQuestion }) {
  return (
    <VStack align="stretch" spacing={4}>
      <QuestionHeader title={q.name} saved={q} dirty={false} payload={() => null} defaultName={q.name} />
      <Alert status="warning" borderRadius="xl">
        <AlertIcon />
        This question uses the database “{q.connection}”, which you do not have access to. Ask an admin for access to run it.
      </Alert>
    </VStack>
  );
}

function FederatedQuestion({ q }: { q: SavedQuestion }) {
  return (
    <VStack align="stretch" spacing={4}>
      <QuestionHeader title={q.name} saved={q} dirty={false} payload={() => null} defaultName={q.name} />
      <Alert status="info" borderRadius="xl" alignItems="flex-start">
        <AlertIcon />
        <Box>
          <AlertTitle>Multi-source question (imported from DataDesk)</AlertTitle>
          <AlertDescription fontSize="sm">
            It combines several databases, which Ncode can run once the federated workspace arrives (roadmap M6). Its definition is kept as it was
            imported.
          </AlertDescription>
        </Box>
      </Alert>
      <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" p={4}>
        <Text fontSize="sm" fontWeight={600} mb={2}>
          Definition
        </Text>
        <Code display="block" whiteSpace="pre" overflowX="auto" fontSize="xs" p={3} borderRadius="md">
          {JSON.stringify(q.spec, null, 2)}
        </Code>
      </Box>
    </VStack>
  );
}
