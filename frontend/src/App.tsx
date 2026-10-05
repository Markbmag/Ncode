import { useState, useEffect, useRef } from 'react';
import {
  Box, Button, Select, Input, VStack, HStack, Text, Progress, Badge,
  Table, Thead, Tbody, Tr, Th, Td, useToast, SimpleGrid
} from '@chakra-ui/react';
import { Player } from '@lottiefiles/react-lottie-player';
import axios from 'axios';
import animeAnimationUrl from './assets/Loading Animation Bored Hand.json?url';

const databases = [
  { key: 'mes', label: 'MES' },
  { key: 'les', label: 'LES' },
  { key: 'iot', label: 'IOT' },
];

function App() {
  const [db, setDb] = useState('mes');
  const [phrase, setPhrase] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0, found: 0, status: '' });
  const [results, setResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const toast = useToast();

  const startSearch = async () => {
    if (!phrase.trim()) {
      toast({ title: 'Введите фразу для поиска', status: 'warning' });
      return;
    }
    setIsSearching(true);
    setResults([]);
    setSelectedIndex(null);
    setProgress({ processed: 0, total: 0, found: 0, status: 'starting' });

    try {
      const res = await axios.post('http://localhost:8000/api/search', {
        db,
        phrase: phrase.trim()
      });
      const taskId = res.data.task_id;

      const ws = new WebSocket(`ws://localhost:8000/ws/${taskId}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status === 'completed' && data.results) {
          setResults(data.results);
          setSelectedIndex(0); // выбираем первую запись по умолчанию
          setProgress(prev => ({ ...prev, status: 'completed' }));
          setIsSearching(false);
          ws.close();
        } else {
          setProgress({
            processed: data.processed,
            total: data.total,
            found: data.found,
            status: data.status,
          });
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        toast({ title: 'Ошибка соединения', status: 'error' });
        setIsSearching(false);
      };
    } catch (error) {
      console.error('Search start error:', error);
      toast({ title: 'Ошибка запуска поиска', status: 'error' });
      setIsSearching(false);
    }
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  const selectedResult = selectedIndex !== null ? results[selectedIndex] : null;

  return (
    <Box minH="100vh" bg="#0f172a" color="white" p={8}>
      <VStack spacing={8} align="stretch" maxW="1200px" margin="0 auto">
        <Text fontSize="3xl" fontWeight="bold" textAlign="center" bgGradient="linear(to-r, cyan.400, blue.500)" bgClip="text">
          Поиск по базам данных
        </Text>

        {/* Форма по два столбца */}
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
              >
                {databases.map((d) => (
                  <option key={d.key} value={d.key} style={{ backgroundColor: '#1A202C', color: 'white' }}>
                    {d.label}
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
                onKeyPress={(e) => e.key === 'Enter' && startSearch()}
              />
            </VStack>
            <VStack spacing={4} width="180px">
              <Button
                colorScheme="blue"
                onClick={startSearch}
                isLoading={isSearching}
                loadingText="Ищем..."
                width="100%"
              >
                Найти
              </Button>
              <Button
                colorScheme="gray"
                onClick={() => {
                  setPhrase('');
                  setResults([]);
                  setSelectedIndex(null);
                  setProgress({ processed: 0, total: 0, found: 0, status: '' });
                  setIsSearching(false);
                }}
                width="100%"
                isDisabled={isSearching}
              >
                Очистить
              </Button>
            </VStack>
          </HStack>
        </Box>

        {/* Анимация загрузки */}
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
              <Player
                src={animeAnimationUrl}
                loop
                autoplay
                style={{ width: '100%', height: '100%' }}
              />
            </Box>
            <Text fontSize="lg" mt={4} color="cyan.300">
              {progress.status === 'starting' ? 'Подготовка...' : `Обработано ${progress.processed} из ${progress.total} таблиц`}
            </Text>
            <Progress
              value={percent}
              size="lg"
              colorScheme="blue"
              borderRadius="full"
              mt={2}
              hasStripe
              isAnimated
            />
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

        {/* Результаты: кнопки в 2 колонки + таблица ниже */}
        {!isSearching && results.length > 0 && (
          <Box>
            <Text fontSize="2xl" mb={4} color="cyan.300">
              Найдено записей: {results.length}
            </Text>

            {/* Сетка кнопок-результатов (2 колонки) */}
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mb={6}>
              {results.map((res, idx) => (
                <Button
                  key={idx}
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
                  <HStack spacing={2} flexWrap="wrap">
                    <Badge colorScheme="blue" variant="solid">Таблица: {res.table}</Badge>
                    {res.vin_col && res.row[res.vin_col] && (
                      <Badge colorScheme="orange" variant="solid">VIN: {res.row[res.vin_col]}</Badge>
                    )}
                    <Text fontSize="sm" color="gray.200" fontWeight="normal">
                      Совпадений: {Object.keys(res.row).filter(k => String(res.row[k]).includes(phrase)).length}
                    </Text>
                  </HStack>
                </Button>
              ))}
            </SimpleGrid>

            {/* Таблица выбранной записи */}
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
                      const strValue = String(value);
                      const isMatch = strValue.toLowerCase().includes(phrase.toLowerCase());
                      return (
                        <Tr key={key} bg={isMatch ? 'rgba(0,163,196,0.1)' : undefined}>
                          <Td color={isMatch ? 'cyan.300' : 'gray.300'} whiteSpace="nowrap">{key}</Td>
                          <Td color={isMatch ? 'cyan.200' : 'gray.200'} wordBreak="break-word">
                            {strValue.length > 200 ? strValue.substring(0, 200) + '...' : strValue}
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

        {!isSearching && results.length === 0 && !phrase && (
          <Text textAlign="center" color="gray.500" mt={10}>
            Введите поисковый запрос, чтобы начать
          </Text>
        )}
      </VStack>
    </Box>
  );
}

export default App;