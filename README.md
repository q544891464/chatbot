# H5 Chatbot（Dify）

一个适配手机的 H5 聊天机器人示例：

- 前端：`h5-chatbot/`（移动端 UI）
- 后端代理：`server/server.js`（隐藏 Dify Key + 解决 CORS）

## 运行

推荐直接启动后端代理（会同时提供静态页面 + `/api` 代理）：

PowerShell：

```powershell
cd d:\Code\chatbot
# 推荐：把密钥写到 server/.env（已在 .gitignore 中忽略，不要提交到 git）
Copy-Item server\.env.example server\.env -Force
# 编辑 server/.env，把 DIFY_API_KEY 改成你自己的 app-...；DIFY_BASE_URL 可保持默认或改成你的地址
.\server\start.ps1
```

然后用浏览器打开：`http://localhost:8787/`

## 配置 Dify

打开页面后点“设置”，填写：

- `API Base URL`
  - 使用后端代理（推荐）：`/api` 或 `http://localhost:8787/api`
  - 直连 Dify：`https://api.dify.ai/v1`（或自建 `https://你的域名/v1`）
- `API Key`
  - 使用后端代理时可留空（Key 由服务端 `DIFY_API_KEY` 提供）
  - 直连 Dify 才需要填写（不推荐用于生产）
- `User ID`：任意字符串，用于 Dify 侧区分用户

## 注意

- 生产环境建议设置 `CORS_ORIGIN` 为你的站点域名，而不是 `*`
- 不要把 `DIFY_API_KEY` 放到前端（浏览器可见）
- Conversation data is stored in `server/data/conversations.json` (ignored by git).
