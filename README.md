# AI 人力助手（H5 Chatbot）

一个面向移动端优先场景的 H5 聊天助手项目，采用“前端静态页面 + Node 代理服务 + MySQL 会话存储”的一体化结构。当前主链路为：

- 前端：`h5-chatbot`
- 后端代理：`server`
- 数据存储：MySQL
- 上游服务：ChatbotAgent、OAuth、反馈服务

当前仓库中还存在 `dify-智能助手` 目录，但它更偏原型/实验项目，不作为当前主部署路径。实际部署、启动、同步和运维都以 `h5-chatbot + server` 为准。

## 功能概览

- ChatbotAgent 流式聊天
- OAuth 登录与用户信息拉取
- MySQL 会话持久化
- 点赞 / 点踩反馈
- Markdown、链接、图片展示
- H5 移动端适配
- Linux 服务器一键同步脚本

## 架构说明

### 组件角色

- 浏览器 / H5 前端
  - 页面入口在 `h5-chatbot/index.html`
  - 负责消息输入、历史展示、认证触发、反馈交互
- Node 代理层
  - 服务入口在 `server/server.js`
  - 提供静态文件访问、会话同步、认证代理、聊天代理、反馈代理
- MySQL
  - 存储用户、会话、消息
  - 初始化 SQL 位于 `server/sql/init.sql`
- 上游 ChatbotAgent
  - 负责线程创建与聊天能力
- 上游 OAuth 服务
  - 负责授权码换 token 与 userinfo
- 上游反馈服务
  - 负责消息点赞 / 点踩状态写入与查询

### 主数据流

1. 用户在 H5 页面输入问题。
2. 前端先调用 `/api/alt-thread` 创建线程；若已有线程则复用。
3. 前端调用 `/api/alt-chat-stream` 发起流式聊天。
4. Node 代理转发到上游 ChatbotAgent，并将流式内容转回前端。
5. 前端展示回答，同时把会话通过 `/api/conversations/sync` 写回 MySQL。
6. 用户对回答点赞或点踩时，前端调用 `/api/feedback`，Node 再转发到上游反馈服务。
7. OAuth 登录流程通过 `/api/auth-config`、`/api/auth-token`、`/api/auth-userinfo` 由 Node 代理完成。

## 目录结构

```text
.
├─ h5-chatbot/                  # H5 前端
│  ├─ index.html                # 页面入口
│  ├─ styles.css                # 样式
│  ├─ app.js                    # 页面主逻辑
│  ├─ auth.js                   # OAuth 认证逻辑
│  ├─ chat-api.js               # 聊天 API 封装
│  ├─ feedback.js               # 点赞/点踩逻辑
│  ├─ markdown.js               # Markdown 渲染
│  ├─ utils.js                  # 通用工具函数
│  ├─ platform-bridge.js        # 宿主平台桥接
│  ├─ question-bank.json        # 默认问题库
│  └─ static/                   # 静态资源
├─ server/                      # Node 代理与会话存储服务
│  ├─ server.js                 # 服务入口
│  ├─ start.ps1                 # Windows 启动脚本
│  ├─ .env.example              # 环境变量模板
│  ├─ sql/init.sql              # MySQL 初始化脚本
│  └─ data/                     # 运行期数据/缓存目录
├─ scripts/
│  ├─ sync-from-github.sh       # Linux 服务器代码同步脚本
│  └─ sync-from-github.env.example
├─ docs/                        # 项目文档
└─ package.json                 # Node 项目配置
```

## 环境准备

### 本地开发 / 测试

- Node.js 18+
- MySQL 8+
- Git

### Linux 服务器部署

- Linux 服务器可执行 `bash`
- Node.js 18+
- MySQL 8+
- Git
- 可选：`systemd` 或其他进程守护工具
- 可选：Nginx / Apache 等反向代理

## 环境变量配置

建议先复制模板：

```bash
cp server/.env.example server/.env
```

Windows 可手动复制，或直接新建 `server/.env`。

### 服务基础配置

| 变量名 | 是否必填 | 默认值 | 用途 | 典型场景 |
| --- | --- | --- | --- | --- |
| `PORT` | 否 | `8787` | Node 代理监听端口 | 本地运行、服务器监听端口 |
| `CORS_ORIGIN` | 否 | `*` | CORS 允许来源 | 生产环境建议改为具体域名 |

### ChatbotAgent 配置

| 变量名 | 是否必填 | 默认值 / 默认行为 | 用途 | 典型场景 |
| --- | --- | --- | --- | --- |
| `ALT_API_URL` | 是 | 无安全默认值 | ChatbotAgent 聊天接口地址 | 流式/阻塞式聊天 |
| `ALT_THREAD_URL` | 建议填写 | 若为空则尝试由 `ALT_API_URL` 推导 | ChatbotAgent 线程创建接口 | 首次发消息前创建线程 |
| `ALT_AGENT_ID` | 否 | `ChatbotAgent` | 上游 Agent 标识 | 多 Agent 场景区分实例 |
| `ALT_API_TOKEN` | 二选一 | 空 | 直接使用固定 Bearer Token | 上游支持固定 token 时 |
| `ALT_AUTH_URL` | 二选一 | 空 | 上游认证接口地址 | 需要用户名密码换 token 时 |
| `ALT_AUTH_USERNAME` | 与 `ALT_AUTH_URL` 配套必填 | 空 | 上游认证用户名 | 上游 password grant |
| `ALT_AUTH_PASSWORD` | 与 `ALT_AUTH_URL` 配套必填 | 空 | 上游认证密码 | 上游 password grant |
| `ALT_AUTH_SCOPE` | 否 | 空 | 上游认证 scope | 认证服务要求 scope 时 |
| `ALT_AUTH_CLIENT_ID` | 否 | 空 | 上游认证 client_id | 认证服务要求客户端信息时 |
| `ALT_AUTH_CLIENT_SECRET` | 否 | 空 | 上游认证 client_secret | 认证服务要求客户端密钥时 |

说明：

- `ALT_API_TOKEN` 和 `ALT_AUTH_URL` 至少要有一种可用。
- 如果配置了 `ALT_AUTH_URL`，服务会优先走动态获取 token。

### OAuth 配置

| 变量名 | 是否必填 | 默认值 / 默认行为 | 用途 | 典型场景 |
| --- | --- | --- | --- | --- |
| `AUTH_SERVER_DOMAIN` | 认证功能必填 | 空 | OAuth 服务域名或基础地址 | 登录授权 |
| `AUTH_AUTHORIZE_PATH` | 否 | `/seal/oauth2/authorize` | OAuth 授权地址路径 | 浏览器跳转授权 |
| `AUTH_TOKEN_PATH` | 否 | `/seal/oauth2/token` | OAuth token 地址路径 | 授权码换 token |
| `AUTH_USERINFO_PATH` | 否 | `/seal/userinfo` | OAuth userinfo 地址路径 | 查询用户资料 |
| `AUTH_CLIENT_ID` | 认证功能必填 | 空 | OAuth 客户端 ID | 登录授权 |
| `AUTH_CLIENT_SECRET` | 认证功能必填 | 空 | OAuth 客户端密钥 | 授权码换 token |
| `AUTH_REDIRECT_URI` | 认证功能必填 | 空 | OAuth 回调地址 | 浏览器授权回调 |
| `AUTH_SCOPE` | 否 | 空 | OAuth scope | `openid profile phone email address` 等 |

### MySQL 配置

| 变量名 | 是否必填 | 默认值 | 用途 | 典型场景 |
| --- | --- | --- | --- | --- |
| `DB_HOST` | 否 | `127.0.0.1` | MySQL 主机地址 | 本地或远程数据库 |
| `DB_PORT` | 否 | `3306` | MySQL 端口 | MySQL 标准端口 |
| `DB_USER` | 是 | `root` | MySQL 用户名 | 会话存储连接 |
| `DB_PASSWORD` | 是 | 空 | MySQL 密码 | 会话存储连接 |
| `DB_NAME` | 否 | `chatbot` | 数据库名 | 项目专用库 |
| `DB_CONN_LIMIT` | 否 | `10` | MySQL 连接池大小 | 并发连接控制 |

### 反馈与其他上游

| 变量名 | 是否必填 | 默认值 / 默认行为 | 用途 | 典型场景 |
| --- | --- | --- | --- | --- |
| `FEEDBACK_BASE_URL` | 反馈功能必填 | 空 | 反馈服务基础地址 | 点赞/点踩、查询反馈状态 |
| `DIFY_BASE_URL` | 仅 Dify 代理功能使用 | `https://api.dify.ai/v1` | Dify 接口地址 | `/api/chat-messages` |
| `DIFY_API_KEY` | 仅 Dify 代理功能使用 | 空 | Dify API Key | Dify 上游代理 |

## 数据库初始化

初始化脚本路径：

- [init.sql](/d:/Code/chatbot/server/sql/init.sql)

执行方式：

```sql
source server/sql/init.sql;
```

或者使用任意 MySQL 客户端导入该 SQL 文件。

初始化后会创建：

- `users`
- `conversations`
- `messages`

兼容说明：

- 当前 `messages` 表需要包含 `external_message_id` 字段
- 旧库如果缺少该字段，服务启动时会尝试自动补齐
- 如果表不存在或字段缺失严重，仍建议重新执行最新初始化脚本

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
```

然后按实际环境修改 `server/.env`。

### 3. 初始化 MySQL

执行 `server/sql/init.sql`。

### 4. 启动服务

#### Windows（推荐）

```powershell
cd d:\Code\chatbot
.\server\start.ps1
```

脚本会自动读取：

- `server/.env`
- 项目根目录 `.env`（如存在）

#### 通用（Linux / 容器）

```bash
cd /path/to/chatbot
node server/server.js
```

或：

```bash
npm start
```

### 5. 验证启动

访问健康检查：

```bash
curl http://127.0.0.1:8787/api/health
```

页面访问地址：

- 本机：`http://127.0.0.1:8787/`
- 局域网：`http://<服务器IP>:8787/`
- 反向代理后：`http(s)://你的域名/`

## Linux 服务器部署

### 推荐目录

```text
/srv/chatbot
├─ 当前项目代码
├─ server/.env
└─ logs / systemd / nginx 等外围配置
```

### 首次部署流程

1. 克隆仓库到服务器

```bash
git clone <your-github-repo> /srv/chatbot
cd /srv/chatbot
```

2. 安装依赖

```bash
npm install
```

3. 配置环境变量

```bash
cp server/.env.example server/.env
```

4. 修改 `server/.env`

5. 初始化 MySQL

```bash
mysql -u <user> -p < server/sql/init.sql
```

6. 启动服务

```bash
node server/server.js
```

或接入 `systemd` / `pm2` 等进程守护。

7. 验证健康检查

```bash
curl http://127.0.0.1:8787/api/health
```

8. 打开页面验证聊天链路

### 日常升级流程

1. 备份 `server/.env`
2. 执行同步脚本或手动 `git pull`
3. 如依赖变化则重新安装
4. 重启服务
5. 访问健康检查
6. 做最小功能验证：页面打开、线程创建、聊天、会话同步

## 代码同步脚本

仓库内提供 Linux 服务器一键同步脚本：

- [sync-from-github.sh](/d:/Code/chatbot/scripts/sync-from-github.sh)
- [sync-from-github.env.example](/d:/Code/chatbot/scripts/sync-from-github.env.example)

### 设计目标

用于服务器上快速拉取 GitHub 最新代码，适合版本迭代和日常发布。

脚本默认行为：

- 自动处理 Git `safe.directory`
- 拉取指定远程分支最新代码
- 本地工作区存在未提交修改时直接中止，避免覆盖
- 仅在 `package.json` 或 `package-lock.json` 变化时自动安装依赖
- 可选执行重启命令
- 可选执行健康检查

### 首次使用

```bash
cd /path/to/chatbot
cp scripts/sync-from-github.env.example scripts/sync-from-github.env
chmod +x scripts/sync-from-github.sh
set -a
source scripts/sync-from-github.env
set +a
./scripts/sync-from-github.sh
```

### 常用方式

同步当前分支：

```bash
./scripts/sync-from-github.sh
```

同步指定分支：

```bash
./scripts/sync-from-github.sh main
```

### 同步脚本环境变量

| 变量名 | 是否必填 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `APP_DIR` | 否 | 脚本自动推断仓库根目录 | 项目根目录 |
| `REMOTE_NAME` | 否 | `origin` | Git 远程名称 |
| `TARGET_BRANCH` | 否 | 当前分支 | 目标分支 |
| `RUN_INSTALL` | 否 | `1` | 是否自动安装依赖 |
| `INSTALL_CMD` | 否 | `npm ci --omit=dev` | 依赖安装命令 |
| `RESTART_CMD` | 否 | 空 | 同步后执行的重启命令 |
| `HEALTHCHECK_URL` | 否 | 空 | 同步后健康检查地址 |

### 推荐服务器配置

```bash
APP_DIR=/srv/chatbot
REMOTE_NAME=origin
TARGET_BRANCH=main
RUN_INSTALL=1
INSTALL_CMD="npm ci --omit=dev"
RESTART_CMD="systemctl restart chatbot"
HEALTHCHECK_URL="http://127.0.0.1:8787/api/health"
```

### 失败条件说明

以下情况脚本会直接中止：

- 当前目录不是 Git 仓库
- 工作区存在未提交修改
- 当前处于 detached HEAD 且未手动指定目标分支
- `git` 或 `npm` 不存在
- 健康检查失败（若配置了 `HEALTHCHECK_URL`）

说明：

- 该脚本适合 Linux 服务器，不替代 Windows 的 [start.ps1](/d:/Code/chatbot/server/start.ps1)
- 若你使用 `systemd` 或 `pm2`，请把实际重启命令写入 `RESTART_CMD`

## 使用说明

### 页面访问

推荐直接访问：

- `http://127.0.0.1:8787/`

如果前端不是从 `8787` 端口打开，建议在设置里把：

- `API Base URL` 填为 `http://127.0.0.1:8787/api`

### 首次进入建议

首次打开页面后，优先检查或配置：

- `API Base URL`
- `User ID`
- 认证相关配置是否已由服务端提供

### 聊天使用路径

1. 打开页面
2. 输入问题
3. 系统自动创建线程
4. 开始流式返回答案
5. 会话自动同步到 MySQL

### 会话历史

- 会话会通过 `/api/conversations` 与 `/api/conversations/sync` 自动读写
- 如果服务端存储不可用，页面会回退到本地临时模式
- 存储恢复后，新的会话会继续同步到 MySQL

### 认证

- 页面支持 OAuth 登录
- 如果缓存 token 失效，页面会提示重新认证
- 若认证配置不完整，需先检查服务端环境变量

### 点赞 / 点踩

- 回答生成完成后可点赞或点踩
- 点踩需要填写原因
- 如果消息还没有外部消息 ID，反馈可能会失败，此时应先检查消息是否已成功同步

### 推荐测试消息

可以先用这些问题验证链路：

- `你好`
- `请介绍一下干部问责管理`
- `五险一金的缴纳比例`

## 后端接口概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/auth-config` | 获取 OAuth 配置 |
| `POST` | `/api/auth-token` | 授权码换 token |
| `GET` | `/api/auth-userinfo` | 获取用户信息 |
| `GET` | `/api/conversations` | 获取会话列表 |
| `POST` | `/api/conversations/sync` | 同步会话列表 |
| `POST` | `/api/alt-thread` | 创建 ChatbotAgent 线程 |
| `POST` | `/api/alt-chat` | 阻塞式聊天 |
| `POST` | `/api/alt-chat-stream` | 流式聊天 |
| `POST` | `/api/feedback` | 提交点赞/点踩 |
| `GET` | `/api/feedback?messageId=...` | 查询反馈状态 |
| `POST` | `/api/chat-messages` | Dify 代理接口 |

## 常见问题与排障

### 1. 页面提示“请求失败，请检查代理服务是否启动”

优先检查：

```bash
curl http://127.0.0.1:8787/api/health
```

如果失败：

- 检查 `node server/server.js` 或 `.\server\start.ps1` 是否已启动
- 检查端口 `8787` 是否被占用
- 检查 `API Base URL` 是否正确

### 2. 页面能打开，但聊天失败

优先排查：

- `ALT_API_URL`
- `ALT_THREAD_URL`
- `ALT_AUTH_URL`
- 上游 ChatbotAgent 是否可达

建议先验证：

- 线程创建是否成功
- 上游认证是否成功
- 健康检查是否正常

### 3. OAuth 登录失败

优先检查：

- `AUTH_SERVER_DOMAIN`
- `AUTH_CLIENT_ID`
- `AUTH_CLIENT_SECRET`
- `AUTH_REDIRECT_URI`

如果是 userinfo 失败，还要检查：

- access token 是否失效
- OAuth 上游 userinfo 接口是否可达

### 4. 看不到历史会话

优先检查：

- MySQL 连接是否正常
- 是否已执行 [init.sql](/d:/Code/chatbot/server/sql/init.sql)
- `messages` 表是否包含 `external_message_id`
- `/api/conversations` 是否返回正常

### 5. 点赞 / 点踩失败

优先检查：

- `FEEDBACK_BASE_URL`
- 上游认证是否正常
- 当前消息是否已经拿到外部 `messageId`

### 6. 反向代理 502

优先检查：

- Node 服务实际监听端口是否与代理配置一致
- 本机是否能访问 `http://127.0.0.1:<PORT>/api/health`
- Nginx / Apache upstream 是否指向正确端口

### 7. 服务器同步脚本执行失败

常见原因：

- 服务器工作区有未提交修改
- 当前不是 Git 仓库
- 当前分支处于 detached HEAD
- 没装 `git` 或 `npm`
- 重启命令配置错误
- 健康检查未通过

## 安全建议

- 不要把真实密钥写进前端代码
- 生产环境不要把 `CORS_ORIGIN` 设置为 `*`
- 对外部署建议使用 HTTPS + 反向代理
- `server/.env` 不要提交到 GitHub
- 上游服务账号密码和 token 建议通过服务器环境变量或密钥管理方案注入
- 生产环境数据库建议使用独立账号，不要直接使用高权限 root
