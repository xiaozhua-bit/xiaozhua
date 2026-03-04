import { useState, useCallback, useRef, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { Chat } from './components/Chat';
import type { ChatRef } from './components/Chat';
import { useWebSocket } from './hooks/useWebSocket';
import { useConfig } from './hooks/useConfig';
import { useSessions, useCreateSession, useSwitchSession, useSessionMessages } from './hooks/useSessions';
import type { ServerMessage, HeartbeatStatus, ChatMessage, ToolCallMessage } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function AppContent() {
  const [sessionId, setSessionId] = useState('');
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatStatus | null>(null);
  const chatRef = useRef<ChatRef | null>(null);
  
  const { data: config } = useConfig();
  const { data: sessionsData, isLoading: isLoadingSessions, refetch: refetchSessions } = useSessions();
  const createSession = useCreateSession();
  const switchSession = useSwitchSession();
  const { data: sessionMessages, refetch: refetchMessages } = useSessionMessages(sessionId);
  
  // Handle WebSocket messages
  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'status' && msg.data) {
      const newSessionId = msg.data.sessionId;
      if (newSessionId !== sessionId) {
        setSessionId(newSessionId);
      }
    }
    if (msg.type === 'heartbeat') {
      setHeartbeatStatus(msg.data);
    }
    // Forward all messages to Chat component
    chatRef.current?.handleServerMessage(msg);
  }, [sessionId]);
  
  const { isConnected, send, reconnectAttempts } = useWebSocket({
    onMessage: handleMessage,
  });

  const handleSendMessage = useCallback((content: string) => {
    send({ type: 'message', content });
  }, [send]);

  const handleSendCommand = useCallback((command: string, args: string[]) => {
    send({ type: 'command', command, args });
  }, [send]);

  // Load messages when session changes
  useEffect(() => {
    if (sessionId && sessionMessages) {
      // Convert API messages to ServerMessage format for Chat component
      // API returns mixed array of message and tool_call types
      const messages: (ChatMessage | ToolCallMessage)[] = sessionMessages.map((msg: ChatMessage | ToolCallMessage) => ({
        ...msg,
        id: msg.id || crypto.randomUUID(),
      }));
      chatRef.current?.loadMessages(messages);
    } else if (!sessionId) {
      chatRef.current?.clearMessages();
    }
  }, [sessionId, sessionMessages]);

  // Create new session and select it
  const handleCreateSession = useCallback(async () => {
    try {
      // Clear current messages first
      chatRef.current?.clearMessages();
      
      const result = await createSession.mutateAsync();
      // Update current session ID
      setSessionId(result.sessionId);
      
      // Refresh sessions list
      await refetchSessions();
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [createSession, refetchSessions]);

  // Switch to existing session
  const handleSelectSession = useCallback(async (id: string) => {
    if (id === sessionId) return; // Don't switch if already on this session
    
    try {
      // Clear current messages first
      chatRef.current?.clearMessages();
      
      const result = await switchSession.mutateAsync(id);
      // Update current session ID
      setSessionId(result.sessionId);
      
      // Refresh sessions list to update order
      await refetchSessions();
      
      // Load messages for the new session
      await refetchMessages();
    } catch (error) {
      console.error('Failed to switch session:', error);
    }
  }, [switchSession, refetchSessions, refetchMessages, sessionId]);

  return (
    <div className="flex h-screen bg-bg-primary">
      {/* Sidebar */}
      <Sidebar
        sessions={sessionsData?.sessions || []}
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        isLoading={isLoadingSessions || createSession.isPending || switchSession.isPending}
      />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header 
          isConnected={isConnected} 
          reconnectAttempts={reconnectAttempts}
        />
        
        <StatusBar 
          sessionId={sessionId || '...'}
          heartbeatEnabled={config?.heartbeat?.enabled}
          heartbeatStatus={heartbeatStatus}
          isConnected={isConnected}
          reconnectAttempts={reconnectAttempts}
        />
        
        <div className="flex-1 overflow-hidden">
          <Chat 
            ref={chatRef}
            onSendMessage={handleSendMessage}
            onSendCommand={handleSendCommand}
          />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
