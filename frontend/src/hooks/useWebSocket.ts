import { useEffect, useState, useCallback, useRef } from 'react';

export interface WebSocketMessage {
  event: string;
  data: unknown;
}

export interface AutomationProgress {
  status: 'started' | 'processing' | 'matching' | 'completed' | 'error';
  completed: number;
  total: number;
  currentJob?: string;
  matchScore?: number;
  skipped?: boolean;
  applied?: boolean;
  error?: string;
  resultsCount?: number;
  errorsCount?: number;
  timestamp: string;
}

export interface ApplicationStatus {
  applicationId: string;
  jobTitle: string;
  company: string;
  status: string;
  matchScore: number;
  timestamp: string;
}

export interface NewJobAlert {
  jobId: string;
  title: string;
  company: string;
  url: string;
  matchScore: number;
  timestamp: string;
}

interface UseWebSocketOptions {
  token: string;
  wsUrl?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  sendMessage: (event: string, data: unknown) => void;
  subscribe: (event: string, callback: (data: unknown) => void) => () => void;
  automationProgress: AutomationProgress | null;
  applicationStatus: ApplicationStatus | null;
}

export function useWebSocket({
  token,
  wsUrl = 'ws://localhost:3001/ws',
  reconnectInterval = 3000,
  maxReconnectAttempts = 5,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const subscribersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Track current progress/state
  const [automationProgress, setAutomationProgress] = useState<AutomationProgress | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        setLastMessage(message);

        // Handle built-in events
        if (message.event === 'connected') {
          console.log('WebSocket authenticated:', message.data);
        } else if (message.event === 'automation:progress') {
          setAutomationProgress(message.data as AutomationProgress);
        } else if (message.event === 'application:status') {
          setApplicationStatus(message.data as ApplicationStatus);
        }

        // Notify subscribers
        const subscribers = subscribersRef.current.get(message.event);
        if (subscribers) {
          subscribers.forEach((callback) => callback(message.data));
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = (event) => {
      console.log(`WebSocket closed: ${event.code} ${event.reason}`);
      setIsConnected(false);
      wsRef.current = null;

      // Attempt reconnection
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        console.log(`Reconnecting... attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
        reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;
  }, [token, wsUrl, reconnectInterval, maxReconnectAttempts]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((event: string, data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
    } else {
      console.warn('WebSocket not connected, cannot send message');
    }
  }, []);

  const subscribe = useCallback((event: string, callback: (data: unknown) => void) => {
    const subscribers = subscribersRef.current.get(event) || new Set<(data: unknown) => void>();
    subscribers.add(callback);
    subscribersRef.current.set(event, subscribers);

    // Return unsubscribe function
    return () => {
      const subs = subscribersRef.current.get(event);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          subscribersRef.current.delete(event);
        }
      }
    };
  }, []);

  return {
    isConnected,
    lastMessage,
    sendMessage,
    subscribe,
    automationProgress,
    applicationStatus,
  };
}

// Hook for subscribing to automation progress
export function useAutomationProgress(token: string) {
  const { automationProgress, isConnected, subscribe } = useWebSocket({ token });
  
  useEffect(() => {
    const unsubscribe = subscribe('automation:progress', (data) => {
      console.log('Automation progress:', data);
    });
    return unsubscribe;
  }, [subscribe]);

  return { automationProgress, isConnected };
}

// Hook for subscribing to application status changes
export function useApplicationStatus(token: string) {
  const { applicationStatus, isConnected, subscribe } = useWebSocket({ token });
  
  useEffect(() => {
    const unsubscribe = subscribe('application:status', (data) => {
      console.log('Application status:', data);
    });
    return unsubscribe;
  }, [subscribe]);

  return { applicationStatus, isConnected };
}

// Hook for subscribing to new job alerts
export function useNewJobAlerts(token: string) {
  const [newJobs, setNewJobs] = useState<NewJobAlert[]>([]);
  const { isConnected, subscribe } = useWebSocket({ token });
  
  useEffect(() => {
    const unsubscribe = subscribe('job:new', (data) => {
      setNewJobs((prev) => [...prev, data as NewJobAlert]);
    });
    return unsubscribe;
  }, [subscribe]);

  return { newJobs, isConnected };
}