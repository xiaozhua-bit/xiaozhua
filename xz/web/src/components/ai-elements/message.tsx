import { clsx } from 'clsx';
import { Zap, User, Terminal, FileText, FileEdit, Search, Command, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Response } from './response';

// 格式化 tool call 参数，截断长内容
function formatArgs(args: unknown): { summary: string; detail?: string; type: string } {
  if (args === null || args === undefined) return { summary: '', type: 'other' };
  
  const argsObj = args as Record<string, unknown>;
  
  // 检测类型
  let type = 'other';
  if (argsObj.file_path || argsObj.path) type = 'read_file';
  else if (argsObj.command) type = 'execute';
  else if (argsObj.query || argsObj.search) type = 'search';
  else if (argsObj.content || argsObj.code) type = 'write_file';
  
  // 提取关键信息
  const filePath = String(argsObj.file_path || argsObj.path || '');
  const command = String(argsObj.command || '');
  const query = String(argsObj.query || argsObj.search || '');
  const content = String(argsObj.content || argsObj.code || '');
  
  // 生成摘要
  let summary = '';
  let detail = '';
  
  if (filePath) {
    const fileName = filePath.split('/').pop() || filePath;
    summary = fileName;
    if (content) {
      const lines = content.split('\n').length;
      const chars = content.length;
      summary += ` (${lines} 行, ${chars} 字符)`;
      detail = content;
    }
  } else if (command) {
    summary = command.length > 60 ? command.slice(0, 60) + '...' : command;
  } else if (query) {
    summary = query.length > 60 ? query.slice(0, 60) + '...' : query;
  } else {
    const str = JSON.stringify(args);
    summary = str.length > 80 ? str.slice(0, 80) + '...' : str;
    if (str.length > 80) detail = str;
  }
  
  return { summary, detail, type: type as string };
}

// 获取工具图标
function getToolIcon(type: string) {
  switch (type) {
    case 'read_file': return FileText;
    case 'write_file': return FileEdit;
    case 'search': return Search;
    case 'execute': return Command;
    default: return Terminal;
  }
}

// 获取工具显示名称
function getToolName(name: string): string {
  const nameMap: Record<string, string> = {
    'read_file': '读取文件',
    'write_file': '写入文件',
    'edit_file': '编辑文件',
    'search_files': '搜索文件',
    'execute_command': '执行命令',
    'list_directory': '列出目录',
  };
  return nameMap[name] || name;
}

// User Message - 气泡样式
interface UserMessageProps {
  content: string;
  timestamp?: string;
  className?: string;
}

export function UserMessage({ content, timestamp, className }: UserMessageProps) {
  return (
    <div className={clsx('flex gap-3 animate-fade-in', className)}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
        <User size={16} />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="inline-block max-w-[85%] px-4 py-3 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-blue-600/10 border border-cyan-500/20 rounded-tl-sm">
          <div className="text-[15px] leading-7 text-text-primary whitespace-pre-wrap">
            {content}
          </div>
        </div>
        {timestamp && (
          <div className="text-xs text-text-secondary mt-1.5 ml-1 opacity-50">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}

// Tool Call 组件 - 可折叠
interface ToolCallProps {
  name: string;
  args: unknown;
  isExecuting?: boolean;
  className?: string;
}

export function ToolCallItem({ name, args, isExecuting, className }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const { summary, detail, type } = formatArgs(args);
  const Icon = getToolIcon(type);
  const displayName = getToolName(name);
  const hasDetail = !!detail;
  
  return (
    <div className={clsx(
      'my-1 rounded-lg overflow-hidden border',
      'bg-bg-tertiary/30 border-border/50',
      isExecuting && 'border-accent-yellow/30 bg-accent-yellow/5',
      className
    )}>
      {/* Header - 始终显示 */}
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={clsx(
          'w-full flex items-center gap-2 py-2 px-3',
          hasDetail && 'cursor-pointer hover:bg-bg-tertiary/50'
        )}
      >
        <Icon size={14} className={clsx(
          'flex-shrink-0',
          isExecuting ? 'text-accent-yellow' : 'text-text-secondary'
        )} />
        
        <span className={clsx(
          'text-sm font-medium',
          isExecuting ? 'text-accent-yellow' : 'text-text-primary'
        )}>
          {displayName}
        </span>
        
        <span className="text-sm text-text-secondary/70 truncate flex-1 text-left">
          {summary}
        </span>
        
        {isExecuting && (
          <span className="flex gap-0.5">
            <span className="w-1 h-1 bg-accent-yellow rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 bg-accent-yellow rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 bg-accent-yellow rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        )}
        
        {hasDetail && (
          <span className="text-text-secondary">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
      </button>
      
      {/* Detail - 可折叠 */}
      {expanded && detail && (
        <div className="px-3 pb-3">
          <div className="bg-[#0d1117] rounded-md p-3 font-mono text-xs text-text-secondary overflow-x-auto max-h-[300px] overflow-y-auto">
            <pre className="whitespace-pre-wrap break-all">{detail}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Assistant Message
interface AssistantMessageProps {
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  toolCalls?: Array<{ name: string; args: unknown; isExecuting?: boolean }>;
  className?: string;
}

export function AssistantMessage({ 
  content, 
  timestamp, 
  isStreaming, 
  toolCalls,
  className 
}: AssistantMessageProps) {
  return (
    <div className={clsx('flex gap-3 animate-fade-in', className)}>
      <div className="w-8 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {/* Tool Calls */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mb-3 max-w-[90%]">
            {toolCalls.map((call, i) => (
              <ToolCallItem 
                key={i} 
                name={call.name} 
                args={call.args}
                isExecuting={call.isExecuting}
              />
            ))}
          </div>
        )}
        
        {/* Content */}
        <div className="text-[15px] leading-7 text-text-primary max-w-[90%]">
          <Response>{content}</Response>
          {isStreaming && (
            <span className="inline-flex gap-1 ml-1">
              <span className="w-1.5 h-1.5 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          )}
        </div>
        
        {timestamp && (
          <div className="text-xs text-text-secondary mt-1.5 opacity-50">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}

// System Message
interface SystemMessageProps {
  content: string;
  className?: string;
}

export function SystemMessage({ content, className }: SystemMessageProps) {
  return (
    <div className={clsx('flex gap-3 animate-fade-in', className)}>
      <div className="w-8 flex-shrink-0" />
      <div className="flex-1 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-text-secondary text-xs max-w-[90%]">
        {content}
      </div>
    </div>
  );
}

// Legacy exports
export function Message({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('flex gap-3 animate-fade-in', className)}>{children}</div>;
}

export function MessageAvatar({ from }: { from: 'user' | 'assistant' | 'system' }) {
  if (from === 'assistant') return null;
  const Icon = from === 'user' ? User : Zap;
  const colors = { user: 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white', system: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white' };
  return <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', colors[from])}><Icon size={16} /></div>;
}

export function MessageContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('flex-1 min-w-0', className)}>{children}</div>;
}

export function MessageResponse({ children }: { children: React.ReactNode }) {
  return <div className="text-[15px] leading-7 text-text-primary">{children}</div>;
}

export function MessageTimestamp({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-secondary mt-2 opacity-60">{children}</div>;
}

export function StreamingIndicator() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="w-1.5 h-1.5 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-accent-green rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}
