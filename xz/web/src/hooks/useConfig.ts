import { useQuery } from '@tanstack/react-query';
import type { Config } from '../types';

async function fetchConfig(): Promise<Config> {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error('Failed to fetch config');
  }
  return response.json();
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: fetchConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
