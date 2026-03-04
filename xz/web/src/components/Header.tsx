import { WifiOff } from 'lucide-react';
import { clsx } from 'clsx';

interface HeaderProps {
  isConnected: boolean;
  reconnectAttempts?: number;
}

export function Header({ isConnected, reconnectAttempts = 0 }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-bg-secondary border-b border-border">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center">
          <span className="text-lg">🐾</span>
        </div>
        <div>
          <h1 className="font-semibold text-text-primary">小爪</h1>
          <p className="text-xs text-text-secondary">AI Agent</p>
        </div>
      </div>

      {/* 只显示连接状态 */}
      <div className="flex items-center gap-2">
        {isConnected ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-green/10 border border-accent-green/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-green"></span>
            </span>
            <span className="text-xs text-accent-green font-medium">已连接</span>
          </div>
        ) : (
          <div className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full border",
            reconnectAttempts > 0 
              ? "bg-amber-500/10 border-amber-500/30" 
              : "bg-red-500/10 border-red-500/30"
          )}>
            <WifiOff size={12} className={reconnectAttempts > 0 ? "text-amber-500" : "text-red-500"} />
            <span className={clsx(
              "text-xs font-medium",
              reconnectAttempts > 0 ? "text-amber-500" : "text-red-500"
            )}>
              {reconnectAttempts > 0 ? `重连中 (${reconnectAttempts})` : '未连接'}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
