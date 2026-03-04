import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// @ts-expect-error Session is used in type annotations
import type { Session, SessionListResponse, ChatMessage } from '../types';

// API Functions
async function fetchSessions(): Promise<SessionListResponse> {
  const response = await fetch('/api/sessions');
  if (!response.ok) throw new Error('Failed to fetch sessions');
  return response.json();
}

async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`);
  if (!response.ok) throw new Error('Failed to fetch messages');
  return response.json();
}

async function switchSession(sessionId: string): Promise<{ sessionId: string }> {
  const response = await fetch(`/api/sessions/${sessionId}/switch`, { 
    method: 'POST' 
  });
  if (!response.ok) throw new Error('Failed to switch session');
  return response.json();
}

async function createNewSession(): Promise<{ sessionId: string }> {
  const response = await fetch('/api/sessions/new', { method: 'POST' });
  if (!response.ok) throw new Error('Failed to create session');
  return response.json();
}

// Hooks
export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    staleTime: 30 * 1000,
  });
}

export function useSessionMessages(sessionId: string) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'messages'],
    queryFn: () => fetchSessionMessages(sessionId),
    enabled: !!sessionId,
    staleTime: 60 * 1000,
  });
}

export function useSwitchSession() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: switchSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createNewSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
