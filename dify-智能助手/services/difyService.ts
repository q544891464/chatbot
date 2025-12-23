
/**
 * Dify 服务层
 * 处理与后端 API 的交互
 */

// 假设您的后端基地址。如果是开发环境，可能需要配置。
const API_BASE = '/api'; 

export interface DifyApp {
  id: string;
  name: string;
  description?: string;
}

/**
 * 从后端获取可用的应用/工作流列表
 */
export const fetchDifyApps = async (): Promise<DifyApp[]> => {
  try {
    // 假设后端有一个接口返回当前可用的 Dify 应用列表
    const response = await fetch(`${API_BASE}/apps`);
    if (!response.ok) throw new Error('无法获取应用列表');
    return await response.json();
  } catch (error) {
    console.error('获取应用列表失败，使用默认配置:', error);
    // 返回 Mock 数据以供演示
    return [
      { id: 'app-knowledge-base', name: '企业知识库' },
      { id: 'app-workflow-agent', name: '智能工作流助手' },
      { id: 'app-creative-writing', name: '创意写作专家' },
    ];
  }
};

/**
 * 调用 Dify 聊天接口并流式返回结果
 */
export const streamDifyChat = async (
  appId: string,
  query: string,
  conversationId: string | null,
  onChunk: (text: string) => void
): Promise<{ fullText: string; conversationId: string }> => {
  
  // Dify 标准请求结构 (通常由后端转发以隐藏 API Key)
  const response = await fetch(`${API_BASE}/chat-messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId, // 告知后端使用哪个 Dify App
      query: query,
      user: 'h5-user-default',
      conversation_id: conversationId || "",
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`请求失败: ${response.status} - ${err}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('流式读取不可用');

  const decoder = new TextDecoder();
  let fullText = '';
  let finalConversationId = conversationId || "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    // Dify 的 SSE 格式通常是 data: {"event": "message", "answer": "...", ...}
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') break;
        
        try {
          const data = JSON.parse(dataStr);
          if (data.event === 'message' || data.event === 'agent_message') {
            fullText += data.answer || '';
            onChunk(fullText);
          }
          if (data.conversation_id) {
            finalConversationId = data.conversation_id;
          }
        } catch (e) {
          // 忽略解析失败的碎片内容
        }
      }
    }
  }

  return { fullText, conversationId: finalConversationId };
};
