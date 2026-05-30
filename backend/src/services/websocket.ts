import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/env';

interface Client {
  ws: WebSocket;
  userId: string;
}

const clients = new Map<string, Client[]>();
let cleanupInterval: NodeJS.Timeout | null = null;

// Stale connection cleanup interval (every 30 seconds)
const CLEANUP_INTERVAL_MS = 30000;

export interface WebSocketMessage {
  event: string;
  data: unknown;
}

// Periodic cleanup of stale connections to prevent memory leaks
function startStaleConnectionCleanup(): void {
  if (cleanupInterval) {
    return; // Already running
  }

  cleanupInterval = setInterval(() => {
    let removedCount = 0;

    clients.forEach((clientsList, userId) => {
      const activeConnections: Client[] = [];
      
      for (const client of clientsList) {
        // Keep connection if OPEN or CLOSING (still cleanup pending)
        if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
          activeConnections.push(client);
        } else {
          removedCount++;
        }
      }

      if (activeConnections.length > 0) {
        clients.set(userId, activeConnections);
      } else {
        clients.delete(userId);
      }
    });

    if (removedCount > 0) {
      console.log(`[WebSocket] Cleaned up ${removedCount} stale connections`);
    }
  }, CLEANUP_INTERVAL_MS);

  console.log(`[WebSocket] Started stale connection cleanup (every ${CLEANUP_INTERVAL_MS / 1000}s)`);
}

function stopStaleConnectionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('[WebSocket] Stopped stale connection cleanup');
  }
}

export function initWebSocket(server: Server): WebSocketServer {
  // Start periodic cleanup of stale connections
  startStaleConnectionCleanup();

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Extract token from query string
    const url = new URL(req.url || 'http://localhost', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email?: string };
      const userId = decoded.userId;

      if (!userId) {
        ws.close(4001, 'Invalid token: missing userId');
        return;
      }

      // Add to clients
      const userClients = clients.get(userId) || [];
      userClients.push({ ws, userId });
      clients.set(userId, userClients);

      console.log(`WebSocket client connected: ${userId}. Total clients for user: ${userClients.length}`);

      ws.on('close', () => {
        const clientsList = clients.get(userId) || [];
        const filtered = clientsList.filter(c => c.ws !== ws);
        if (filtered.length > 0) {
          clients.set(userId, filtered);
        } else {
          clients.delete(userId);
        }
        console.log(`WebSocket client disconnected: ${userId}. Remaining clients: ${filtered.length}`);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for user ${userId}:`, error.message);
      });

      // Send welcome message
      ws.send(JSON.stringify({ event: 'connected', data: { userId, timestamp: new Date().toISOString() } }));

    } catch (error) {
      console.error('WebSocket authentication error:', error);
      ws.close(4001, 'Invalid token');
    }
  });

  console.log('WebSocket server initialized on /ws');

  return wss;
}

export function broadcastToUser(userId: string, event: string, data: unknown): void {
  const clientsList = clients.get(userId) || [];
  const message = JSON.stringify({ event, data });
  
  let sentCount = 0;
  clientsList.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
        sentCount++;
      } catch (error) {
        console.error(`Failed to send message to user ${userId}:`, error);
      }
    }
  });

  if (sentCount > 0) {
    console.log(`Broadcast "${event}" to user ${userId}: ${sentCount} clients`);
  }
}

/**
 * Alias for broadcastToUser with standardized automation event naming.
 * Used by automation.worker.ts to emit Socket.io-style events.
 * Events: automation:progress | automation:complete | automation:error
 */
export function emitToUser(userId: string, event: string, data: unknown): void {
  broadcastToUser(userId, event, data);
}

export function broadcastToAll(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data });
  
  let totalSent = 0;
  clients.forEach((clientsList) => {
    clientsList.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
          totalSent++;
        } catch (error) {
          console.error('Failed to broadcast message:', error);
        }
      }
    });
  });

  console.log(`Broadcast "${event}" to ${totalSent} clients`);
}

export function getConnectedClientCount(): number {
  let count = 0;
  clients.forEach((clientsList) => {
    count += clientsList.filter(c => c.ws.readyState === WebSocket.OPEN).length;
  });
  return count;
}

export function isUserConnected(userId: string): boolean {
  const clientsList = clients.get(userId) || [];
  return clientsList.some(c => c.ws.readyState === WebSocket.OPEN);
}

// Get connection statistics for debugging/monitoring
export function getConnectionStats(): { totalUsers: number; totalConnections: number; openConnections: number } {
  let totalConnections = 0;
  let openConnections = 0;

  clients.forEach((clientsList) => {
    totalConnections += clientsList.length;
    openConnections += clientsList.filter(c => c.ws.readyState === WebSocket.OPEN).length;
  });

  return {
    totalUsers: clients.size,
    totalConnections,
    openConnections,
  };
}

// Graceful shutdown - stop cleanup interval
export function shutdownWebSocket(): void {
  stopStaleConnectionCleanup();
  
  // Close all client connections
  clients.forEach((clientsList) => {
    clientsList.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, 'Server shutting down');
      }
    });
  });
  clients.clear();
  
  console.log('[WebSocket] Server shut down, all connections closed');
}