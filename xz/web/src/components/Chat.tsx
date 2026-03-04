import { useState, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { ChatInput } from './ChatInput';
import type { 
  ChatMessage, 
  ToolCallMessage, 
  ServerMessage
} from '../types';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from './ai-elements/conversation';
import {
  UserMessage,
  AssistantMessage,
  SystemMessage,
} from './ai-elements/message';

interface ChatProps {
  onSendMessage: (message: string) => void;
  onSendCommand: (command: string, args: string[]) => void;
}

export interface ChatRef {
  handleServerMessage: (message: ServerMessage) => void;
  clearMessages: () => void;
  loadMessages: (messages: (ChatMessage | ToolCallMessage)[]) => void;
}

// Tool call tracking for current streaming message
interface PendingToolCall {
  name: string;
  args: unknown;
  isExecuting: boolean;
}

export const Chat = forwardRef<ChatRef, ChatProps>(function Chat({ onSendMessage, onSendCommand }, ref) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolCallsMap, setToolCallsMap] = useState<Map<string, ToolCallMessage[]>>(new Map());
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([]);
  
  // Use refs to avoid dependency issues in callbacks
  const messagesRef = useRef(messages);
  const isStreamingRef = useRef(isStreaming);
  const pendingToolCallsRef = useRef(pendingToolCalls);
  
  // Keep refs in sync
  messagesRef.current = messages;
  isStreamingRef.current = isStreaming;
  pendingToolCallsRef.current = pendingToolCalls;
  
  const queryClient = useQueryClient();

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'message': {
        if (msg.role === 'assistant') {
          setIsStreaming(false);
          setStreamingContent('');
          setPendingToolCalls([]);
        }
        
        const newMessage = { ...msg, id: crypto.randomUUID() };
        setMessages(prev => [...prev, newMessage]);
        
        // Associate any pending tool calls with this message
        const currentPending = pendingToolCallsRef.current;
        if (currentPending.length > 0 && msg.role === 'assistant') {
          setToolCallsMap(prev => {
            const next = new Map(prev);
            next.set(newMessage.id, currentPending.map(tc => ({
              id: crypto.randomUUID(),
              type: 'tool_call' as const,
              name: tc.name,
              args: tc.args,
            })));
            return next;
          });
          setPendingToolCalls([]);
        }
        
        queryClient.invalidateQueries({ queryKey: ['session'] });
        break;
      }
      
      case 'tool_call': {
        const toolCall = { ...msg, id: crypto.randomUUID() };
        
        // If streaming, add to pending tool calls
        if (isStreamingRef.current) {
          setPendingToolCalls(prev => [...prev, {
            name: msg.name,
            args: msg.args,
            isExecuting: true,
          }]);
        } else {
          // Associate with last assistant message using ref
          setToolCallsMap(prev => {
            const next = new Map(prev);
            const currentMessages = messagesRef.current;
            const lastAssistantMsg = [...currentMessages].reverse().find(m => m.role === 'assistant');
            if (lastAssistantMsg) {
              const existing = next.get(lastAssistantMsg.id) || [];
              next.set(lastAssistantMsg.id, [...existing, toolCall]);
            }
            return next;
          });
        }
        break;
      }
      
      case 'stream_start': {
        setIsStreaming(true);
        setStreamingContent('');
        setPendingToolCalls([]);
        break;
      }
      
      case 'stream_delta': {
        setStreamingContent(prev => prev + msg.content);
        break;
      }
      
      case 'stream_end': {
        setIsStreaming(false);
        setStreamingContent('');
        setPendingToolCalls([]);
        break;
      }
      
      case 'error': {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          type: 'message',
          role: 'system',
          content: `Error: ${msg.content}`,
        }]);
        break;
      }
      
      case 'status': {
        break;
      }
    }
  }, [queryClient]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setToolCallsMap(new Map());
    setStreamingContent('');
    setIsStreaming(false);
    setPendingToolCalls([]);
  }, []);

  const loadMessages = useCallback((loadedMessages: (ChatMessage | ToolCallMessage)[]) => {
    const loadedToolCallsMap = new Map<string, ToolCallMessage[]>();
    let lastAssistantMsgId: string | null = null;
    
    // Process messages and associate tool_calls with their assistant messages
    const processedMessages = loadedMessages.map(msg => {
      if (msg.type === 'message') {
        const chatMsg = { ...msg, id: msg.id || crypto.randomUUID() };
        if (msg.role === 'assistant') {
          lastAssistantMsgId = chatMsg.id;
        }
        return chatMsg;
      }
      return null;
    }).filter((msg): msg is ChatMessage => msg !== null);
    
    // Process tool_call messages and associate with last assistant message
    for (const msg of loadedMessages) {
      if (msg.type === 'tool_call') {
        const toolCallMsg = { ...msg, id: msg.id || crypto.randomUUID() };
        // Find the most recent assistant message before this tool call
        const targetMsgId = lastAssistantMsgId;
        if (targetMsgId) {
          const existing = loadedToolCallsMap.get(targetMsgId) || [];
          loadedToolCallsMap.set(targetMsgId, [...existing, toolCallMsg]);
        }
      }
    }
    
    setMessages(processedMessages);
    setToolCallsMap(loadedToolCallsMap);
    setStreamingContent('');
    setIsStreaming(false);
    setPendingToolCalls([]);
  }, []);

  useImperativeHandle(ref, () => ({
    handleServerMessage,
    clearMessages,
    loadMessages,
  }), [handleServerMessage, clearMessages, loadMessages]);

  const handleSend = useCallback((content: string) => {
    if (content.startsWith('/')) {
      const parts = content.slice(1).split(' ');
      onSendCommand(parts[0], parts.slice(1));
    } else {
      onSendMessage(content);
    }
  }, [onSendMessage, onSendCommand]);

  const formatTime = (timestamp?: string | number) => {
    if (!timestamp) return undefined;
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Messages */}
      <Conversation className="flex-1 px-4 py-4">
        <ConversationContent className="max-w-3xl mx-auto">
          {messages.length === 0 && !isStreaming ? (
            <ConversationEmptyState
              icon={<MessageSquare className="w-8 h-8 text-accent-cyan" />}
              title="开始对话"
              description="在下方输入消息开始与 AI 助手聊天"
            />
          ) : (
            <div className="space-y-6">
              {messages.map((msg, index) => {
                const time = formatTime(msg.timestamp || (msg as unknown as { createdAt?: number }).createdAt);
                
                if (msg.role === 'user') {
                  return (
                    <UserMessage
                      key={msg.id || `msg-${index}`}
                      content={msg.content}
                      timestamp={time}
                    />
                  );
                }
                
                if (msg.role === 'assistant') {
                  const calls = toolCallsMap.get(msg.id)?.map(tc => ({
                    name: tc.name,
                    args: tc.args,
                    isExecuting: false,
                  }));
                  return (
                    <AssistantMessage
                      key={msg.id || `msg-${index}`}
                      content={msg.content}
                      timestamp={time}
                      toolCalls={calls}
                    />
                  );
                }
                
                return (
                  <SystemMessage
                    key={msg.id || `msg-${index}`}
                    content={msg.content}
                  />
                );
              })}
              
              {/* Streaming message */}
              {isStreaming && (
                <AssistantMessage
                  content={streamingContent}
                  isStreaming={true}
                  toolCalls={pendingToolCalls.length > 0 ? pendingToolCalls : undefined}
                />
              )}
            </div>
          )}
        </ConversationContent>
      </Conversation>

      {/* Input */}
      <div className="px-4 pb-4">
        <div className="max-w-3xl mx-auto">
          <ChatInput 
            onSend={handleSend}
            isLoading={isStreaming}
          />
        </div>
      </div>
    </div>
  );
});
