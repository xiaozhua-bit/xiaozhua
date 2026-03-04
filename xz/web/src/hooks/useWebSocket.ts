import { useEffect, useRef, useState, useCallback } from 'react';
import type { ServerMessage, WebSocketMessage, HeartbeatStatus } from '../types';

interface UseWebSocketOptions {
  onMessage: (message: ServerMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  send: (message: WebSocketMessage) => boolean;
  reconnectAttempts: number;
  heartbeatStatus: HeartbeatStatus | null;
}

export function useWebSocket({ onMessage, onConnect, onDisconnect }: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatStatus | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);

    ws.onopen = () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerMessage;
        
        // Track heartbeat status
        if (data.type === 'heartbeat') {
          setHeartbeatStatus(data.data as HeartbeatStatus);
        }
        
        onMessage(data);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      onDisconnect?.();

      if (reconnectAttempts < 10) {
        const delay = Math.min(1000 * (reconnectAttempts + 1), 5000);
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts(prev => prev + 1);
          connect();
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    wsRef.current = ws;
  }, [onMessage, onConnect, onDisconnect, reconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
  }, []);

  const send = useCallback((message: WebSocketMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { isConnected, send, reconnectAttempts, heartbeatStatus };
}
