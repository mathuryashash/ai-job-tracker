import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface User {
  id: string;
  email?: string;
  name?: string;
  picture?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, name: string) => Promise<void>;
  logout: () => void;
  loginWithRedirect: () => Promise<void>;
  getAccessToken: () => Promise<string | undefined>;
}

const TOKEN_KEY = 'authToken';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    if (!savedToken) {
      setLoading(false);
      return;
    }

    axios
      .get('/api/auth/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
      .then((res) => {
        if (res.data?.success) {
          setUser(res.data.data);
          setToken(savedToken);
          axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
        } else {
          sessionStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => {
        sessionStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error.response?.status === 401 && token) {
          sessionStorage.removeItem(TOKEN_KEY);
          setUser(null);
          setToken(null);
          delete axios.defaults.headers.common['Authorization'];
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptorId);
  }, [token]);

  const login = async (email: string, name: string) => {
    const res = await axios.post('/api/auth/dev-login', { email, name });
    const { user: loggedInUser, token: newToken } = res.data.data;
    sessionStorage.setItem(TOKEN_KEY, newToken);
    setUser(loggedInUser);
    setToken(newToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
  };

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setToken(null);
    delete axios.defaults.headers.common['Authorization'];
  };

  const loginWithRedirect = async () => {};

  const getAccessToken = async () => token || undefined;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        login,
        logout,
        loginWithRedirect,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
