import { useState, useRef, useCallback } from 'react';
import { Send, Paperclip, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, isLoading, placeholder = '输入消息或 /命令...' }: ChatInputProps) {
  const [value, setValue] = useState('');
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    
    onSend(trimmed);
    setValue('');
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 阻止在输入法 composition 期间发送消息
    // 同时检查 ref 和原生事件属性
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposingRef.current || (e.nativeEvent as KeyboardEvent).isComposing) {
        return; // 正在输入法编辑中，不处理
      }
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }, [handleSubmit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  const hasValue = value.trim().length > 0;
  const isInputDisabled = disabled;
  const canSubmit = hasValue && !isInputDisabled && !isLoading;

  return (
    <form 
      onSubmit={handleSubmit}
      className={clsx(
        'relative flex items-end gap-2 p-3 rounded-2xl border transition-all duration-200',
        'bg-bg-secondary shadow-sm',
        isLoading 
          ? 'border-accent-green/30 shadow-md shadow-accent-green/5' 
          : 'border-border focus-within:border-accent-cyan/50 focus-within:shadow-md focus-within:shadow-accent-cyan/5'
      )}
    >
      {/* Loading indicator - shows when agent is working */}
      {isLoading && (
        <div className="absolute -top-8 left-0 flex items-center gap-2 text-xs text-accent-green">
          <Loader2 size={12} className="animate-spin" />
          <span>AI 正在思考...</span>
        </div>
      )}

      {/* Attachment button */}
      <button
        type="button"
        disabled={isInputDisabled}
        className={clsx(
          'p-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors flex-shrink-0',
          isInputDisabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Paperclip size={20} />
      </button>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        disabled={isInputDisabled}
        placeholder={isLoading ? 'AI 正在回复，你可以继续输入下一条...' : placeholder}
        rows={1}
        className={clsx(
          'flex-1 min-h-[44px] max-h-[200px] py-3 bg-transparent resize-none outline-none',
          'text-sm text-text-primary placeholder:text-text-secondary',
          isInputDisabled && 'opacity-50 cursor-not-allowed'
        )}
      />
      
      {/* Submit button */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={clsx(
          'p-2.5 rounded-xl transition-all duration-200 flex-shrink-0',
          canSubmit
            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md hover:shadow-lg hover:scale-105'
            : 'bg-bg-tertiary text-text-secondary',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100'
        )}
      >
        <Send size={18} />
      </button>
    </form>
  );
}
