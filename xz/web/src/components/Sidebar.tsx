
import { clsx } from 'clsx';
import { Plus, MessageSquare, Clock } from 'lucide-react';
import type { Session } from '../types';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  isLoading?: boolean;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return date.toLocaleDateString('zh-CN', { weekday: 'short' });
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function Sidebar({ 
  sessions, 
  currentSessionId, 
  onSelectSession, 
  onCreateSession,
  isLoading 
}: SidebarProps) {
  return (
    <div className="flex flex-col w-64 bg-bg-secondary border-r border-border">
      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onCreateSession}
          disabled={isLoading}
          className={clsx(
            'flex items-center gap-2 w-full px-3 py-2.5 rounded-xl',
            'bg-accent-green/10 border border-accent-green/30',
            'text-accent-green hover:bg-accent-green/20',
            'transition-colors disabled:opacity-50'
          )}
        >
          <Plus size={18} />
          <span className="font-medium">新对话</span>
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        <div className="px-3 py-2 text-xs font-medium text-text-secondary uppercase tracking-wider">
          历史会话
        </div>
        
        {sessions.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-text-secondary">暂无历史会话</p>
          </div>
        )}
        
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={clsx(
              'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left',
              'transition-all duration-200',
              session.id === currentSessionId
                ? 'bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan'
                : 'hover:bg-bg-tertiary text-text-primary border border-transparent'
            )}
          >
            <MessageSquare size={16} className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm font-medium">
                {session.title || `会话 ${session.id.slice(-8)}`}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-secondary mt-0.5">
                <Clock size={10} />
                {formatDate(session.updatedAt)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
