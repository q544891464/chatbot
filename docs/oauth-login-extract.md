# OAuth 登录逻辑提取说明

本文档用于把当前 `chatbot` 项目的登录逻辑迁移到其他项目。

当前项目里有两类用户识别逻辑：

- 宿主 App SDK 用户信息：`h5-chatbot/platform-bridge.js`
- OAuth 授权码登录：`h5-chatbot/auth.js` + `server/server.js` 中的 `/api/auth-*`

如果另一个项目是普通 Web/H5 项目，优先迁移 OAuth 这条链路。

## 一、整体流程

```text
前端点击登录
  -> GET /api/auth-config 获取授权地址、client_id、redirect_uri、scope
  -> 跳转 OAuth authorize 页面
  -> OAuth 服务回跳 redirect_uri?code=xxx&state=yyy
  -> 前端读取 code/state
  -> POST /api/auth-token 用 code 换 access_token
  -> GET /api/auth-userinfo 带 Bearer token 获取用户信息
  -> 前端保存 token 和用户信息
```

## 二、需要迁移的前端文件

### 1. `h5-chatbot/auth.js`

这是核心 OAuth 前端模块，包含：

- `loadAuthState()`
- `saveAuthState()`
- `updateAuthDisplay()`
- `startAuthFlow()`
- `captureAuthCodeFromUrl()`
- `tryLoginWithStoredToken()`

迁移时依赖 `utils.js` 中三个函数：

- `safeJsonParse`
- `readResponseError`
- `formatRuntimeError`

你可以直接复制这三个工具函数，或在新项目里用等价实现替代。

### 2. 页面初始化调用顺序

当前项目在 `h5-chatbot/app.js` 的 `bootstrap()` 中调用：

```js
const hasAuthCode = captureAuthCodeFromUrl(getAuthCtx());

if (!hasAuthCode) {
  const result = await tryLoginWithStoredToken(getAuthCtx());
  if (result.needsAuth) {
    startAuthFlow(getAuthCtx());
    return;
  }
}
```

新项目可以简化为：

```js
const authCtx = {
  state,
  el,
  getStoreBase: () => "/api",
  setTips: (text) => console.log(text),
  onUserInfo: (userInfo) => {
    console.log("logged in user:", userInfo);
  },
};

const hasAuthCode = captureAuthCodeFromUrl(authCtx);

if (!hasAuthCode) {
  const result = await tryLoginWithStoredToken(authCtx);
  if (result.needsAuth) {
    await startAuthFlow(authCtx);
  }
}
```

登录按钮：

```js
loginButton.addEventListener("click", () => startAuthFlow(authCtx));
```

## 三、需要迁移的后端接口

当前后端在 `server/server.js` 里提供三个接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/auth-config` | 返回前端发起 OAuth 跳转需要的配置 |
| `POST` | `/api/auth-token` | 用授权码换 token |
| `GET` | `/api/auth-userinfo` | 用 access token 获取用户信息 |

### 1. `/api/auth-config`

返回：

```json
{
  "authorizeUrlBase": "https://example.com/seal/oauth2/authorize",
  "clientId": "your-client-id",
  "redirectUri": "https://your-site.example.com/",
  "scope": "openid profile phone email address"
}
```

### 2. `/api/auth-token`

请求：

```json
{
  "code": "oauth-code",
  "redirectUri": "https://your-site.example.com/"
}
```

后端向 OAuth token 接口发送：

```http
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
client_id=...
client_secret=...
code=...
redirect_uri=...
```

### 3. `/api/auth-userinfo`

前端请求：

```http
Authorization: Bearer <access_token>
```

后端原样转发到 OAuth userinfo 接口。

## 四、环境变量

另一个项目后端需要配置：

```env
AUTH_SERVER_DOMAIN=impre.zdxlz.com:18442
AUTH_AUTHORIZE_PATH=/seal/oauth2/authorize
AUTH_TOKEN_PATH=/seal/oauth2/token
AUTH_USERINFO_PATH=/seal/userinfo
AUTH_CLIENT_ID=replace-with-your-client-id
AUTH_CLIENT_SECRET=replace-with-your-client-secret
AUTH_REDIRECT_URI=https://your-site.example.com/
AUTH_SCOPE=openid profile phone email address
```

说明：

- `AUTH_SERVER_DOMAIN` 可以带 `https://`，也可以只写域名和端口。
- `AUTH_REDIRECT_URI` 必须和 OAuth 服务登记的回调地址一致。
- `AUTH_CLIENT_SECRET` 只能放后端，不要放前端。

## 五、建议改进点

当前项目的 OAuth 逻辑可以迁移，但建议在新项目中做以下增强。

### 1. state 必须严格校验

建议逻辑：

```js
if (!returnedState || !expectedState || returnedState !== expectedState) {
  throw new Error("OAuth state 校验失败");
}
```

不要允许回调缺少 `state`。

### 2. state 建议使用 crypto 生成

```js
function createOAuthState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
```

### 3. token 存储方式

当前项目把 token 存在 `localStorage`，迁移到生产项目时更推荐：

- 后端用 HttpOnly + SameSite Cookie 保存登录态
- 前端不直接持有 refresh_token
- 设置面板不要完整展示 access_token / refresh_token

如果短期仍用 `localStorage`，至少不要在 UI 中完整展示 token。

## 六、最小迁移清单

前端：

- 复制 `h5-chatbot/auth.js`
- 复制或替换 `safeJsonParse`、`readResponseError`、`formatRuntimeError`
- 在应用启动时调用 `captureAuthCodeFromUrl`
- 登录按钮调用 `startAuthFlow`
- 用 `tryLoginWithStoredToken` 做静默登录
- 实现 `onUserInfo(userInfo)`，把用户信息写入你的业务状态

后端：

- 复制 `buildAuthUrl`
- 复制 `/api/auth-config`
- 复制 `handleAuthToken`
- 复制 `handleAuthUserInfo`
- 配置 OAuth 环境变量

## 七、和 Chatbot 项目耦合的部分

迁移时可以删掉这些：

- 设置弹窗里的 token 展示
- `updateAuthDisplay`
- 和会话 `userId` 绑定的逻辑
- `platform-bridge.js`，除非你的另一个项目也运行在 Android/iOS 宿主 App 里

