# AI 产品助手（H5 Chatbot）

这是一个面向移动端优先场景的 H5 聊天助手项目。当前主链路为：

- 前端：`h5-chatbot`
- 代理服务：`server`
- 会话存储：MySQL
- 上游服务：ChatbotAgent、OAuth、反馈接口

仓库里还包含 `dify-智能助手` 目录，但它更偏原型/实验项目，不作为当前主部署路径。实际运行、部署、同步、排障均以 `h5-chatbot + server` 为准。

## 功能概览

- ChatbotAgent 流式聊天
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
5. 前端实时展示回答，并通过 `/api/conversations/sync` 把会话写回 MySQL。
6. 用户点赞 / 点踩时，前端调用 `/api/feedback`，Node 再转发到上游反馈服务。
7. OAuth 登录通过 `/api/auth-config`、`/api/auth-token`、`/api/auth-userinfo` 完成。

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
│     └─ alt-stream-YYYY-MM-DD.log
├─ scripts/
│  ├─ sync-from-github.sh
│  └─ sync-from-github.env.example
├─ deploy/
│  └─ chatbot.service
├─ docs/
└─ package.json
```

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

- [init.sql](/d:/Code/chatbot/server/sql/init.sql)

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

但推荐优先使用 [start.sh](/d:/Code/chatbot/server/start.sh)，因为它会自动加载 `server/.env` 和根目录 `.env`。

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

### 日常升级

1. 备份 `server/.env`
2. 执行同步脚本或手动 `git pull`
3. 若依赖变化则重新安装
4. 重启服务
5. 检查 `/api/health`
6. 验证页面、建线程、聊天、会话同步、反馈

## Linux 运行脚本

Linux 启动脚本：

- [start.sh](/d:/Code/chatbot/server/start.sh)

典型用法：

```bash
cd /home/chatbot/chatbot
chmod +x server/start.sh
./server/start.sh
```

后台运行示例：

```bash
nohup ./server/start.sh >> server/logs/server-console.log 2>&1 &
```

## systemd 配置

仓库内已提供模板：

- [chatbot.service](/d:/Code/chatbot/deploy/chatbot.service)

### 1. 准备权限

```bash
chmod +x /home/chatbot/chatbot/server/start.sh
sudo chown -R chatbot:chatbot /home/chatbot/chatbot
```

如果你不是用 `chatbot` 用户部署，请把 service 文件里的 `User` 和 `Group` 改成实际用户。

### 2. 复制服务文件

```bash
sudo cp /home/chatbot/chatbot/deploy/chatbot.service /etc/systemd/system/chatbot.service
```

### 3. 按需编辑

```bash
sudo nano /etc/systemd/system/chatbot.service
```

模板内容如下：

```ini
[Unit]
Description=Chatbot H5 Proxy Service
After=network.target mysql.service
Wants=network.target

[Service]
Type=simple
User=chatbot
Group=chatbot
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
  - 实际启动命令，指向 [start.sh](/d:/Code/chatbot/server/start.sh)
- `Restart=always`
  - 进程异常退出后自动拉起
- `RestartSec=3`
  - 重启前等待 3 秒
- `After=network.target mysql.service`
  - 等网络和 MySQL 就绪后再启动

如果你的 MySQL 服务名不是 `mysql.service`，可以改成：

- `mysqld.service`
- 或只保留 `After=network.target`

### 4. 让 systemd 生效

```bash
sudo systemctl daemon-reload
sudo systemctl enable chatbot
sudo systemctl start chatbot
```

### 5. 查看状态

```bash
sudo systemctl status chatbot
```

### 常用命令

```bash
sudo systemctl start chatbot
sudo systemctl stop chatbot
sudo systemctl restart chatbot
sudo systemctl status chatbot
```

### 查看日志

```bash
sudo journalctl -u chatbot -f
sudo journalctl -u chatbot --since today
```

### 启动失败排查

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

- [sync-from-github.sh](/d:/Code/chatbot/scripts/sync-from-github.sh)
- [sync-from-github.env.example](/d:/Code/chatbot/scripts/sync-from-github.env.example)

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
chmod +x scripts/sync-from-github.sh
set -a
source scripts/sync-from-github.env
set +a
./scripts/sync-from-github.sh
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

## 后端接口概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/auth-config` | 获取 OAuth 配置 |
| `POST` | `/api/auth-token` | 授权码换 token |
| `GET` | `/api/auth-userinfo` | 获取用户信息 |
| `GET` | `/api/conversations` | 获取会话列表 |
| `POST` | `/api/conversations/sync` | 同步会话 |
| `GET` | `/api/message-meta` | 查询本地消息元信息 |
| `POST` | `/api/alt-thread` | 创建线程 |
| `POST` | `/api/alt-chat` | 阻塞式聊天 |
| `POST` | `/api/alt-chat-stream` | 流式聊天 |
| `POST` | `/api/feedback` | 提交反馈 |
| `GET` | `/api/feedback?messageId=...` | 查询反馈状态 |
| `POST` | `/api/chat-messages` | Dify 代理接口 |

## 常见问题与排障

### 1. 页面提示“请求失败，请检查代理服务是否已启动”

先检查：

```bash
curl http://127.0.0.1:8787/api/health
```

再确认：

- 端口 `8787` 是否监听
- `API Base URL` 是否正确
- 是否真的用 [start.sh](/d:/Code/chatbot/server/start.sh) 或 [start.ps1](/d:/Code/chatbot/server/start.ps1) 启动了服务

### 2. 页面能打开，但聊天失败

优先检查：

- `ALT_API_URL`
- `ALT_THREAD_URL`
- `ALT_AUTH_URL`
- 上游网络是否可达

### 3. OAuth 登录失败

优先检查：

- `AUTH_SERVER_DOMAIN`
- `AUTH_CLIENT_ID`
- `AUTH_CLIENT_SECRET`
- `AUTH_REDIRECT_URI`

### 4. 看不到历史会话

优先检查：

- MySQL 是否可连接
- 是否执行了 [init.sql](/d:/Code/chatbot/server/sql/init.sql)
- `messages` 表是否包含 `external_message_id`

### 5. 反馈失败

优先检查：

- `FEEDBACK_BASE_URL`
- 上游认证是否正常
- [server/logs](/d:/Code/chatbot/server/logs) 目录下当天的 `server-YYYY-MM-DD.log` 中的 `feedback:error`
- [server/logs](/d:/Code/chatbot/server/logs) 目录下当天的 `alt-stream-YYYY-MM-DD.log` 中是否已拿到流式消息 ID

### 6. 服务器同步脚本失败

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
