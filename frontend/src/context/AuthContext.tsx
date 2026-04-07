import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  token: string | null;
  login: (email: string, name: string, picture?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to restore session from sessionStorage (more secure than localStorage)
    const savedToken = sessionStorage.getItem('authToken');
    if (savedToken) {
      setToken(savedToken);
      // Set the default authorization header
      axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`;
      // TODO: Validate token is still valid by calling /api/auth/me
    }
    setLoading(false);
  }, []);

  const login = async (email: string, name: string, picture?: string) => {
    try {
      const response = await axios.post('/api/auth/login', { email, name, picture });
      const { user: userData, token: authToken } = response.data.data;
      
      setUser(userData);
      setToken(authToken);
      
      // Store token in sessionStorage (cleared on browser close)
      sessionStorage.setItem('authToken', authToken);
      
      // Set default authorization header for future requests
      axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    sessionStorage.removeItem('authToken');
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <AuthContext.Provider value={{ user, loading, token, login, logout }}>
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