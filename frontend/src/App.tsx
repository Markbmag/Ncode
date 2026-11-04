import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Flex, Spinner } from '@chakra-ui/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import { getToken, http, setToken, UNAUTHORIZED_EVENT } from './api';
import type { User } from './api';
import { queryClient } from './lib/queryClient';
import Login from './Login';
import { AppRoutes } from './routes';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';
import { t } from './i18n/index.ts';

// Public links and embeds (M8) open without signing in.
const PublicPage = lazy(() => import('./public/PublicPage'));
const SHARED = /^\/(public|embed)\//;

function SharedApp() {
  return (
    <Suspense fallback={<Flex minH="100vh" align="center" justify="center"><Spinner color="brand.300" size="xl" /></Flex>}>
      <Routes>
        <Route path="/public/:token" element={<PublicPage mode="public" />} />
        <Route path="/embed/:token" element={<PublicPage mode="embed" />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  const shared = SHARED.test(useLocation().pathname);
  return shared ? <SharedApp /> : <SignedInApp />;
}

// Who was signed in last (K2): a phone that opens Ncode without a connection stays signed in and
// says it is offline, instead of showing the sign-in page. Forgotten on sign-out and expiry.
const LAST_USER_KEY = 'ncode_last_user';

function rememberUser(user: User | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // private mode: nothing remembered
  }
}

function rememberedUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function SignedInApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState('');

  // On start: is there a valid session? (Also works when the server has auth disabled.)
  useEffect(() => {
    http
      .get<User>('/api/auth/me')
      .then((res) => {
        rememberUser(res.data);
        setUser(res.data);
      })
      .catch((err: unknown) => {
        const unreachable = !(axios.isAxiosError(err) && err.response);
        const last = unreachable && getToken() ? rememberedUser() : null;
        setUser(last); // no connection, but signed in before on this device: open the app, it says it is offline
        if (unreachable && !last) setNotice(t('The server is not reachable. Make sure the backend is running.'));
      })
      .finally(() => setChecking(false));
  }, []);

  // Any 401 from the API (expired session, password changed, user disabled)
  useEffect(() => {
    const handler = () => {
      queryClient.clear(); // never show one user's data to the next
      rememberUser(null);
      setUser(null);
      setNotice(t('Your session has expired. Please sign in again.'));
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
    rememberUser(null);
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
    return (
      <Login
        onLoggedIn={(u) => {
          rememberUser(u);
          setUser(u);
        }}
        notice={notice}
      />
    );
  }

  return (
    <WorkspaceProvider user={user} onLogout={handleLogout}>
      <AppRoutes />
    </WorkspaceProvider>
  );
}

export default App;
