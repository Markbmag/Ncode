import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, Checkbox, HStack, Input, Progress,
  Select, SimpleGrid, Table, Tbody, Td, Text, Th, Thead, Tr, useToast, VStack, Wrap,
} from '@chakra-ui/react';
import { Player } from '@lottiefiles/react-lottie-player';
import animeAnimationUrl from './assets/Loading Animation Bored Hand.json?url';
import { http, WS_URL } from './api';
import type { Connection, MatchMode, Progress as ProgressState, SearchHit, TableError, TaskMessage } from './api';

const EMPTY_PROGRESS: ProgressState = { processed: 0, total: 0, found: 0, status: '' };
const FINAL_STATUSES = ['completed', 'cancelled', 'error'];

function App() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [db, setDb] = useState('');
  const [phrase, setPhrase] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('contains');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeNumbers, setIncludeNumbers] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [tableErrors, setTableErrors] = useState<TableError[]>([]);
  const [truncatedTables, setTruncatedTables] = useState<string[]>([]);
  const [resultsCapped, setResultsCapped] = useState(false);
  const [lastPhrase, setLastPhrase] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const toast = useToast();

  // Load the list of databases from the backend (configured in backend/.env)
  useEffect(() => {
    http
      .get<Connection[]>('/api/connections')
      .then((res) => {
        setConnections(res.data);
        setDb((current) => current || res.data[0]?.key || '');
      })
      .catch(() => {
        toast({ title: 'Не удалось загрузить список баз данных', status: 'error' });
      });
  }, [toast]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const resetResults = useCallback(() => {
    setResults([]);
    setTableErrors([]);
    setTruncatedTables([]);
    setResultsCapped(false);
    setSelectedIndex(null);
  }, []);

  const startSearch = useCallback(async () => {
    const trimmed = phrase.trim();
    if (!trimmed) {
      toast({ title: 'Введите фразу для поиска', status: 'warning' });
      return;
    }
    if (!db) {
      toast({ title: 'Нет доступных баз данных', status: 'warning' });
      return;
    }
    wsRef.current?.close();
    setIsSearching(true);
    resetResults();
    setLastPhrase(trimmed);
    setProgress({ ...EMPTY_PROGRESS, status: 'starting' });

    try {
      const res = await http.post<{ task_id: string }>('/api/search', {
        connection: db,
        phrase: trimmed,
        match_mode: matchMode,
        case_sensitive: caseSensitive,
        include_numeric: includeNumbers,
        include_dates: includeNumbers,
      });
      const taskId = res.data.task_id;
      taskIdRef.current = taskId;

      let finished = false;
      const ws = new WebSocket(`${WS_URL}/ws/${taskId}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data: TaskMessage = JSON.parse(event.data);
        if (data.status === 'unknown') {
          finished = true;
          toast({ title: 'Задача не найдена или устарела', status: 'error' });
          setIsSearching(false);
          ws.close();
          return;
        }
        if (FINAL_STATUSES.includes(data.status)) {
          finished = true;
          const hits = data.results ?? [];
          setResults(hits);
          setSelectedIndex(hits.length > 0 ? 0 : null);
          setTableErrors(data.errors ?? []);
          setTruncatedTables(data.truncated_tables ?? []);
          setResultsCapped(Boolean(data.results_capped));
          setProgress((prev) => ({ ...prev, status: data.status, found: data.found ?? prev.found }));
          setIsSearching(false);
          if (data.status === 'error') {
            toast({ title: 'Ошибка поиска', description: data.message ?? undefined, status: 'error' });
          }
          ws.close();
        } else {
          setProgress({
            processed: data.processed ?? 0,
            total: data.total ?? 0,
            found: data.found ?? 0,
            status: data.status,
          });
        }
      };

      ws.onerror = () => {
        toast({ title: 'Ошибка соединения', status: 'error' });
        setIsSearching(false);
      };

      ws.onclose = () => {
        if (!finished) {
          setIsSearching(false);
        }
      };
    } catch (error) {
      console.error('Search start error:', error);
      toast({ title: 'Ошибка запуска поиска', status: 'error' });
      setIsSearching(false);
    }
  }, [phrase, db, matchMode, caseSensitive, includeNumbers, resetResults, toast]);

  const cancelSearch = async () => {
    if (!taskIdRef.current) return;
    try {
      await http.delete(`/api/search/${taskIdRef.current}`);
    } catch (error) {
      console.error('Cancel error:', error);
    }
  };

  const clearAll = () => {
    setPhrase('');
    resetResults();
    setLastPhrase('');
    setProgress(EMPTY_PROGRESS);
    setIsSearching(false);
  };

  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const selectedResult = selectedIndex !== null ? results[selectedIndex] : null;
  const hasSearched = progress.status !== '';

  return (
    <Box minH="100vh" bg="#0f172a" color="white" p={8}>
      <VStack spacing={8} align="stretch" maxW="1200px" margin="0 auto">
        <Text fontSize="3xl" fontWeight="bold" textAlign="center" bgGradient="linear(to-r, cyan.400, blue.500)" bgClip="text">
          Поиск по базам данных
        </Text>

        <Box bg="gray.800" p={6} borderRadius="xl" boxShadow="xl">
          <HStack spacing={4} align="flex-start">
            <VStack flex="1" spacing={4} align="stretch">
              <Select
                value={db}
                onChange={(e) => setDb(e.target.value)}
                bg="gray.700"
                borderColor="gray.600"
                _hover={{ borderColor: 'cyan.400' }}
                color="white"
                isDisabled={connections.length === 0}
                placeholder={connections.length === 0 ? 'Нет настроенных баз данных' : undefined}
              >
                {connections.map((c) => (
                  <option key={c.key} value={c.key} style={{ backgroundColor: '#1A202C', color: 'white' }}>
                    {c.label} ({c.engine})
                  </option>
                ))}
              </Select>
              <Input
                placeholder="Введите фразу для поиска..."
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                bg="gray.700"
                borderColor="gray.600"
                _hover={{ borderColor: 'cyan.400' }}
                _focus={{ borderColor: 'cyan.400', boxShadow: '0 0 0 1px #00A3C4' }}
                color="white"
                onKeyDown={(e) => e.key === 'Enter' && !isSearching && startSearch()}
              />
              <HStack spacing={6} flexWrap="wrap">
                <Select
                  width="220px"
                  size="sm"
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                  bg="gray.700"
                  borderColor="gray.600"
                >
                  <option value="contains" style={{ backgroundColor: '#1A202C' }}>Содержит</option>
                  <option value="exact" style={{ backgroundColor: '#1A202C' }}>Точное совпадение</option>
                  <option value="starts_with" style={{ backgroundColor: '#1A202C' }}>Начинается с</option>
                </Select>
                <Checkbox isChecked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)}>
                  Учитывать регистр
                </Checkbox>
                <Checkbox isChecked={includeNumbers} onChange={(e) => setIncludeNumbers(e.target.checked)}>
                  Искать в числах и датах
                </Checkbox>
              </HStack>
            </VStack>
            <VStack spacing={4} width="180px">
              <Button colorScheme="blue" onClick={startSearch} isLoading={isSearching} loadingText="Ищем..." width="100%" isDisabled={!db}>
                Найти
              </Button>
              {isSearching ? (
                <Button colorScheme="red" variant="outline" onClick={cancelSearch} width="100%">
                  Отмена
                </Button>
              ) : (
                <Button colorScheme="gray" onClick={clearAll} width="100%">
                  Очистить
                </Button>
              )}
            </VStack>
          </HStack>
        </Box>

        {isSearching && (
          <Box textAlign="center" py={10}>
            <Box
              width="300px"
              height="300px"
              margin="0 auto"
              boxShadow="0 0 40px rgba(0, 163, 196, 0.6)"
              borderRadius="full"
              overflow="hidden"
              filter="hue-rotate(240deg) saturate(0.8)"
            >
              <Player src={animeAnimationUrl} loop autoplay style={{ width: '100%', height: '100%' }} />
            </Box>
            <Text fontSize="lg" mt={4} color="cyan.300">
              {progress.status === 'starting' || progress.status === 'pending'
                ? 'Подготовка...'
                : `Обработано ${progress.processed} из ${progress.total} таблиц`}
            </Text>
            <Progress value={percent} size="lg" colorScheme="blue" borderRadius="full" mt={2} hasStripe isAnimated />
            <HStack justifyContent="center" mt={2} spacing={6}>
              <Badge colorScheme="blue" fontSize="md" px={3} py={1} borderRadius="full">
                Найдено: {progress.found}
              </Badge>
              <Badge colorScheme="cyan" fontSize="md" px={3} py={1} borderRadius="full">
                {percent}%
              </Badge>
            </HStack>
          </Box>
        )}

        {!isSearching && progress.status === 'cancelled' && (
          <Alert status="warning" borderRadius="lg" color="gray.800">
            <AlertIcon />
            <AlertDescription>Поиск отменён. Показаны результаты, найденные до отмены.</AlertDescription>
          </Alert>
        )}

        {!isSearching && tableErrors.length > 0 && (
          <Alert status="error" borderRadius="lg" alignItems="flex-start" color="gray.800">
            <AlertIcon />
            <AlertDescription>
              Не удалось обработать таблиц: {tableErrors.length}. Результаты могут быть неполными.
              <Box fontSize="sm" mt={1}>
                {tableErrors.slice(0, 5).map((e) => (
                  <Text key={e.table}>
                    <b>{e.table}</b>: {e.error}
                  </Text>
                ))}
                {tableErrors.length > 5 && <Text>…и ещё {tableErrors.length - 5}</Text>}
              </Box>
            </AlertDescription>
          </Alert>
        )}

        {!isSearching && (truncatedTables.length > 0 || resultsCapped) && (
          <Alert status="info" borderRadius="lg" alignItems="flex-start" color="gray.800">
            <AlertIcon />
            <AlertDescription>
              {resultsCapped && 'Достигнут общий лимит результатов. '}
              {truncatedTables.length > 0 &&
                `В ${truncatedTables.length} таблицах найдено больше записей, чем показано: ${truncatedTables.slice(0, 8).join(', ')}${truncatedTables.length > 8 ? '…' : ''}. `}
              Уточните запрос или ограничьте список таблиц.
            </AlertDescription>
          </Alert>
        )}

        {!isSearching && results.length > 0 && (
          <Box>
            <Text fontSize="2xl" mb={4} color="cyan.300">
              Найдено записей: {results.length}
            </Text>

            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mb={6}>
              {results.map((res, idx) => (
                <Button
                  key={`${res.table}-${idx}`}
                  onClick={() => setSelectedIndex(idx)}
                  variant={selectedIndex === idx ? 'solid' : 'outline'}
                  colorScheme={selectedIndex === idx ? 'blue' : 'gray'}
                  bg={selectedIndex === idx ? 'blue.500' : 'gray.700'}
                  color="white"
                  _hover={{ bg: 'blue.400' }}
                  justifyContent="flex-start"
                  textAlign="left"
                  p={4}
                  height="auto"
                  whiteSpace="normal"
                  borderRadius="lg"
                  boxShadow="md"
                >
                  <Wrap spacing={2}>
                    <Badge colorScheme="blue" variant="solid">Таблица: {res.table}</Badge>
                    {res.id_column && (
                      <Badge colorScheme="orange" variant="solid">
                        {res.id_column}: {String(res.row[res.id_column])}
                      </Badge>
                    )}
                    <Text fontSize="sm" color="gray.200" fontWeight="normal">
                      Совпадений: {res.matched_columns.length}
                    </Text>
                  </Wrap>
                </Button>
              ))}
            </SimpleGrid>

            {selectedResult && (
              <Box bg="gray.800" p={6} borderRadius="xl" boxShadow="xl">
                <Text fontSize="lg" mb={4} color="cyan.300">
                  Детали записи (таблица `{selectedResult.table}`)
                </Text>
                <Table variant="simple" size="sm">
                  <Thead>
                    <Tr>
                      <Th color="gray.400" width="200px">Поле</Th>
                      <Th color="gray.400">Значение</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {Object.entries(selectedResult.row).map(([key, value]) => {
                      const strValue = value === null || value === undefined ? '' : String(value);
                      const isMatch = selectedResult.matched_columns.includes(key);
                      return (
                        <Tr key={key} bg={isMatch ? 'rgba(0,163,196,0.1)' : undefined}>
                          <Td color={isMatch ? 'cyan.300' : 'gray.300'} whiteSpace="nowrap">{key}</Td>
                          <Td color={isMatch ? 'cyan.200' : 'gray.200'} wordBreak="break-word">
                            {value === null ? <Text as="i" color="gray.500">NULL</Text> : strValue.length > 200 ? strValue.substring(0, 200) + '...' : strValue}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Box>
            )}
          </Box>
        )}

        {!isSearching && hasSearched && results.length === 0 && progress.status === 'completed' && (
          <Text textAlign="center" color="gray.400" mt={10}>
            По запросу «{lastPhrase}» ничего не найдено
          </Text>
        )}

        {!isSearching && !hasSearched && (
          <Text textAlign="center" color="gray.500" mt={10}>
            Введите поисковый запрос, чтобы начать
          </Text>
        )}
      </VStack>
    </Box>
  );
}

export default App;
