import React from 'react';
import { Message, Role } from '../types';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatMessageBubbleProps {
  message: Message;
}

const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message }) => {
  const isUser = message.role === Role.User;

  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          max-w-[85%] px-4 py-3 
          ${isUser 
            ? 'bg-primary text-white rounded-2xl rounded-tr-sm shadow-md' 
            : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100'
          }
        `}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
        
        {/* Time and Status Indicator */}
        <div className={`text-[10px] mt-1 flex items-center gap-1 opacity-70 ${isUser ? 'text-blue-100 justify-end' : 'text-gray-400 justify-start'}`}>
           {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
           {message.isStreaming && (
             <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse-fast ml-1"></span>
           )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessageBubble;