import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

// Custom styles for markdown content to fit H5/Mobile theme
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <div className="prose prose-sm max-w-none break-words dark:prose-invert">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a 
              {...props} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-blue-500 underline decoration-blue-300 underline-offset-2 break-all"
            />
          ),
          img: ({ node, ...props }) => (
            <img 
              {...props} 
              className="rounded-lg shadow-sm my-2 max-w-full h-auto" 
              loading="lazy" 
            />
          ),
          p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0 leading-relaxed" />,
          ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-4 mb-2 space-y-1" />,
          ol: ({ node, ...props }) => <ol {...props} className="list-decimal pl-4 mb-2 space-y-1" />,
          code: ({ node, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !String(children).includes('\n');
            return isInline ? (
              <code {...props} className="bg-black/10 text-red-600 px-1 py-0.5 rounded text-sm font-mono">
                {children}
              </code>
            ) : (
              <div className="bg-gray-800 text-gray-100 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono">
                <code {...props} className={className}>
                  {children}
                </code>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;