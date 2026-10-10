import { useCallback, useEffect, useState } from 'react';
import { Flex, Spinner } from '@chakra-ui/react';
import axios from 'axios';
import { http, setToken, UNAUTHORIZED_EVENT } from './api';
import type { User } from './api';
import { queryClient } from './lib/queryClient';
import Login from './Login';
import { AppRoutes } from './routes';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState('');

  // On start: is there a valid session? (Also works when the server has auth disabled.)
  useEffect(() => {
    http
      .get<User>('/api/auth/me')
      .then((res) => setUser(res.data))
      .catch((err: unknown) => {
        setUser(null);
        if (!(axios.isAxiosError(err) && err.response)) {
          setNotice('The server is not reachable. Make sure the backend is running.');
        }
      })
      .finally(() => setChecking(false));
  }, []);

  // Any 401 from the API (expired session, password changed, user disabled)
  useEffect(() => {
    const handler = () => {
      queryClient.clear(); // never show one user's data to the next
      setUser(null);
      setNotice('Your session has expired. Please sign in again.');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const logout = useCallback(async () => {
    try {
      await http.post('/api/auth/logout');
    } catch {
      // the local session is cleared anyway
    }
    setToken(null);
    queryClient.clear();
    setUser(null);
    setNotice('');
  }, []);

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  if (checking) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Spinner color="brand.300" size="xl" />
      </Flex>
    );
  }

  if (!user) {
    return <Login onLoggedIn={setUser} notice={notice} />;
  }

  return (
    <WorkspaceProvider user={user} onLogout={handleLogout}>
      <AppRoutes />
    </WorkspaceProvider>
  );
}

export default App;
