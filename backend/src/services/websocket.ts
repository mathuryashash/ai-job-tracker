import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';

interface Client {
  ws: WebSocket;
  userId: string;
}

const clients = new Map<string, Client[]>();

export interface WebSocketMessage {
  event: string;
  data: unknown;
}

export function initWebSocket(server: Server): WebSocketServer {
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as { userId: string; email?: string };
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