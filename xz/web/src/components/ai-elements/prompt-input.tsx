import { createContext, useContext, useRef, useState, useCallback, type ReactNode, forwardRef } from 'react';
import { clsx } from 'clsx';
import { Send, Paperclip, X } from 'lucide-react';

// Types
export interface PromptInputMessage {
  text: string;
  files?: File[];
}

interface PromptInputContextValue {
  text: string;
  setText: (text: string) => void;
  files: File[];
  addFiles: (files: FileList | null) => void;
  removeFile: (index: number) => void;
  clearFiles: () => void;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInput() {
  const ctx = useContext(PromptInputContext);
  if (!ctx) throw new Error('PromptInput components must be used inside <PromptInput>');
  return ctx;
}

// PromptInput Root
interface PromptInputProps {
  children: ReactNode;
  onSubmit: (message: PromptInputMessage) => void;
  className?: string;
  disabled?: boolean;
}

export function PromptInput({ children, onSubmit, className, disabled }: PromptInputProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void onSubmit;
  
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    setFiles(prev => [...prev, ...Array.from(newFiles)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  // Handle submit is done in the form onSubmit
  void disabled;

  return (
    <PromptInputContext.Provider value={{ 
      text, setText, 
      files, addFiles, removeFile, clearFiles,
      isSubmitting, setIsSubmitting 
    }}>
      <div className={clsx('flex flex-col gap-2', className)}>
        {children}
      </div>
    </PromptInputContext.Provider>
  );
}

// PromptInput Header (for attachments)
interface PromptInputHeaderProps {
  children: ReactNode;
  className?: string;
}

export function PromptInputHeader({ children, className }: PromptInputHeaderProps) {
  const { files } = usePromptInput();
  
  if (files.length === 0) return null;
  
  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      {children}
    </div>
  );
}

// PromptInput Body
interface PromptInputBodyProps {
  children: ReactNode;
  className?: string;
}

export function PromptInputBody({ children, className }: PromptInputBodyProps) {
  return (
    <div className={clsx('relative', className)}>
      {children}
    </div>
  );
}

// PromptInput Textarea
interface PromptInputTextareaProps {
  placeholder?: string;
  className?: string;
  minRows?: number;
  maxRows?: number;
}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea({ placeholder = 'Type a message...', className, minRows = 1, maxRows = 8 }, ref) {
    const { text, setText, isSubmitting } = usePromptInput();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      
      // Auto-resize
      const textarea = e.target;
      textarea.style.height = 'auto';
      const lineHeight = 24;
      const minHeight = minRows * lineHeight;
      const maxHeight = maxRows * lineHeight;
      const scrollHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${scrollHeight}px`;
    }, [setText, minRows, maxRows]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const form = textareaRef.current?.closest('form');
        form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }, []);

    return (
      <textarea
        ref={(node) => {
          textareaRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        }}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isSubmitting}
        placeholder={placeholder}
        rows={minRows}
        className={clsx(
          'w-full bg-transparent text-text-primary placeholder:text-text-secondary resize-none outline-none',
          'text-sm leading-6',
          className
        )}
      />
    );
  }
);

// PromptInput Footer
interface PromptInputFooterProps {
  children: ReactNode;
  className?: string;
}

export function PromptInputFooter({ children, className }: PromptInputFooterProps) {
  return (
    <div className={clsx('flex items-center justify-between gap-2 pt-2', className)}>
      {children}
    </div>
  );
}

// PromptInput Tools
interface PromptInputToolsProps {
  children: ReactNode;
  className?: string;
}

export function PromptInputTools({ children, className }: PromptInputToolsProps) {
  return (
    <div className={clsx('flex items-center gap-1', className)}>
      {children}
    </div>
  );
}

// PromptInput Button
interface PromptInputButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  tooltip?: string;
}

export function PromptInputButton({ children, onClick, disabled, className, tooltip }: PromptInputButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={clsx(
        'p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      {children}
    </button>
  );
}

// PromptInput Submit
interface PromptInputSubmitProps {
  className?: string;
  disabled?: boolean;
}

export function PromptInputSubmit({ className, disabled }: PromptInputSubmitProps) {
  const { text, files, isSubmitting } = usePromptInput();
  const hasContent = text.trim().length > 0 || files.length > 0;

  return (
    <button
      type="submit"
      disabled={disabled || !hasContent || isSubmitting}
      className={clsx(
        'p-2.5 rounded-xl bg-accent-green text-bg-primary transition-all',
        'hover:opacity-90 active:scale-95',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        className
      )}
    >
      <Send size={18} />
    </button>
  );
}

// File Attachment Preview
interface FileAttachmentProps {
  file: File;
  onRemove: () => void;
}

export function FileAttachment({ file, onRemove }: FileAttachmentProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-tertiary border border-border text-xs">
      <Paperclip size={12} className="text-text-secondary" />
      <span className="text-text-primary truncate max-w-[120px]">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// Use PromptInput hook for external access
export function usePromptInputContext() {
  return usePromptInput();
}
