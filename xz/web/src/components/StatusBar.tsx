import { clsx } from 'clsx';
import { Terminal } from 'lucide-react';
import type { HeartbeatStatus } from '../types';

interface StatusBarProps {
  sessionId: string;
  heartbeatEnabled?: boolean;
  heartbeatStatus?: HeartbeatStatus | null;
  isConnected: boolean;
  reconnectAttempts?: number;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function StatusBar({ 
  sessionId,
  heartbeatEnabled = false,
  heartbeatStatus,
  isConnected,
  reconnectAttempts = 0
}: StatusBarProps) {
  const nextRunInMs = heartbeatStatus?.nextRunInMs ?? 0;
  const state = heartbeatStatus?.state ?? 'idle';
  
  // 简化显示：只显示会话ID和心跳状态（如果有）
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary/30 border-b border-border text-xs">
      <div className="flex items-center gap-3">
        {/* Session ID */}
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Terminal size={12} />
          <span className="font-mono opacity-70">{sessionId.slice(0, 20)}...</span>
        </div>

        {/* Heartbeat Status - 只在启用时显示 */}
        {heartbeatEnabled && (
          <>
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5">
              <span className={clsx(
                'w-1.5 h-1.5 rounded-full',
                state === 'executing' && 'bg-amber-500 animate-pulse',
                state === 'waiting' && 'bg-cyan-400',
                state === 'idle' && 'bg-text-secondary'
              )} />
              <span className="text-text-secondary">
                {state === 'executing' && '执行中'}
                {state === 'waiting' && `${formatCountdown(nextRunInMs)}`}
                {state === 'idle' && '空闲'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* 右侧：连接状态 */}
      <div className="flex items-center gap-1.5">
        <span className={clsx(
          'w-1.5 h-1.5 rounded-full',
          isConnected ? 'bg-emerald-400' : reconnectAttempts > 0 ? 'bg-amber-500' : 'bg-red-500'
        )} />
        <span className={clsx(
          'text-text-secondary',
          isConnected ? 'text-emerald-400' : reconnectAttempts > 0 ? 'text-amber-500' : 'text-red-500'
        )}>
          {isConnected ? '在线' : reconnectAttempts > 0 ? `重连(${reconnectAttempts})` : '离线'}
        </span>
      </div>
    </div>
  );
}
