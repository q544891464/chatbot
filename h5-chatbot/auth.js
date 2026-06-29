import {
  formatRuntimeError,
  readResponseError,
  safeJsonParse,
} from "./utils.js";

const AUTH_STORAGE_KEY = "h5ChatbotAuth:v1";
const AUTH_RETURN_URL_KEY = "h5ChatbotAuthReturnUrl:v1";

function getCurrentReturnUrl() {
  const params = new URLSearchParams(window.location.search || "");
  params.delete("code");
  params.delete("state");
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
}

function saveAuthReturnUrl() {
  localStorage.setItem(AUTH_RETURN_URL_KEY, getCurrentReturnUrl());
}

function consumeAuthReturnUrl() {
  const returnUrl = String(localStorage.getItem(AUTH_RETURN_URL_KEY) || "");
  localStorage.removeItem(AUTH_RETURN_URL_KEY);
  return returnUrl.startsWith("/") && !returnUrl.startsWith("//") ? returnUrl : "";
}

/**
 * 从本地存储读取 OAuth 认证状态。
 *
 * @returns {object} 认证状态对象。
 */
export function loadAuthState() {
  return safeJsonParse(localStorage.getItem(AUTH_STORAGE_KEY) || "null", {
    code: "",
    state: "",
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresIn: 0,
    receivedAt: 0,
  });
}

/**
 * 将认证状态持久化到本地存储。
 *
 * @param {object} payload 待保存的认证状态。
 */
export function saveAuthState(payload) {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      code: String(payload?.code || ""),
      state: String(payload?.state || ""),
      accessToken: String(payload?.accessToken || ""),
      refreshToken: String(payload?.refreshToken || ""),
      tokenType: String(payload?.tokenType || ""),
      expiresIn: Number(payload?.expiresIn || 0),
      receivedAt: Number(payload?.receivedAt || 0),
    }),
  );
}

/**
 * 将当前认证状态刷新到设置面板。
 *
 * @param {object} ctx 包含 DOM 节点和应用状态的上下文。
 */
export function updateAuthDisplay(ctx) {
  const { el, state } = ctx;
  if (
    !el.authCodeValue &&
    !el.authStateValue &&
    !el.authAccessTokenValue &&
    !el.authRefreshTokenValue
  ) {
    return;
  }
  const auth = state.auth || {
    code: "",
    state: "",
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresIn: 0,
    receivedAt: 0,
  };
  const codeText = auth.code || "-";
  const stateText = auth.state || "-";
  const accessText = auth.accessToken || "-";
  const refreshText = auth.refreshToken || "-";
  if (el.authCodeValue) el.authCodeValue.textContent = codeText;
  if (el.authStateValue) el.authStateValue.textContent = stateText;
  if (el.authAccessTokenValue) el.authAccessTokenValue.textContent = accessText;
  if (el.authRefreshTokenValue) el.authRefreshTokenValue.textContent = refreshText;
}

/**
 * 从本地代理读取 OAuth 配置，用于发起授权跳转。
 *
 * @param {Function} getStoreBase 返回代理 API Base URL 的函数。
 * @returns {Promise<object>} 后端返回的认证配置。
 */
async function fetchAuthConfig(getStoreBase) {
  const params = new URLSearchParams();
  const variant = String(window.__CHATBOT_APP_VARIANT__ || "").trim();
  if (variant) params.set("appVariant", variant);
  // 传递当前页面 URL 作为 OAuth 回调地址，适配多路径部署（如 /wiki/chatbot/）
  params.set("redirectUri", window.location.origin + window.location.pathname.replace(/\/$/, "") + "/");
  const url = `${getStoreBase()}/auth-config?${params.toString()}`;
  let res;
  try {
    res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    throw new Error(formatRuntimeError(err, "加载认证配置失败"));
  }
  if (!res.ok) {
    throw new Error(await readResponseError(res, "加载认证配置失败"));
  }
  return res.json().catch(() => ({}));
}

/**
 * 用授权码向代理换取 access token 和 refresh token。
 *
 * @param {Function} getStoreBase 返回代理 API Base URL 的函数。
 * @param {string} code 授权码。
 * @param {string} redirectUri 回调地址。
 * @returns {Promise<object>} Token 接口响应。
 */
async function exchangeAuthToken(getStoreBase, code, redirectUri) {
  const url = `${getStoreBase()}/auth-token`;
  const appVariant = String(window.__CHATBOT_APP_VARIANT__ || "").trim();
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri, appVariant }),
    });
  } catch (err) {
    throw new Error(formatRuntimeError(err, "换取 Token 失败"));
  }
  if (!res.ok) {
    throw new Error(await readResponseError(res, "换取 Token 失败"));
  }
  return res.json().catch(() => ({}));
}

/**
 * 使用 access token 从代理拉取用户信息。
 *
 * @param {Function} getStoreBase 返回代理 API Base URL 的函数。
 * @param {string} accessToken 访问令牌。
 * @returns {Promise<object>} 包含 ok、status、message、data 的统一结果。
 */
async function fetchAuthUserInfo(getStoreBase, accessToken) {
  const url = `${getStoreBase()}/auth-userinfo`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorCode: null,
      message: formatRuntimeError(err, "获取用户信息失败"),
      data: null,
    };
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    data = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: data?.errorCode ?? null,
      message: String(data?.error || text || res.statusText || "获取用户信息失败"),
      data,
    };
  }
  return { ok: true, status: res.status, data };
}

/**
 * 使用本地缓存的 access token 尝试静默登录。
 *
 * @param {object} ctx 认证上下文。
 * @returns {Promise<object>} 是否成功、是否需要重新认证等结果。
 */
export async function tryLoginWithStoredToken(ctx) {
  const { state, getStoreBase, setTips, onUserInfo, onAuthLog } = ctx;
  const accessToken = String(state.auth?.accessToken || "");
  if (!accessToken) {
    onAuthLog?.("本地Token登录", "无本地Token");
    return { ok: false, needsAuth: false, reason: "missing_token" };
  }
  onAuthLog?.("本地Token登录", `尝试中(token长度=${accessToken.length})...`);
  const result = await fetchAuthUserInfo(getStoreBase, accessToken);
  if (result.ok) {
    onAuthLog?.("本地Token登录", "成功");
    onUserInfo?.(result.data || {});
    return { ok: true, needsAuth: false };
  }
  if (result.status !== 200 && result.errorCode === 10011) {
    onAuthLog?.("本地Token登录", "Token已过期(errorCode=10011)");
    return { ok: false, needsAuth: true, reason: "token_expired" };
  }
  onAuthLog?.("本地Token登录", `失败-status=${result.status}，errorCode=${result.errorCode || "无"}，message=${result.message || "无"}`);
  setTips?.(`获取用户信息失败：${String(result.message || "")}`);
  return { ok: false, needsAuth: false, reason: "other_error" };
}

/**
 * 读取认证配置并跳转到 OAuth 授权页。
 *
 * @param {object} ctx 认证上下文。
 * @returns {Promise<void>}
 */
export async function startAuthFlow(ctx) {
  const { state, getStoreBase, setTips, onAuthLog } = ctx;
  try {
    onAuthLog?.("OAuth跳转-获取配置", "开始...");
    const cfg = await fetchAuthConfig(getStoreBase);
    const authorizeUrlBase = String(cfg?.authorizeUrlBase || "").trim();
    const clientId = String(cfg?.clientId || "").trim();
    const redirectUri = String(cfg?.redirectUri || "").trim();
    const scope = String(cfg?.scope || "").trim();
    onAuthLog?.("OAuth跳转-配置", `authorizeUrl=${authorizeUrlBase || "空"}，clientId=${clientId ? "已配置" : "空"}，redirectUri=${redirectUri || "空"}，scope=${scope || "空"}`);
    if (!authorizeUrlBase || !clientId || !redirectUri || !scope) {
      const missing = [];
      if (!authorizeUrlBase) missing.push("AUTH_SERVER_DOMAIN/authorizeUrlBase");
      if (!clientId) missing.push("AUTH_CLIENT_ID");
      if (!redirectUri) missing.push("AUTH_REDIRECT_URI");
      if (!scope) missing.push("AUTH_SCOPE");
      onAuthLog?.("OAuth跳转-失败", `缺少配置：${missing.join("，")}`);
      setTips?.(
        "认证配置不完整，请检查 AUTH_SERVER_DOMAIN、AUTH_CLIENT_ID、AUTH_CLIENT_SECRET、AUTH_REDIRECT_URI",
      );
      return false;
    }
    const stateValue = `state-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    state.auth = {
      code: "",
      state: stateValue,
      accessToken: "",
      refreshToken: "",
      tokenType: "",
      expiresIn: 0,
      receivedAt: 0,
    };
    saveAuthReturnUrl();
    saveAuthState(state.auth);
    updateAuthDisplay(ctx);
    const url = new URL(authorizeUrlBase);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", stateValue);
    onAuthLog?.("OAuth跳转", `准备跳转到 ${authorizeUrlBase}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`);
    window.location.href = url.toString();
    return true;
  } catch (err) {
    onAuthLog?.("OAuth跳转-异常", formatRuntimeError(err, "认证失败"));
    setTips?.(`认证失败：${formatRuntimeError(err, "认证失败")}`);
    return false;
  }
}

/**
 * 从当前 URL 中提取 OAuth 回调参数，并完成 token 交换和用户信息获取。
 *
 * @param {object} ctx 认证上下文。
 * @returns {boolean} 当前地址中是否包含授权码。
 */
export async function captureAuthCodeFromUrl(ctx) {
  const { state, getStoreBase, setTips, onUserInfo, onAuthLog } = ctx;
  const params = new URLSearchParams(window.location.search || "");
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code) return false;
  const expectedState = String(state.auth?.state || "");
  if (!expectedState || !returnedState || expectedState !== returnedState) {
    console.warn("[Auth] invalid or stale OAuth callback", {
      hasExpectedState: Boolean(expectedState),
      hasReturnedState: Boolean(returnedState),
      stateMatches: Boolean(expectedState && returnedState && expectedState === returnedState),
    });
    state.auth = { ...state.auth, code: "", state: "", receivedAt: 0 };
    saveAuthState(state.auth);
    updateAuthDisplay(ctx);
    params.delete("code");
    params.delete("state");
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    window.history.replaceState({}, "", cleanUrl);
    setTips?.("检测到已失效的认证回调，正在恢复登录...");
    onAuthLog?.(
      "OAuth State校验",
      !expectedState
        ? "失败-无本地state，可能是工作台重复打开旧回调链接"
        : !returnedState
          ? "失败-回调缺少state"
          : "失败-state不一致",
    );
    return false;
  }
  onAuthLog?.("OAuth State校验", "通过");
  state.auth = {
    ...state.auth,
    code,
    state: returnedState || expectedState || "",
    receivedAt: Date.now(),
  };
  const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", cleanUrl);
  saveAuthState(state.auth);
  updateAuthDisplay(ctx);
  try {
    onAuthLog?.("OAuth获取配置", "开始...");
    const cfg = await fetchAuthConfig(getStoreBase);
    const redirectUri = String(cfg?.redirectUri || "").trim();
    onAuthLog?.("OAuth配置", `redirectUri=${redirectUri || "空"}，variant=${cfg?.variant || "default"}`);
    onAuthLog?.("OAuth换取Token", `开始...redirectUri=${redirectUri}`);
    const data = await exchangeAuthToken(getStoreBase, code, redirectUri);
    const accessToken = String(data?.access_token || "");
    const refreshToken = String(data?.refresh_token || "");
    onAuthLog?.("OAuth换取Token", accessToken ? `成功(token长度=${accessToken.length})` : `失败-响应中缺少access_token，原始keys=${Object.keys(data || {}).join(",") || "无"}`);
    state.auth = {
      ...state.auth,
      accessToken,
      refreshToken,
      tokenType: String(data?.token_type || ""),
      expiresIn: Number(data?.expires_in || 0),
      receivedAt: Date.now(),
    };
    saveAuthState(state.auth);
    updateAuthDisplay(ctx);
    if (!accessToken) {
      throw new Error("换取 Token 失败：响应中缺少 access_token");
    }
    onAuthLog?.("OAuth获取用户信息", "开始...");
    const result = await fetchAuthUserInfo(getStoreBase, accessToken);
    if (!result.ok) {
      onAuthLog?.("OAuth获取用户信息", `失败-status=${result.status}，errorCode=${result.errorCode || "无"}，message=${result.message || "无"}`);
      throw new Error(`userinfo:${String(result.message || "获取用户信息失败")}`);
    }
    const userKeys = result.data && typeof result.data === "object" ? Object.keys(result.data).slice(0, 20).join(",") : "无";
    onAuthLog?.("OAuth获取用户信息", `成功-返回字段：${userKeys}`);
    onUserInfo?.(result.data || {});
    onAuthLog?.("OAuth用户信息应用", "已调用");
    const returnUrl = consumeAuthReturnUrl();
    if (returnUrl && returnUrl !== getCurrentReturnUrl()) {
      onAuthLog?.("OAuth返回入口", returnUrl);
      window.location.replace(returnUrl);
    }
  } catch (err) {
    const message = String(err?.message || err);
    if (message.startsWith("userinfo:")) {
      setTips?.(`获取用户信息失败：${message.slice("userinfo:".length)}`);
      onAuthLog?.("OAuth错误", `获取用户信息失败：${message.slice("userinfo:".length)}`);
    } else {
      setTips?.(`换取 Token 失败：${message}`);
      onAuthLog?.("OAuth错误", `换取Token失败：${message}`);
    }
    updateAuthDisplay(ctx);
  }
  return true;
}
