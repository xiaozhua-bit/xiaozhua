/**
 * Web Server with WebSocket support
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type * as WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Agent, createAgent } from '../core/agent.js';
import { loadConfig } from '../config/index.js';
import { getSchedulerTicker } from '../scheduler/index.js';
import { getHeartbeatManager, startAutonomousHeartbeat } from '../core/heartbeat.js';
import { searchKnowledge } from '../knowledge/index.js';
import { searchHistory, listSessions, getRecentMessages } from '../history/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WebSocketMessage {
  type: 'message' | 'command' | 'ping';
  content?: string;
  command?: string;
  args?: string[];
}

interface ServerBroadcast {
  type: 'message' | 'tool_call' | 'status' | 'error' | 'stream_start' | 'stream_delta' | 'stream_end' | 'heartbeat';
  role?: 'user' | 'assistant' | 'system';
  content?: string;
  name?: string;
  args?: unknown;
  data?: unknown;
  timestamp?: string;
}

export class XZServer {
  private fastify = Fastify({ logger: false });
  private agent: Agent;
  private clients = new Set<WebSocket.WebSocket>();
  private config = loadConfig();
  private heartbeatStarted = false;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor() {
    this.agent = createAgent({
      onMessage: (msg) => this.broadcast({
        type: 'message',
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: new Date().toISOString(),
      }),
      onToolCall: (name, args) => this.broadcast({
        type: 'tool_call',
        name,
        args,
        timestamp: new Date().toISOString(),
      }),
      onAssistantStreamStart: () => this.broadcast({ type: 'stream_start' }),
      onAssistantStreamDelta: (delta) => this.broadcast({
        type: 'stream_delta',
        content: delta,
      }),
      onAssistantStreamEnd: () => this.broadcast({ type: 'stream_end' }),
    });

    this.setupServer();
    this.startHeartbeatBroadcaster();
  }

  private setupServer() {
    this.fastify.register(fastifyWebsocket);
    this.fastify.register(fastifyStatic, {
      root: join(__dirname, '../../web/dist'),
      prefix: '/',
    });

    this.setupAPIRoutes();

    this.fastify.register(async (fastify) => {
      fastify.get('/ws/chat', { websocket: true }, (connection) => {
        this.handleConnection(connection);
      });
    });

    // SPA fallback
    this.fastify.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      return reply.sendFile('index.html');
    });
  }

  private setupAPIRoutes() {
    // Get current session
    this.fastify.get('/api/session', async () => ({
      sessionId: this.agent.getSessionId(),
    }));

    // List all sessions
    this.fastify.get('/api/sessions', async () => {
      return listSessions({ limit: 50 });
    });

    // Get messages for a session
    this.fastify.get('/api/sessions/:id/messages', async (request) => {
      const { id } = request.params as { id: string };
      const messages = getRecentMessages(id, 100);
      // Convert to frontend format: flatten tool_calls into separate tool_call messages
      const result: unknown[] = [];
      for (const msg of messages) {
        // Add the main message
        result.push({
          id: msg.id,
          type: 'message',
          role: msg.role === 'tool' ? 'system' : msg.role,
          content: msg.content,
          timestamp: msg.createdAt,
        });
        // Add tool calls as separate messages
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            result.push({
              id: `${msg.id}_tc_${tc.id}`,
              type: 'tool_call',
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
              timestamp: msg.createdAt,
            });
          }
        }
      }
      return result;
    });

    // Switch to a different session
    this.fastify.post('/api/sessions/:id/switch', async (request) => {
      const { id } = request.params as { id: string };
      this.agent = createAgent({
        sessionId: id,
        onMessage: (msg) => this.broadcast({
          type: 'message',
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        }),
        onToolCall: (name, args) => this.broadcast({
          type: 'tool_call',
          name,
          args,
        }),
        onAssistantStreamStart: () => this.broadcast({ type: 'stream_start' }),
        onAssistantStreamDelta: (delta) => this.broadcast({ type: 'stream_delta', content: delta }),
        onAssistantStreamEnd: () => this.broadcast({ type: 'stream_end' }),
      });
      return { sessionId: this.agent.getSessionId() };
    });

    // Create new session
    this.fastify.post('/api/sessions/new', async () => {
      this.agent = createAgent({
        onMessage: (msg) => this.broadcast({
          type: 'message',
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        }),
        onToolCall: (name, args) => this.broadcast({
          type: 'tool_call',
          name,
          args,
        }),
        onAssistantStreamStart: () => this.broadcast({ type: 'stream_start' }),
        onAssistantStreamDelta: (delta) => this.broadcast({ type: 'stream_delta', content: delta }),
        onAssistantStreamEnd: () => this.broadcast({ type: 'stream_end' }),
      });
      return { sessionId: this.agent.getSessionId() };
    });

    // Search memory
    this.fastify.get('/api/memory', async (request) => {
      const { q, limit = '5' } = request.query as { q?: string; limit?: string };
      if (!q) return { error: 'Missing query param: q' };
      return searchKnowledge(q, { limit: parseInt(limit) });
    });

    // Search history
    this.fastify.get('/api/history', async (request) => {
      const { q, limit = '10' } = request.query as { q?: string; limit?: string };
      if (!q) return { error: 'Missing query param: q' };
      return searchHistory(q, { limit: parseInt(limit) });
    });

    // Get heartbeat status
    this.fastify.get('/api/heartbeat', async () => {
      const hb = getHeartbeatManager();
      return hb.getStatus();
    });

    // Control heartbeat
    this.fastify.post('/api/heartbeat/:action', async (request) => {
      const { action } = request.params as { action: string };
      
      if (action === 'start') {
        startAutonomousHeartbeat({
          onActivity: (msg) => this.broadcast({
            type: 'message',
            role: 'system',
            content: msg,
          }),
        });
        this.heartbeatStarted = true;
        return { status: 'started' };
      } else if (action === 'stop') {
        const { stopHeartbeat } = await import('../core/heartbeat.js');
        stopHeartbeat();
        this.heartbeatStarted = false;
        return { status: 'stopped' };
      }
      
      return { error: 'Invalid action' };
    });

    // Get config
    this.fastify.get('/api/config', async () => ({
      model: this.config.model,
      heartbeat: {
        enabled: this.config.heartbeat.enabled,
        intervalMs: this.config.heartbeat.intervalMs,
      },
    }));
  }

  // Broadcast heartbeat status periodically
  private startHeartbeatBroadcaster() {
    if (!this.config.heartbeat.enabled) return;
    
    this.heartbeatInterval = setInterval(() => {
      const hb = getHeartbeatManager();
      const status = hb.getStatus();
      this.broadcast({
        type: 'heartbeat',
        data: status,
      });
    }, 1000); // Every second
  }

  private handleConnection(socket: WebSocket.WebSocket) {
    this.clients.add(socket);
    
    // Send initial session info
    this.sendTo(socket, {
      type: 'status',
      data: {
        sessionId: this.agent.getSessionId(),
      },
    });

    // Send current heartbeat status
    const hb = getHeartbeatManager();
    this.sendTo(socket, {
      type: 'heartbeat',
      data: hb.getStatus(),
    });

    socket.on('message', (rawData: Buffer) => {
      try {
        const msg: WebSocketMessage = JSON.parse(rawData.toString());
        this.handleMessage(socket, msg).catch((err) => {
          console.error('Error handling message:', err);
          this.sendTo(socket, {
            type: 'error',
            content: 'Failed to process message',
          });
        });
      } catch (err) {
        this.sendTo(socket, {
          type: 'error',
          content: 'Invalid JSON',
        });
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
    });
  }

  private async handleMessage(_socket: WebSocket.WebSocket, msg: WebSocketMessage) {
    if (msg.type === 'ping') {
      this.broadcast({ type: 'message', role: 'system', content: 'pong' });
      return;
    }

    if (msg.type === 'command') {
      await this.handleCommand(msg.command || '', msg.args || []);
      return;
    }

    if (msg.type === 'message' && msg.content) {
      getHeartbeatManager().recordUserActivity();
      
      try {
        await this.agent.sendMessage(msg.content);
      } catch (error) {
        this.broadcast({
          type: 'error',
          content: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async handleCommand(cmd: string, args: string[]) {
    switch (cmd) {
      case 'new': {
        this.agent = createAgent({
          onMessage: (msg) => this.broadcast({
            type: 'message',
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content,
          }),
          onToolCall: (name, args) => this.broadcast({
            type: 'tool_call',
            name,
            args,
          }),
          onAssistantStreamStart: () => this.broadcast({ type: 'stream_start' }),
          onAssistantStreamDelta: (delta) => this.broadcast({ type: 'stream_delta', content: delta }),
          onAssistantStreamEnd: () => this.broadcast({ type: 'stream_end' }),
        });
        this.broadcast({
          type: 'message',
          role: 'system',
          content: `New session: ${this.agent.getSessionId().slice(0, 16)}...`,
        });
        break;
      }

      case 'memory': {
        const query = args.join(' ');
        if (!query) {
          this.broadcast({ type: 'message', role: 'system', content: 'Usage: /memory <query>' });
          break;
        }
        const results = searchKnowledge(query, { limit: 5 });
        this.broadcast({
          type: 'message',
          role: 'system',
          content: `Found ${results.total} memory results`,
        });
        break;
      }

      case 'history': {
        const hQuery = args.join(' ');
        if (!hQuery) {
          this.broadcast({ type: 'message', role: 'system', content: 'Usage: /history <query>' });
          break;
        }
        const results = searchHistory(hQuery, { limit: 5 });
        this.broadcast({
          type: 'message',
          role: 'system',
          content: `Found ${results.total} history results`,
        });
        break;
      }

      default:
        this.broadcast({ type: 'message', role: 'system', content: `Unknown command: /${cmd}` });
    }
  }

  private broadcast(data: ServerBroadcast) {
    const message = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  private sendTo(connection: WebSocket.WebSocket, data: ServerBroadcast) {
    if (connection.readyState === 1) {
      connection.send(JSON.stringify(data));
    }
  }

  async start(port = 3000) {
    this.setupScheduler();
    
    if (this.config.heartbeat.enabled) {
      startAutonomousHeartbeat({
        onActivity: (msg) => this.broadcast({
          type: 'message',
          role: 'system',
          content: msg,
        }),
      });
      this.heartbeatStarted = true;
    }

    await this.fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 XZ Server running at http://localhost:${port}`);
  }

  private setupScheduler() {
    if (!this.config.scheduler.enabled) return;

    const ticker = getSchedulerTicker({
      onTaskDue: (task) => {
        this.broadcast({
          type: 'message',
          role: 'system',
          content: `⏰ Task: ${task.description}`,
        });
        return this.agent.handleWakeup(task.description);
      },
    });

    ticker.start();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new XZServer();
  server.start().catch(console.error);
}
