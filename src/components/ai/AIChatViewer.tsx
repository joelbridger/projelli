// AI Chat Viewer Component
// Displays full chat history and allows continuing conversations

import { useState, useCallback, useEffect, useRef } from 'react';
import { Send, Download, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { AIChatFile, ChatMessage } from '@/types/ai';
import type { AuditEntry } from '@/types/audit';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import { FILE_ACCESS_TOOLS } from '@/modules/tools/fileAccessTools';
import { useAIChatStore, getDraftInput } from '@/stores/aiChatStore';

interface APIKey {
  provider: string;
  key: string;
  isValid: boolean;
}

interface AIChatViewerProps {
  chatData: AIChatFile;
  onSave?: (updatedChat: AIChatFile) => void;
  onExport?: (chatData: AIChatFile) => void;
  apiKeys?: APIKey[];
  workspaceServiceRef?: React.MutableRefObject<any>;
  rootPath?: string; // Workspace root path for file access tools
  onFileTreeChange?: () => void; // Callback when AI modifies files
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void; // Callback to log AI actions
  className?: string;
}

/**
 * Render markdown-like formatting for messages
 */
function renderMessage(content: string): string {
  let html = content;

  // Escape HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="my-2 p-3 rounded bg-muted overflow-x-auto max-w-full"><code class="font-mono text-sm whitespace-pre-wrap break-all">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-muted font-mono text-sm">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
}

/**
 * Convert chat to markdown for export
 */
function chatToMarkdown(chat: AIChatFile): string {
  let markdown = `# ${chat.title}\n\n`;
  markdown += `**Created:** ${new Date(chat.created).toLocaleString()}\n`;
  markdown += `**Updated:** ${new Date(chat.updated).toLocaleString()}\n\n`;
  markdown += `---\n\n`;

  for (const msg of chat.messages) {
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === 'user' ? 'You' : 'Assistant';
    markdown += `## ${role} (${timestamp})\n\n`;
    markdown += `${msg.content}\n\n`;
    markdown += `---\n\n`;
  }

  return markdown;
}

export function AIChatViewer({ chatData, onSave, onExport, apiKeys = [], workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog, className }: AIChatViewerProps) {
  // Use global store for chat state (persists across navigation)
  const { sessions, initSession, addMessage, setLoading, setDraftInput, clearDraftInput } = useAIChatStore();
  const chatId = chatData.id;
  const session = sessions[chatId];

  // Initialize input with saved draft (persists across navigation)
  const [inputValue, setInputValue] = useState(() => getDraftInput(chatId));
  const [isRecording, setIsRecording] = useState(false);
  const [aiRules, setAiRules] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize session on mount if it doesn't exist
  useEffect(() => {
    if (!session) {
      initSession(chatId, chatData.messages);
    }
  }, [chatId, session, initSession, chatData.messages]);

  // Load AI Rules from workspace
  useEffect(() => {
    const loadAIRules = async () => {
      if (!rootPath || !workspaceServiceRef?.current) return;

      try {
        const rulesPath = `${rootPath}/ai-rules.md`;
        const exists = await workspaceServiceRef.current.exists(rulesPath);

        if (exists) {
          const content = await workspaceServiceRef.current.readFile(rulesPath);
          setAiRules(content);
        } else {
          setAiRules('');
        }
      } catch (error) {
        console.error('Failed to load AI rules:', error);
        setAiRules('');
      }
    };

    loadAIRules();
  }, [rootPath, workspaceServiceRef]);

  // Get messages and loading state from store
  const messages = session?.messages ?? chatData.messages;
  const isLoading = session?.isLoading ?? false;

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Save draft input to store (debounced) - persists across navigation
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (inputValue.trim()) {
        setDraftInput(chatId, inputValue);
      } else {
        clearDraftInput(chatId);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [inputValue, chatId, setDraftInput, clearDraftInput]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    // Add user message to store (persists immediately)
    addMessage(chatId, userMessage);
    const updatedMessages = [...messages, userMessage];
    setInputValue('');
    clearDraftInput(chatId); // Clear saved draft after sending
    setLoading(chatId, true);

    // Call Claude API with actual integration
    (async () => {
      try {
        // Find valid Claude API key
        const claudeKey = apiKeys.find(k => k.provider === 'anthropic' && k.isValid);

        if (!claudeKey) {
          throw new Error('No valid Claude API key found. Please add your API key in the settings.');
        }

        // Initialize Claude provider with AI Rules
        const provider = new ClaudeProvider({
          apiKey: claudeKey.key,
          model: 'claude-sonnet-4-20250514',
          ...(aiRules ? { aiRules } : {}),
        });

        // Register file access tools if workspace is available
        if (workspaceServiceRef?.current && rootPath) {
          const toolExecutor = async (toolName: string, params: Record<string, unknown>) => {
            if (!workspaceServiceRef.current || !rootPath) {
              throw new Error('Workspace not initialized');
            }

            switch (toolName) {
              case 'read_file': {
                const relativePath = params['path'] as string;
                const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');

                // Validate path is within workspace root
                if (!filePath.startsWith(rootPath)) {
                  throw new Error('Access denied: path outside workspace');
                }

                try {
                  const content = await workspaceServiceRef.current.readFile(filePath);
                  return { content, path: relativePath };
                } catch (error) {
                  throw new Error(`Failed to read file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              case 'list_files': {
                const relativePath = (params['path'] as string) || '.';
                const dirPath = relativePath === '.' || relativePath === ''
                  ? rootPath
                  : `${rootPath}/${relativePath}`.replace(/\/+/g, '/');

                // Validate path is within workspace root
                if (!dirPath.startsWith(rootPath)) {
                  throw new Error('Access denied: path outside workspace');
                }

                try {
                  const entries = await workspaceServiceRef.current.list(dirPath);
                  return {
                    entries: entries.map((e: any) => ({
                      name: e.name,
                      type: e.type,
                      path: relativePath === '.' || relativePath === '' ? e.name : `${relativePath}/${e.name}`,
                      extension: e.extension
                    })),
                    path: relativePath
                  };
                } catch (error) {
                  throw new Error(`Failed to list directory "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              case 'search_files': {
                const query = params['query'] as string;

                try {
                  // Get full file tree and search through it
                  const fileTree = await workspaceServiceRef.current.getFileTree();

                  const searchResults: Array<{ name: string; path: string; type: string }> = [];

                  const searchNode = (nodes: any[], parentPath = '') => {
                    for (const node of nodes) {
                      const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;

                      // Check if name matches query (case-insensitive, supports wildcards)
                      const pattern = query.replace(/\*/g, '.*').replace(/\?/g, '.');
                      const regex = new RegExp(pattern, 'i');

                      if (regex.test(node.name)) {
                        searchResults.push({
                          name: node.name,
                          path: nodePath,
                          type: node.type
                        });
                      }

                      // Recursively search children
                      if (node.children) {
                        searchNode(node.children, nodePath);
                      }
                    }
                  };

                  searchNode(fileTree);

                  return { results: searchResults, query };
                } catch (error) {
                  throw new Error(`Failed to search files: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              case 'write_file': {
                const relativePath = params['path'] as string;
                const content = params['content'] as string;
                const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');

                // Validate path is within workspace root
                if (!filePath.startsWith(rootPath)) {
                  throw new Error('Access denied: path outside workspace');
                }

                try {
                  // Check if file exists to determine if this is create or update
                  const exists = await workspaceServiceRef.current.exists(filePath);
                  const action = exists ? 'file_update' : 'file_create';
                  const actionLabel = exists ? 'updated' : 'created';

                  await workspaceServiceRef.current.writeFile(filePath, content);
                  onFileTreeChange?.(); // Notify that file tree changed

                  // Log to audit
                  onAuditLog?.({
                    action,
                    description: `AI ${actionLabel} file: ${relativePath}`,
                    model: 'claude-3.5-sonnet',
                    inputs: { path: relativePath, contentLength: content.length },
                    outputs: { success: true },
                    userDecision: 'auto',
                    metadata: { tool: 'write_file' },
                  });

                  return { path: relativePath, message: 'File written successfully' };
                } catch (error) {
                  throw new Error(`Failed to write file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              case 'create_folder': {
                const relativePath = params['path'] as string;
                const folderPath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');

                // Validate path is within workspace root
                if (!folderPath.startsWith(rootPath)) {
                  throw new Error('Access denied: path outside workspace');
                }

                try {
                  await workspaceServiceRef.current.mkdir(folderPath);
                  onFileTreeChange?.(); // Notify that file tree changed

                  // Log to audit
                  onAuditLog?.({
                    action: 'file_create',
                    description: `AI created folder: ${relativePath}`,
                    model: 'claude-3.5-sonnet',
                    inputs: { path: relativePath },
                    outputs: { success: true },
                    userDecision: 'auto',
                    metadata: { tool: 'create_folder', type: 'folder' },
                  });

                  return { path: relativePath, message: 'Folder created successfully' };
                } catch (error) {
                  throw new Error(`Failed to create folder "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              case 'move_file': {
                const fromPath = params['from'] as string;
                const toPath = params['to'] as string;
                const fullFromPath = `${rootPath}/${fromPath}`.replace(/\/+/g, '/');
                const fullToPath = `${rootPath}/${toPath}`.replace(/\/+/g, '/');

                // Validate paths are within workspace root
                if (!fullFromPath.startsWith(rootPath) || !fullToPath.startsWith(rootPath)) {
                  throw new Error('Access denied: path outside workspace');
                }

                try {
                  await workspaceServiceRef.current.move(fullFromPath, fullToPath);
                  onFileTreeChange?.(); // Notify that file tree changed

                  // Log to audit
                  onAuditLog?.({
                    action: 'file_move',
                    description: `AI moved file: ${fromPath} → ${toPath}`,
                    model: 'claude-3.5-sonnet',
                    inputs: { from: fromPath, to: toPath },
                    outputs: { success: true },
                    userDecision: 'auto',
                    metadata: { tool: 'move_file' },
                  });

                  return { from: fromPath, to: toPath, message: 'File moved successfully' };
                } catch (error) {
                  throw new Error(`Failed to move file from "${fromPath}" to "${toPath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              case 'delete_file': {
                const relativePath = params['path'] as string;
                const filePath = `${rootPath}/${relativePath}`.replace(/\/+/g, '/');

                // Validate path is within workspace root
                if (!filePath.startsWith(rootPath)) {
                  throw new Error('Access denied: path outside workspace');
                }

                try {
                  await workspaceServiceRef.current.delete(filePath);
                  onFileTreeChange?.(); // Notify that file tree changed

                  // Log to audit
                  onAuditLog?.({
                    action: 'file_delete',
                    description: `AI deleted file: ${relativePath}`,
                    model: 'claude-3.5-sonnet',
                    inputs: { path: relativePath },
                    outputs: { success: true, movedToTrash: true },
                    userDecision: 'auto',
                    metadata: { tool: 'delete_file' },
                  });

                  return { path: relativePath, message: 'File deleted successfully (moved to trash)' };
                } catch (error) {
                  throw new Error(`Failed to delete file "${relativePath}": ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }

              default:
                throw new Error(`Unknown tool: ${toolName}`);
            }
          };

          provider.setTools(FILE_ACCESS_TOOLS, toolExecutor);
        }

        // Build conversation history into system prompt
        const conversationContext = messages.slice(0, -1).map(m =>
          `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n\n');

        // Build system prompt (AI Rules are now handled by provider)
        const systemPrompt = conversationContext
          ? `You are a helpful AI assistant. Here is the conversation history:\n\n${conversationContext}\n\nPlease respond to the user's latest message.`
          : 'You are a helpful AI assistant.';

        // Send message to Claude
        const response = await provider.sendMessage(userMessage.content, {
          systemPrompt,
          maxTokens: 4096,
        });

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.content,
          timestamp: new Date().toISOString(),
        };

        // Add assistant message to store (persists immediately)
        addMessage(chatId, assistantMessage);
        const finalMessages = [...updatedMessages, assistantMessage];

        // Save to file
        if (onSave) {
          const updatedChat: AIChatFile = {
            ...chatData,
            updated: new Date().toISOString(),
            messages: finalMessages,
          };
          onSave(updatedChat);
        }
      } catch (error) {
        console.error('AI chat error:', error);
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: `❌ Error: ${error instanceof Error ? error.message : 'Failed to get response from AI. Please check your API key and try again.'}`,
          timestamp: new Date().toISOString(),
        };

        // Add error message to store (persists immediately)
        addMessage(chatId, errorMessage);
        const finalMessages = [...updatedMessages, errorMessage];

        // Save error state
        if (onSave) {
          const updatedChat: AIChatFile = {
            ...chatData,
            updated: new Date().toISOString(),
            messages: finalMessages,
          };
          onSave(updatedChat);
        }
      } finally {
        setLoading(chatId, false);
      }
    })();
  }, [inputValue, messages, chatData, onSave, isLoading, apiKeys, chatId, addMessage, setLoading, workspaceServiceRef, rootPath, onFileTreeChange, onAuditLog]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Voice recording handlers
  const startVoiceRecording = useCallback(() => {
    // Check if browser supports speech recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setInputValue(prev => prev + finalTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (error) {
      console.error('Failed to start voice recording:', error);
      alert('Failed to start voice recording. Please check your microphone permissions.');
    }
  }, []);

  const stopVoiceRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsRecording(false);
    }
  }, []);

  const toggleVoiceRecording = useCallback(() => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  }, [isRecording, startVoiceRecording, stopVoiceRecording]);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(chatData);
    } else {
      // Default export: download as markdown
      const markdown = chatToMarkdown({ ...chatData, messages });
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${chatData.title}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [chatData, messages, onExport]);

  return (
    <div data-testid="ai-chat-viewer" className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 data-testid="chat-title" className="text-lg font-semibold">{chatData.title}</h2>
          <p data-testid="chat-created-date" className="text-xs text-muted-foreground">
            Created {new Date(chatData.created).toLocaleDateString()}
          </p>
        </div>
        <Button
          data-testid="chat-export-button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>

      {/* Messages */}
      <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            data-testid={`chat-message-${idx}`}
            data-role={msg.role}
            className={cn(
              'flex flex-col gap-1',
              msg.role === 'user' ? 'items-end' : 'items-start'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {msg.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div
              className={cn(
                'max-w-[85%] min-w-0 rounded-lg px-4 py-2 break-words overflow-wrap-anywhere',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              )}
              dangerouslySetInnerHTML={{ __html: renderMessage(msg.content) }}
            />
          </div>
        ))}
        {isLoading && (
          <div data-testid="chat-loading-indicator" className="flex items-start gap-2">
            <span className="text-xs font-medium text-muted-foreground">Assistant</span>
            <div className="bg-muted rounded-lg px-4 py-2">
              <div className="flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce delay-100">●</span>
                <span className="animate-bounce delay-200">●</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div data-testid="chat-input-area" className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            data-testid="chat-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
            className="min-h-[60px] max-h-[200px] resize-none"
            disabled={isLoading}
          />
          <div className="flex flex-col gap-2 shrink-0">
            <Button
              data-testid="chat-voice-button"
              onClick={toggleVoiceRecording}
              disabled={isLoading}
              size="icon"
              variant={isRecording ? 'destructive' : 'outline'}
              className={`h-[60px] w-[60px] ${isRecording ? 'animate-pulse' : ''}`}
              title={isRecording ? 'Stop recording' : 'Start voice input'}
            >
              {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
          </div>
          <Button
            data-testid="chat-send-button"
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            className="h-[60px] w-[60px] shrink-0"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AIChatViewer;
