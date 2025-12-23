
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Role } from './types';
import { fetchDifyApps, streamDifyChat, DifyApp } from './services/difyService';
import ChatMessageBubble from './components/ChatMessageBubble';
import { PaperAirplaneIcon, SparklesIcon, ExclamationCircleIcon, ChevronDownIcon, ArrowPathIcon } from '@heroicons/react/24/solid';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Dify 相关状态
  const [availableApps, setAvailableApps] = useState<DifyApp[]>([]);
  const [currentAppId, setCurrentAppId] = useState<string>('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 初始化获取应用列表
  useEffect(() => {
    const init = async () => {
      try {
        const apps = await fetchDifyApps();
        setAvailableApps(apps);
        if (apps.length > 0) {
          setCurrentAppId(apps[0].id);
        }
      } catch (err) {
        setError('加载应用配置失败，请刷新页面');
      } finally {
        setIsInitialLoading(false);
      }
    };
    init();
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading || !currentAppId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: Role.User,
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const aiMessageId = (Date.now() + 1).toString();
      const initialAiMessage: Message = {
        id: aiMessageId,
        role: Role.Model,
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, initialAiMessage]);

      const result = await streamDifyChat(
        currentAppId,
        userMessage.content,
        conversationId,
        (updatedText) => {
          setMessages((prev) => 
            prev.map((msg) => 
              msg.id === aiMessageId ? { ...msg, content: updatedText } : msg
            )
          );
        }
      );

      // 更新会话 ID 以后续保持上下文
      setConversationId(result.conversationId);

      setMessages((prev) => 
        prev.map((msg) => 
          msg.id === aiMessageId ? { ...msg, isStreaming: false } : msg
        )
      );

    } catch (err: any) {
      console.error(err);
      setError("发送失败，请检查网络或后端服务");
      setMessages((prev) => prev.filter(msg => msg.content !== '' || msg.role === Role.User));
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, currentAppId, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const clearChat = () => {
    if (window.confirm('确定要清空当前对话吗？')) {
      setMessages([]);
      setConversationId(null);
      setError(null);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-secondary">
        <div className="flex flex-col items-center gap-3">
          <ArrowPathIcon className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-gray-500 font-medium">正在加载配置...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-secondary text-gray-900 font-sans overflow-hidden relative">
      
      {/* 顶部状态栏 */}
      <header className="flex-none bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-2 flex items-center justify-between sticky top-0 z-20">
        <div className="w-8"></div> {/* 占位平衡 */}
        
        <div className="flex flex-col items-center gap-1 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 bg-gradient-to-tr from-blue-600 to-blue-400 rounded-lg flex items-center justify-center text-white shadow-sm">
              <SparklesIcon className="w-3 h-3" />
            </div>
            <h1 className="font-bold text-sm tracking-tight text-gray-800">Dify 智能助手</h1>
          </div>
          
          {/* 应用/知识库选择器 */}
          <div className="relative group">
            <select
              value={currentAppId}
              onChange={(e) => {
                setCurrentAppId(e.target.value);
                setMessages([]); // 切换应用清空对话
                setConversationId(null);
              }}
              disabled={isLoading}
              className="appearance-none bg-gray-100 hover:bg-gray-200 border-0 rounded-full py-1 px-4 pr-7 text-[11px] font-semibold text-gray-600 focus:ring-2 focus:ring-blue-500/20 cursor-pointer transition-all"
            >
              {availableApps.map((app) => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
            </select>
            <ChevronDownIcon className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <button 
          onClick={clearChat}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors p-1"
          title="清空对话"
        >
          <ArrowPathIcon className="w-4 h-4" />
        </button>
      </header>

      {/* 消息展示区域 */}
      <main className="flex-1 overflow-y-auto p-4 space-y-2 scroll-smooth">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8 text-center opacity-80 animate-fadeIn">
            <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-6">
              <SparklesIcon className="w-10 h-10 text-blue-100" />
            </div>
            <p className="text-base font-medium text-gray-600">你好！我是 AI 助手</p>
            <p className="text-xs mt-2 text-gray-400">请选择上方应用并开始与我对话</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessageBubble key={msg.id} message={msg} />
          ))
        )}
        
        {error && (
          <div className="flex justify-center my-4 animate-bounce">
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-2xl text-xs flex items-center shadow-sm border border-red-100">
              <ExclamationCircleIcon className="w-3.5 h-3.5 mr-1.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} className="h-6" />
      </main>

      {/* 输入底部栏 */}
      <footer className="flex-none bg-white border-t border-gray-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] z-20">
        <div className="max-w-4xl mx-auto flex items-end gap-2 bg-gray-50 p-1.5 rounded-[22px] border border-gray-100 shadow-inner">
          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent border-0 focus:ring-0 resize-none py-2 px-3 max-h-[140px] text-[15px] placeholder-gray-400 leading-snug"
            placeholder="问我任何问题..."
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
            className={`
              w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 shrink-0
              ${(!input.trim() || isLoading)
                ? 'bg-gray-200 text-gray-400' 
                : 'bg-primary text-white shadow-lg active:scale-90'
              }
            `}
          >
            <PaperAirplaneIcon className="w-5 h-5 -ml-0.5 transform rotate-90" />
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-300 mt-2">由 Dify 驱动 · 智能连接未来</p>
      </footer>
    </div>
  );
};

export default App;
