# AI 人力助手（H5 Chatbot）

移动端优先的 H5 聊天机器人项目，前端与后端代理一体化部署，支持：

- ChatbotAgent 流式对话
- OAuth 登录（授权码 + token + userinfo）
- 会话持久化（MySQL）
- 点赞 / 点踩反馈
- Markdown / 图片展示

## 目录结构

```text
h5-chatbot/
  index.html
  styles.css
  app.js                 # 页面主入口（已拆分）
  auth.js                # OAuth 认证相关
  chat-api.js            # 聊天接口调用
  feedback.js            # 点赞点踩与状态
  markdown.js            # Markdown 渲染
  utils.js               # 通用工具函数
  platform-bridge.js     # 平台用户信息桥接
  question-bank.json     # 问题库
  static/

server/
  server.js              # Node 代理服务
  start.ps1              # Windows 启动脚本（自动加载 .env）
  .env.example
  sql/init.sql           # MySQL 初始化脚本
```

## 环境准备

- Node.js 18+
- MySQL 8+

安装依赖：

```bash
npm install
```

## 配置

1. 复制模板：

```bash
cp server/.env.example server/.env
```

2. 按需修改 `server/.env`，重点项：

- `PORT`（默认 `8787`）
- `ALT_API_URL` / `ALT_THREAD_URL` / `ALT_AGENT_ID`
- `ALT_AUTH_URL` / `ALT_AUTH_USERNAME` / `ALT_AUTH_PASSWORD` / `ALT_AUTH_CLIENT_SECRET`
- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`
- `AUTH_SERVER_DOMAIN` / `AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET` / `AUTH_REDIRECT_URI`
- `CORS_ORIGIN`

## MySQL 初始化

执行：

```sql
source server/sql/init.sql;
```

或手动导入 `server/sql/init.sql`。

## 启动方式

### Windows（推荐）

```powershell
cd d:\Code\chatbot
.\server\start.ps1
```

脚本会自动读取：

- `server/.env`
- 项目根目录 `.env`（如存在）

启动日志会显示：

- `http://0.0.0.0:<PORT>`
- 局域网 IP

### 通用（Linux / 容器）

```bash
cd /path/to/chatbot
node server/server.js
```

访问：

- 本机：`http://127.0.0.1:8787`
- 反向代理后：`http(s)://你的域名`

## 常用接口（后端）

- `GET /api/health` 健康检查
- `POST /api/alt-thread` 创建线程
- `POST /api/alt-chat-stream` 流式聊天
- `POST /api/feedback` 提交反馈
- `GET /api/feedback?messageId=...` 查询反馈状态
- `GET /api/conversations` / `POST /api/conversations/sync` 会话同步

## 常见问题

1. 页面报“请求失败，请检查代理服务是否启动”
- 检查 `node server/server.js` 是否运行
- 检查 `GET /api/health` 是否返回 `ok: true`

2. 反向代理 502
- 确认应用实际监听端口（`PORT`）
- 在服务器本机先测：`curl http://127.0.0.1:<PORT>/api/health`

3. 看不到历史会话
- 检查 MySQL 连接配置是否正确
- 检查数据库是否已执行 `server/sql/init.sql`

## 安全建议

- 不要把真实密钥写入前端代码
- `CORS_ORIGIN` 生产环境不要使用 `*`
- 对外部署建议走 HTTPS + 反向代理
