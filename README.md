# AI 产品助手（H5 Chatbot）

这是一个面向移动端优先场景的 H5 聊天助手项目。当前主链路为：

- 前端：`h5-chatbot`
- 代理服务：`server`
- 会话存储：MySQL
- 上游服务：ChatbotAgent、OAuth、反馈接口

仓库里还包含 `dify-智能助手` 目录，但它更偏原型/实验项目，不作为当前主部署路径。实际运行、部署、同步、排障均以 `h5-chatbot + server` 为准。

## 功能概览

- ChatbotAgent 流式聊天
- ai-wiki 知识库检索进度提示
- 上游空回答兜底提示
- OAuth 登录与用户信息获取
- MySQL 会话持久化
- 点赞 / 点踩反馈
- Markdown、图片、链接渲染
- H5 移动端适配
- Linux 服务器一键同步脚本

## 架构说明

### 组件角色

- 浏览器 / H5 前端
  - 入口：`h5-chatbot/index.html`
  - 负责消息输入、历史展示、认证触发、反馈提交
- Node 代理层
  - 入口：`server/server.js`
  - 负责静态资源服务、会话同步、认证代理、聊天代理、反馈代理
- MySQL
  - 存储用户、会话、消息
  - 初始化脚本：`server/sql/init.sql`
- 上游 ChatbotAgent
  - 负责线程创建、聊天、历史消息查询
- 上游 OAuth 服务
  - 负责授权码换 token 与 userinfo
- 上游反馈服务
  - 负责点赞 / 点踩写入与查询

### 主链路

1. 用户在 H5 页面输入问题。
2. 前端调用 `/api/alt-thread` 创建或复用线程。
3. 前端调用 `/api/alt-chat-stream` 发起流式聊天。
4. Node 代理把请求转发到上游 ChatbotAgent。
5. Node 代理把 ai-wiki 的知识库 / 工具事件转换为前端可展示的进度提示。
6. 前端实时展示进度和回答，并通过 `/api/conversations/sync` 把会话写回 MySQL。
7. 如果上游结束但没有返回可展示文本，Node 和前端都会给出兜底提示，避免空白回复。
8. 用户点赞 / 点踩时，前端调用 `/api/feedback`，Node 再转发到上游反馈服务。
9. OAuth 登录通过 `/api/auth-config`、`/api/auth-token`、`/api/auth-userinfo` 完成。

## 目录结构

```text
.
├─ h5-chatbot/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  ├─ auth.js
│  ├─ chat-api.js
│  ├─ feedback.js
│  ├─ markdown.js
│  ├─ utils.js
│  ├─ platform-bridge.js
│  ├─ question-bank.json
│  ├─ static/
│  └─ vendor/
├─ server/
│  ├─ server.js
│  ├─ start.ps1
│  ├─ start.sh
│  ├─ .env.example
│  ├─ sql/init.sql
│  ├─ data/
│  └─ logs/
│     ├─ server-YYYY-MM-DD.log
│     └─ message-YYYY-MM-DD.log
├─ scripts/
│  ├─ sync-from-github.sh
│  └─ sync-from-github.env.example
├─ deploy/
│  └─ chatbot.service
├─ docs/
└─ package.json
```

## 代码说明



### 前端代码说明

前端代码集中在 `h5-chatbot/`，是一个原生 HTML/CSS/JavaScript H5 应用，没有使用 Vue、React 等框架。这样做的优点是部署简单，Node 服务直接托管静态文件即可；缺点是页面状态、事件绑定和渲染逻辑主要集中在 `app.js`，后续功能继续变多时需要注意拆分。

| 文件 | 作用 | 讲解重点 |
| --- | --- | --- |
| `index.html` | 页面结构入口 | 定义聊天区、会话列表、设置面板、反馈弹窗、图片预览层等 DOM 节点 |
| `styles.css` | 页面样式 | 负责移动端布局、消息气泡、按钮图标、弹窗、侧边会话列表、暗色/浅色视觉层次 |
| `app.js` | 前端主控制器 | 管理全局状态、渲染消息、发送问题、保存会话、绑定按钮事件、初始化页面 |
| `auth.js` | OAuth 登录模块 | 获取授权配置、跳转授权页、回调 code 换 token、调用 userinfo、静默登录 |
| `chat-api.js` | 聊天接口模块 | 创建上游线程、发送聊天请求、解析 SSE 流、处理 `message/meta/progress/message_end` |
| `feedback.js` | 反馈模块 | 点赞/点踩、点踩原因弹窗、查询反馈状态、确保拿到可反馈的外部消息 ID |
| `markdown.js` | Markdown 渲染 | 使用 `markdown-it` 渲染文本、链接、图片、代码块，并做基础安全处理 |
| `platform-bridge.js` | App 宿主桥接 | 兼容 Android/iOS 宿主能力，尝试读取 App 内登录用户信息 |
| `utils.js` | 通用工具 | 时间、ID、URL 规范化、错误格式化、会话标题推导、滚动辅助 |
| `question-bank.json` | 推荐问题库 | 首屏和追问建议的问题来源 |
| `vendor/` | 第三方前端库 | 当前包含 SSE 解析器和 Markdown 渲染库 |
| `static/` | 静态图片资源 | 机器人、用户、AI 标识等页面资源 |

### `app.js` 主线

`app.js` 是前端最适合重点讲的文件。它的主线可以概括为“状态初始化 -> 页面渲染 -> 用户输入 -> 调用聊天流 -> 写回会话 -> 反馈”。

| 代码区域 | 作用 |
| --- | --- |
| `loadConfig` / `saveConfig` | 从 `localStorage` 读取和保存前端配置，例如 API Base URL、用户 ID |
| `state` | 前端全局状态，保存当前配置、会话列表、当前会话、生成状态、登录用户信息 |
| `initPlatformUser` | 页面启动时尝试通过 App 宿主桥获取用户信息，并同步到本地状态 |
| `initConversations` | 优先从服务端 MySQL 读取会话，失败时回退到本地缓存 |
| `saveConversations` | 本地缓存和服务端会话同步的统一入口 |
| `renderAll` / `createMessageNode` | 渲染聊天消息、按钮、反馈状态和空状态 |
| `sendMessage` | 发送消息的核心流程：追加用户消息、创建线程、发起流式聊天、更新 assistant 气泡 |
| `stopGeneration` | 中断当前流式请求 |
| `newChat` / `resetConversation` / `clearChat` | 会话管理 |
| `getAuthCtx` / `getFeedbackCtx` / `getChatApiCtx` | 给拆分模块注入所需上下文，避免子模块直接依赖全局变量 |
| `bootstrap` | 页面启动入口，串起用户信息、OAuth 回调、题库、会话和 UI 初始化 |

`sendMessage`

1. 读取输入框内容，校验是否为空、是否已有请求在进行。
2. 生成用户消息和临时 assistant 消息，立即渲染到页面。
3. 如果当前会话还没有上游 `threadId`，先调用 `createAgentThread` 创建线程。
4. 调用 `agentChatStream` 读取流式响应。
5. 收到 `progress` 时展示“正在检索知识库”等等待提示。
6. 收到 `message` 时把分片追加到 assistant 消息内容。
7. 收到 `meta` 时保存上游消息 ID，供反馈接口使用。
8. 流结束后保存会话；如果没有正文，展示空回答兜底文案。

### 登录与用户信息代码

登录有两条用户信息来源：

| 来源 | 代码位置 | 说明 |
| --- | --- | --- |
| OAuth | `auth.js` + `server/server.js` | H5 走 OAuth 授权码流程，后端代理 token 和 userinfo，避免前端直接暴露 client_secret |
| App 宿主桥 | `platform-bridge.js` | 在 Android/iOS 宿主环境中调用 `jsGetUserBean` 或 `getLoginUserInfo` 获取登录用户 |

OAuth 流程如下：

1. 用户点击登录按钮，`startAuthFlow` 请求 `/api/auth-config`。
2. 前端拼接授权 URL，带上 `client_id`、`redirect_uri`、`scope`、`state` 后跳转。
3. OAuth 服务回调到 `AUTH_REDIRECT_URI`，URL 上带 `code` 和 `state`。
4. `captureAuthCodeFromUrl` 读取 code，调用 `/api/auth-token` 换取 token。
5. 前端拿到 access token 后调用 `/api/auth-userinfo` 获取用户信息。
6. `applyUserInfoFromResponse` 将 `name`、`phone_number`、`orgName` 映射到页面状态。

为了方便排查登录问题，当前还会把前端实际拿到的用户信息上报到 `/api/auth-userinfo-log`，后端写入 `server-YYYY-MM-DD.log`，事件名为 `auth:userinfo:client`。这类日志包含用户敏感信息，只建议在调试阶段开启或严格限制服务器日志访问权限。

### 聊天流代码

聊天相关代码分布在前端 `chat-api.js` 和后端 `server/server.js`：

| 阶段 | 前端函数 | 后端函数 | 说明 |
| --- | --- | --- | --- |
| 创建线程 | `createAgentThread` | `handleAltThread` | 创建 ai-wiki / ChatbotAgent 线程，并带上用户元信息 |
| 非流式聊天 | `agentChat` | `handleAltChat` | 保留的阻塞式聊天接口，主要用于兼容或调试 |
| 流式聊天 | `agentChatStream` | `handleAltChatStream` | 主聊天链路，前端逐段显示回答 |
| SSE 解析 | `dispatchStreamEvent` | `appendAltStream` / `consumeAltPayload` | 前端解析代理输出，后端解析上游输出 |
| 进度提示 | `onProgress` 回调 | `extractAltProgress` / `writeAltProgress` | 将 ai-wiki 工具事件转换为“正在检索知识库”等提示 |
| 空回答兜底 | `sendMessage` 结束处理 | `ALT_EMPTY_ANSWER` | 避免上游无正文时页面出现空白回复 |

后端流式接口对前端输出的是标准 SSE。常见事件：

- `message`：回答正文分片。
- `progress`：知识库检索、工具调用等等待提示。
- `meta`：上游消息 ID，用于后续反馈。
- `message_end`：本轮响应结束。

### 后端代码说明

后端入口是 `server/server.js`，使用 Node 原生 `http` 模块实现，没有引入 Express。它同时承担三类职责：静态资源服务、业务 API、上游代理。

| 代码区域 | 作用 |
| --- | --- |
| 环境变量常量 | 读取端口、数据库、OAuth、ChatbotAgent、反馈服务等配置 |
| 日志函数 | `appendJsonLog`、`appendAuthUserInfoLog` 写入每日 JSON 行日志 |
| 数据库初始化 | `ensureSchema` 启动时检查并补齐 `messages.external_message_id` |
| CORS / JSON 工具 | `corsHeaders`、`sendJson`、`readBodyJson` 处理通用 HTTP 逻辑 |
| 会话模型规范化 | `normalizeMessage`、`normalizeConversation`、`normalizeUserPayload` |
| MySQL 会话读写 | `fetchUserConversations`、`syncUserConversations` |
| 上游认证 | `requestAltToken`、`getAltAuthToken` 获取 ChatbotAgent Bearer token |
| 聊天响应解析 | `extractAltAnswer`、`stripAltText`、`filterAltText`、`consumeAltPayload` |
| ai-wiki 进度识别 | `collectAltToolCalls`、`formatAltToolProgress`、`extractAltProgress` |
| 反馈 ID 映射 | `resolveFeedbackMessageId` 将流式消息 ID 映射为反馈接口需要的整数 ID |
| OAuth 代理 | `handleAuthToken`、`handleAuthUserInfo` |
| 静态文件服务 | `handleStatic` 将 `h5-chatbot/` 作为前端页面目录 |
| 路由入口 | `http.createServer` 内部按 method + pathname 分发 |

### 后端路由说明

后端路由都集中在 `server.js` 底部的 `http.createServer` 中，讲解时可以直接按表说明。

| 方法 | 路径 | 处理函数 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 内联处理 | 健康检查，确认 Node 服务可访问 |
| `GET` | `/api/auth-config` | 内联处理 | 返回前端发起 OAuth 所需的授权地址、client_id、redirect_uri、scope |
| `POST` | `/api/auth-token` | `handleAuthToken` | 用授权码换 access token / refresh token |
| `GET` | `/api/auth-userinfo` | `handleAuthUserInfo` | 使用 access token 请求 OAuth userinfo |
| `POST` | `/api/auth-userinfo-log` | `handleAuthUserInfoClientLog` | 记录前端实际拿到的用户信息，便于调试 |
| `GET` | `/api/conversations` | `handleConversationsList` | 按 userId 读取会话列表 |
| `POST` | `/api/conversations/sync` | `handleConversationsSync` | 将前端会话快照同步到 MySQL |
| `GET` | `/api/message-meta` | `handleMessageMeta` | 根据本地消息 ID 查询外部消息 ID |
| `POST` | `/api/alt-thread` | `handleAltThread` | 创建上游线程 |
| `POST` | `/api/alt-chat` | `handleAltChat` | 非流式聊天 |
| `POST` | `/api/alt-chat-stream` | `handleAltChatStream` | 流式聊天主接口 |
| `POST` | `/api/feedback` | `handleFeedback` | 提交点赞 / 点踩 |
| `GET` | `/api/feedback` | `handleFeedbackStatus` | 查询某条消息的反馈状态 |
| `POST` | `/api/chat-messages` | `handleChatMessages` | Dify 兼容代理接口 |
| `GET` / `HEAD` | 静态路径 | `handleStatic` | 返回 H5 页面和静态资源 |

### 数据库代码说明

数据库初始化脚本在 `server/sql/init.sql`，核心是三张表：

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `users` | 保存聊天用户 | `user_key`、`active_conversation_key` |
| `conversations` | 保存会话 | `conversation_key`、`title`、`platform`、`dify_conversation_id`、`updated_at_ms` |
| `messages` | 保存消息 | `role`、`content`、`external_message_id`、`position`、`created_at_ms` |

前端会话同步不是逐条消息增量写入，而是把当前用户的会话快照提交给 `/api/conversations/sync`。后端会规范化 payload，然后写入 users、conversations、messages。`external_message_id` 很关键，它把本地消息和上游消息关联起来，点赞 / 点踩时会用它定位上游消息。

### 日志代码说明

日志目录是 `server/logs/`，代码通过 JSON Lines 追加写入，便于用 `grep` / `rg` / 日志采集系统检索。

| 日志 | 典型事件 | 用途 |
| --- | --- | --- |
| `server-YYYY-MM-DD.log` | `server:start`、`feedback:*`、`auth:userinfo:*` | 服务启动、反馈映射、认证用户信息排查 |
| `message-YYYY-MM-DD.log` | `chat:stream:*` 摘要 | 排查某次聊天是否有上游消息 ID、回答长度、线程 ID |
| systemd journal | Node 控制台输出 | 查看启动失败、异常堆栈、控制台调试信息 |

常用排查命令：

```bash
grep "auth:userinfo" server/logs/server-$(date +%F).log
grep "feedback" server/logs/server-$(date +%F).log
grep "chat:stream" server/logs/message-$(date +%F).log
journalctl -u chatbot -n 100 --no-pager
```

### 部署与同步代码说明

部署相关代码主要有三个文件：

| 文件 | 作用 |
| --- | --- |
| `server/start.sh` | Linux 启动脚本，加载 `.env` 后启动 `node server/server.js` |
| `server/start.ps1` | Windows 启动脚本，适合本地开发测试 |
| `deploy/chatbot.service` | systemd 服务定义，用于生产环境守护进程 |
| `scripts/sync-from-github.sh` | 服务器同步脚本，拉取最新代码、按需安装依赖、执行重启和健康检查 |
| `scripts/sync-from-github.env.example` | 同步脚本配置模板，定义分支、安装命令、重启命令、健康检查地址 |

同步脚本启动时会自动读取 `scripts/sync-from-github.env`。如果配置了：

```bash
RESTART_CMD="systemctl restart chatbot"
HEALTHCHECK_URL="http://127.0.0.1:8787/api/health"
```

那么每次同步成功后会自动重启 systemd 服务，并访问健康检查接口确认服务可用。

## 环境准备

### 本地开发 / 测试

- Node.js 18+
- MySQL 8+（5.7 也可用，当前已验证）
- Git

### Linux 服务器

- Linux + `bash`
- Node.js 18+
- MySQL 8+（或兼容版本）
- Git
- 可选：`systemd`、`pm2`、`supervisor`
- 可选：Nginx / Apache 反向代理

## 环境变量

先复制模板：

```bash
cp server/.env.example server/.env
```

### 服务基础配置

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `PORT` | 否 | `8787` | Node 代理监听端口 |
| `CORS_ORIGIN` | 否 | `*` | CORS 允许来源，生产环境建议改为具体域名 |

### ChatbotAgent 配置

| 变量 | 必填 | 默认值 / 行为 | 说明 |
| --- | --- | --- | --- |
| `ALT_API_URL` | 是 | 无 | ChatbotAgent 聊天接口 |
| `ALT_THREAD_URL` | 建议填写 | 若为空则根据 `ALT_API_URL` 推导 | 线程创建接口 |
| `ALT_AGENT_ID` | 否 | `ChatbotAgent` | 智能体 ID |
| `ALT_API_TOKEN` | 二选一 | 空 | 固定 Bearer Token |
| `ALT_AUTH_URL` | 二选一 | 空 | 上游认证接口 |
| `ALT_AUTH_USERNAME` | 配合 `ALT_AUTH_URL` | 空 | 上游认证用户名 |
| `ALT_AUTH_PASSWORD` | 配合 `ALT_AUTH_URL` | 空 | 上游认证密码 |
| `ALT_AUTH_SCOPE` | 否 | 空 | 上游认证 scope |
| `ALT_AUTH_CLIENT_ID` | 否 | 空 | 上游认证 client_id |
| `ALT_AUTH_CLIENT_SECRET` | 否 | 空 | 上游认证 client_secret |

### OAuth 配置

| 变量 | 必填 | 默认值 / 行为 | 说明 |
| --- | --- | --- | --- |
| `AUTH_SERVER_DOMAIN` | 启用认证时必填 | 空 | OAuth 服务域名或基地址 |
| `AUTH_AUTHORIZE_PATH` | 否 | `/seal/oauth2/authorize` | 授权地址路径 |
| `AUTH_TOKEN_PATH` | 否 | `/seal/oauth2/token` | token 地址路径 |
| `AUTH_USERINFO_PATH` | 否 | `/seal/userinfo` | userinfo 地址路径 |
| `AUTH_CLIENT_ID` | 启用认证时必填 | 空 | OAuth client_id |
| `AUTH_CLIENT_SECRET` | 启用认证时必填 | 空 | OAuth client_secret |
| `AUTH_REDIRECT_URI` | 启用认证时必填 | 空 | OAuth 回调地址 |
| `AUTH_SCOPE` | 否 | 空 | OAuth scope |

### MySQL 配置

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DB_HOST` | 否 | `127.0.0.1` | MySQL 主机 |
| `DB_PORT` | 否 | `3306` | MySQL 端口 |
| `DB_USER` | 是 | `root` | MySQL 用户 |
| `DB_PASSWORD` | 是 | 空 | MySQL 密码 |
| `DB_NAME` | 否 | `chatbot` | 数据库名 |
| `DB_CONN_LIMIT` | 否 | `10` | 连接池大小 |

### 反馈与其他上游

| 变量 | 必填 | 默认值 / 行为 | 说明 |
| --- | --- | --- | --- |
| `FEEDBACK_BASE_URL` | 启用反馈时必填 | 无 | 反馈服务基地址 |
| `DIFY_BASE_URL` | 使用 Dify 代理时 | `https://api.dify.ai/v1` | Dify 接口地址 |
| `DIFY_API_KEY` | 使用 Dify 代理时 | 空 | Dify API Key |

## 数据库初始化

初始化脚本：

- [init.sql](server/sql/init.sql)

执行方式：

```sql
source server/sql/init.sql;
```

会创建：

- `users`
- `conversations`
- `messages`

兼容说明：

- `messages` 表需要包含 `external_message_id`
- 旧库缺少该字段时，服务启动时会自动尝试补齐
- 若表结构过旧，仍建议重新执行最新初始化脚本

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
```

### 3. 初始化 MySQL

执行 `server/sql/init.sql`。

### 4. 启动服务

#### Windows

```powershell
cd d:\Code\chatbot
.\server\start.ps1
```

#### Linux

```bash
cd /home/chatbot/chatbot
chmod +x server/start.sh
./server/start.sh
```

也可以直接：

```bash
npm start
```

但推荐优先使用 [start.sh](server/start.sh) 或 [start.ps1](server/start.ps1)，因为它们会自动加载 `server/.env` 和根目录 `.env`。

### 5. 验证启动

```bash
curl http://127.0.0.1:8787/api/health
```

页面地址：

- 本机：`http://127.0.0.1:8787/`
- 局域网：`http://<服务器IP>:8787/`

## Linux 服务器部署

### 推荐目录

```text
/home/chatbot/chatbot
├─ 项目代码
├─ server/.env
└─ server/logs/
```

### 首次部署

1. 克隆仓库

```bash
git clone <your-github-repo> /home/chatbot/chatbot
cd /home/chatbot/chatbot
```

2. 安装依赖

```bash
npm install
```

3. 配置环境变量

```bash
cp server/.env.example server/.env
```

4. 初始化数据库

```bash
mysql -u <user> -p < server/sql/init.sql
```

5. 启动服务

```bash
chmod +x server/start.sh
./server/start.sh
```

6. 验证健康检查

```bash
curl http://127.0.0.1:8787/api/health
```

7. 打开前端页面验证

```text
http://<服务器IP>:8787/
```

### 日常升级

1. 备份 `server/.env`
2. 执行同步脚本或 `git pull`
3. 如果 `package.json` / `package-lock.json` 变化，重新安装依赖
4. 重启服务
5. 访问 `/api/health`
6. 发一条测试消息，检查聊天与反馈是否正常

## Linux 运行脚本

Linux 启动脚本：

- [start.sh](server/start.sh)

脚本作用：

- 自动加载 `server/.env`
- 自动加载项目根目录 `.env`（如存在）
- 自动补默认值 `PORT`、`CORS_ORIGIN`、`DIFY_BASE_URL`
- 打印监听地址和局域网 IP
- 最终通过 `node server/server.js` 启动

前台运行：

```bash
cd /home/chatbot/chatbot
./server/start.sh
```

后台运行：

```bash
cd /home/chatbot/chatbot
nohup ./server/start.sh >> server/logs/server-console.log 2>&1 &
```

重启 `nohup` 方式启动的进程：

```bash
pkill -f "node server/server.js"
cd /home/chatbot/chatbot
nohup ./server/start.sh >> server/logs/server-console.log 2>&1 &
```

## systemd 配置

仓库内已提供服务文件：

- [chatbot.service](deploy/chatbot.service)

### 1. 确认启动脚本可执行

```bash
chmod +x /home/chatbot/chatbot/server/start.sh
sudo chown -R chatbot:chatbot /home/chatbot/chatbot
```

如果你的运行用户不是 `chatbot`，请把下面 service 文件中的 `User` 和 `Group` 改成实际用户。

### 2. 复制服务文件

```bash
sudo cp /home/chatbot/chatbot/deploy/chatbot.service /etc/systemd/system/chatbot.service
```

也可以手动创建：

```bash
sudo nano /etc/systemd/system/chatbot.service
```

内容如下：

```ini
[Unit]
Description=Chatbot H5 Proxy Service
After=network.target
Wants=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/home/chatbot/chatbot
ExecStart=/home/chatbot/chatbot/server/start.sh
Restart=always
RestartSec=3
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

字段说明：

- `User` / `Group`
  - 服务运行用户和用户组
- `WorkingDirectory`
  - 项目根目录
- `ExecStart`
  - 实际启动命令，指向 [start.sh](server/start.sh)
- `Restart=always`
  - 进程异常退出后自动拉起
- `RestartSec=3`
  - 重启前等待 3 秒
- `After=network.target`
  - 先等待网络就绪后再启动

如果你的 MySQL 是 Docker 容器部署，通常不要在这里依赖 `mysql.service`。保留 `After=network.target` 即可；真正关键的是 [server/.env](server/.env) 里的 `DB_HOST` / `DB_PORT` 要能从宿主机访问到容器 MySQL。

### 3. 让 systemd 生效

```bash
sudo systemctl daemon-reload
sudo systemctl enable chatbot
sudo systemctl start chatbot
```

### 4. 查看状态

```bash
sudo systemctl status chatbot
```

### 5. 常用命令

```bash
sudo systemctl start chatbot
sudo systemctl stop chatbot
sudo systemctl restart chatbot
sudo systemctl status chatbot
```

### 6. 查看日志

```bash
sudo journalctl -u chatbot -f
sudo journalctl -u chatbot --since today
```

### 7. 启动失败排查

1. 查看状态

```bash
sudo systemctl status chatbot
```

2. 查看最近日志

```bash
sudo journalctl -u chatbot -n 100 --no-pager
```

3. 手动执行启动脚本

```bash
cd /home/chatbot/chatbot
./server/start.sh
```

## 代码同步脚本

Linux 同步脚本：

- [sync-from-github.sh](scripts/sync-from-github.sh)
- [sync-from-github.env.example](scripts/sync-from-github.env.example)

功能：

- 自动处理 Git `safe.directory`
- 拉取指定分支最新代码
- 本地有未提交改动时中止，避免覆盖
- 仅在依赖变更时自动安装
- 可选执行重启命令
- 可选执行健康检查

首次使用：

```bash
cd /home/chatbot/chatbot
cp scripts/sync-from-github.env.example scripts/sync-from-github.env
bash scripts/sync-from-github.sh
```

推荐配置：

```bash
APP_DIR=/home/chatbot/chatbot
REMOTE_NAME=origin
TARGET_BRANCH=main
RUN_INSTALL=1
INSTALL_CMD="npm ci --omit=dev"
RESTART_CMD="systemctl restart chatbot"
HEALTHCHECK_URL="http://127.0.0.1:8787/api/health"
```

如果暂时不用 `systemd`，同步后也可以手动执行：

```bash
./server/start.sh
```

## 内网离线部署脚本

内网环境不能访问 GitHub 时，可以使用离线包部署脚本：

- [build-offline-bundle.sh](scripts/build-offline-bundle.sh)：在有网机器或构建机上生成离线包
- [deploy-offline-bundle.sh](scripts/deploy-offline-bundle.sh)：在内网服务器上解包、安装 systemd 服务并启动

### 1. 在有网机器生成离线包

建议在和内网服务器系统架构一致的 Linux 机器上打包，避免 `node_modules` 平台不一致。

```bash
cd /home/chatbot/chatbot
bash scripts/build-offline-bundle.sh
```

默认会执行：

```bash
npm ci --omit=dev
```

并生成：

```text
dist/offline/chatbot-offline-<commit>-<time>.tar.gz
```

默认不会打包 `.env`，避免把生产密钥放进离线包。如果确实要一起打包环境配置，可显式执行：

```bash
INCLUDE_ENV=1 bash scripts/build-offline-bundle.sh
```

### 2. 把离线包拷贝到内网服务器

例如：

```bash
scp dist/offline/chatbot-offline-*.tar.gz root@内网服务器:/tmp/
```

内网不通外网时，也可以用 U 盘、堡垒机文件上传等方式传入。

### 3. 在内网服务器部署

服务器需要预先安装 Node.js 18+。如果离线包里已经包含 `node_modules`，内网服务器不需要访问 npm。

```bash
sudo APP_DIR=/home/chatbot/chatbot \
  SERVICE_NAME=chatbot \
  bash /home/chatbot/chatbot/scripts/deploy-offline-bundle.sh /tmp/chatbot-offline-xxx.tar.gz
```

如果脚本还不在服务器上，也可以先解出离线包，再执行包内脚本：

```bash
cd /tmp
tar -xzf chatbot-offline-xxx.tar.gz
sudo APP_DIR=/home/chatbot/chatbot \
  bash chatbot-offline-xxx/scripts/deploy-offline-bundle.sh /tmp/chatbot-offline-xxx.tar.gz
```

部署脚本会：

- 备份已有目录为 `/home/chatbot/chatbot.bak.<时间>`
- 安装新版本到 `/home/chatbot/chatbot`
- 写入 `/etc/systemd/system/chatbot.service`
- 执行 `systemctl daemon-reload`
- 设置开机自启
- 重启服务
- 检查 `http://127.0.0.1:8787/api/health`

### 4. 内网服务器准备 `.env`

如果离线包不包含 `.env`，部署后在服务器创建：

```bash
cd /home/chatbot/chatbot
cp server/.env.example .env
vi .env
```

然后重启：

```bash
sudo systemctl restart chatbot
sudo journalctl -u chatbot -f
```

### 5. 常用参数

```bash
APP_DIR=/opt/chatbot                 # 安装目录
SERVICE_NAME=chatbot                 # systemd 服务名
SERVICE_USER=root                    # systemd 运行用户
SERVICE_GROUP=root                   # systemd 运行用户组
RUN_INSTALL=auto                     # auto|1|0，默认 node_modules 存在就不 npm install
INSTALL_CMD="npm ci --omit=dev"      # 需要安装依赖时使用的命令
CREATE_SYSTEMD=1                     # 是否写 systemd 服务
RESTART_SERVICE=1                    # 是否部署后重启服务
HEALTHCHECK_URL=http://127.0.0.1:8787/api/health
NODE_BIN=/usr/bin/node               # Node 不在 PATH 时指定
```

## 使用说明

### 页面访问

- `http://127.0.0.1:8787/`

如果前端不是从 `8787` 端口打开，建议在设置里将：

- `API Base URL` 设为 `http://127.0.0.1:8787/api`

### 首次进入建议

- 检查 `API Base URL`
- 检查 `User ID`
- 确认后端环境变量已配置好认证、聊天、反馈地址

### 会话历史

- 通过 `/api/conversations` 和 `/api/conversations/sync` 自动读写
- 服务端不可用时会退回本地临时模式
- 恢复后新会话会继续同步到 MySQL

### 反馈

- 回复完成后可点赞 / 点踩
- 点踩需要填写原因
- 当前代理会自动把流式 `lc_run--...` 映射成上游反馈接口需要的整数消息 ID

### 流式进度提示

`/api/alt-chat-stream` 会把 ai-wiki 返回的中间事件转换为安全的前端进度提示。当前主要识别：

- `list_kbs`：正在获取可用知识库
- `query_kb`：正在检索指定知识库，并尽量展示知识库名与关键词
- `get_mindmap`：正在读取知识库结构
- `agent_state`：正在同步检索状态

这些进度只用于改善等待体验，不展示完整工具结果，也不展示模型内部推理链。

### 空回答兜底

如果上游返回 `finished` 但没有可展示内容，或者流式响应结束时没有任何文本，后端会返回统一兜底文案：

```text
抱歉，本次上游服务没有返回可展示的内容。请稍后重试，或换个问法再试一次。
```

前端也会在最终内容为空时做同样兜底，避免用户看到空白气泡。

## 后端接口概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/auth-config` | 获取 OAuth 配置 |
| `POST` | `/api/auth-token` | 授权码换 token |
| `GET` | `/api/auth-userinfo` | 获取用户信息 |
| `POST` | `/api/auth-userinfo-log` | 记录前端实际获取到的用户信息，便于调试 |
| `GET` | `/api/conversations` | 获取会话列表 |
| `POST` | `/api/conversations/sync` | 同步会话 |
| `GET` | `/api/message-meta` | 查询本地消息元信息 |
| `POST` | `/api/alt-thread` | 创建线程 |
| `POST` | `/api/alt-chat` | 阻塞式聊天 |
| `POST` | `/api/alt-chat-stream` | 流式聊天，包含回答分片、消息元信息与检索进度事件 |
| `POST` | `/api/feedback` | 提交反馈 |
| `GET` | `/api/feedback?messageId=...` | 查询反馈状态 |
| `POST` | `/api/chat-messages` | Dify 代理接口 |

### `/api/alt-chat-stream` 事件

Node 代理对前端输出 SSE：

- `event: "message"`：回答正文分片
- `event: "meta"`：外部消息 ID
- `event: "progress"`：等待阶段提示，例如正在检索哪个知识库
- `event: "message_end"`：本轮输出结束

前端只把 `message` 写入最终会话内容；`progress` 只在生成中显示，回复结束后会自动清除。

## 日志说明

日志统一放在 `server/logs/`：

- `server-YYYY-MM-DD.log`
  - 服务启动、反馈错误、反馈 ID 映射日志
- `message-YYYY-MM-DD.log`
  - 聊天消息摘要日志，按消息记录线程、外部消息 ID、回答长度和简短预览
- `server-console.log`
  - `nohup` 方式启动时的标准输出与标准错误

## 常见问题与排障

### 1. 页面提示“请求失败，请检查代理服务是否已启动”

先检查：

```bash
curl http://127.0.0.1:8787/api/health
```

再确认：

- 端口 `8787` 是否监听
- `API Base URL` 是否正确
- 是否真的用 [start.sh](server/start.sh) 或 [start.ps1](server/start.ps1) 启动了服务

### 2. 页面能打开，但聊天失败

优先检查：

- `ALT_API_URL`
- `ALT_THREAD_URL`
- `ALT_AUTH_URL`
- 上游网络是否可达

### 3. 聊天时一直停留在“正在思考”

优先检查：

- 浏览器控制台是否持续收到 `/api/alt-chat-stream` 数据
- [server/logs](server/logs) 下当天的 `message-YYYY-MM-DD.log` 是否记录本轮请求
- ai-wiki 是否返回 `list_kbs`、`query_kb`、`get_mindmap` 等工具事件
- `ALT_API_URL` 是否指向 ai-wiki 的 `/api/chat/agent/{agent_id}` 接口

如果 ai-wiki 有工具事件，前端会显示类似“正在检索知识库「xxx」”的提示；如果上游最终没有正文，前端会显示空回答兜底文案。

### 4. OAuth 登录失败

优先检查：

- `AUTH_SERVER_DOMAIN`
- `AUTH_CLIENT_ID`
- `AUTH_CLIENT_SECRET`
- `AUTH_REDIRECT_URI`

### 5. 看不到历史会话

优先检查：

- MySQL 是否可连接
- 是否执行了 [init.sql](server/sql/init.sql)
- `messages` 表是否包含 `external_message_id`

### 6. 反馈失败

优先检查：

- `FEEDBACK_BASE_URL`
- 上游认证是否正常
- [server/logs](server/logs) 下当天的 `server-YYYY-MM-DD.log` 里的 `feedback:error`
- [server/logs](server/logs) 下当天的 `message-YYYY-MM-DD.log` 是否记录了外部消息 ID 与回答摘要

### 7. 服务器同步脚本失败

常见原因：

- 工作区有未提交改动
- 当前目录不是 Git 仓库
- `git` / `npm` 缺失
- `RESTART_CMD` 配置错误
- 健康检查未通过

## 安全建议

- 不要把真实密钥写进前端代码
- 生产环境不要把 `CORS_ORIGIN` 设为 `*`
- 对外部署建议使用 HTTPS + 反向代理
- `server/.env` 不要提交到 Git
- 生产数据库不要直接使用高权限 `root`
