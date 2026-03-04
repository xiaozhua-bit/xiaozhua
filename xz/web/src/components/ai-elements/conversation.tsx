import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

// Conversation Context
interface ConversationContextValue {
  scrollToBottom: () => void;
  isAtBottom: boolean;
}

const ConversationContext = createContext<ConversationContextValue | null>(null);

function useConversation() {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error('Conversation components must be used inside <Conversation>');
  return ctx;
}

// Conversation Root
interface ConversationProps {
  children: React.ReactNode;
  className?: string;
}

export function Conversation({ children, className }: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setIsAtBottom(true);
      setShowScrollButton(false);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsAtBottom(atBottom);
      setShowScrollButton(!atBottom);
    }
  }, []);

  // Auto-scroll when at bottom
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [children, isAtBottom, scrollToBottom]);

  return (
    <ConversationContext.Provider value={{ scrollToBottom, isAtBottom }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={clsx('relative overflow-y-auto', className)}
      >
        {children}
      </div>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 p-2 rounded-full bg-bg-tertiary border border-border shadow-lg text-text-secondary hover:text-text-primary transition-all hover:scale-105 z-10"
        >
          <ChevronDown size={20} />
        </button>
      )}
    </ConversationContext.Provider>
  );
}

// Conversation Content
interface ConversationContentProps {
  children: React.ReactNode;
  className?: string;
}

export function ConversationContent({ children, className }: ConversationContentProps) {
  return (
    <div className={clsx('space-y-4 pb-4', className)}>
      {children}
    </div>
  );
}

// Conversation Empty State
interface ConversationEmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export function ConversationEmptyState({ 
  icon, 
  title = 'Start a conversation', 
  description = 'Type a message below to begin chatting',
  className 
}: ConversationEmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center justify-center h-full text-center p-8', className)}>
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary max-w-sm">{description}</p>
    </div>
  );
}

// Conversation Scroll Button
interface ConversationScrollButtonProps {
  className?: string;
}

export function ConversationScrollButton({ className }: ConversationScrollButtonProps) {
  const { scrollToBottom, isAtBottom } = useConversation();

  if (isAtBottom) return null;

  return (
    <button
      onClick={scrollToBottom}
      className={clsx(
        'absolute bottom-4 right-4 p-2 rounded-full bg-bg-tertiary border border-border shadow-lg text-text-secondary hover:text-text-primary transition-all hover:scale-105',
        className
      )}
    >
      <ChevronDown size={20} />
    </button>
  );
}
