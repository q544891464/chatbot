import {
  formatRuntimeError,
  readResponseError,
  safeJsonParse,
} from "./utils.js";

const AUTH_STORAGE_KEY = "h5ChatbotAuth:v1";

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
  const url = `${getStoreBase()}/auth-config`;
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
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri }),
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
  const { state, getStoreBase, setTips, onUserInfo } = ctx;
  const accessToken = String(state.auth?.accessToken || "");
  if (!accessToken) {
    return { ok: false, needsAuth: false, reason: "missing_token" };
  }
  const result = await fetchAuthUserInfo(getStoreBase, accessToken);
  if (result.ok) {
    onUserInfo?.(result.data || {});
    return { ok: true, needsAuth: false };
  }
  if (result.status !== 200 && result.errorCode === 10011) {
    return { ok: false, needsAuth: true, reason: "token_expired" };
  }
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
  const { state, getStoreBase, setTips } = ctx;
  try {
    const cfg = await fetchAuthConfig(getStoreBase);
    const authorizeUrlBase = String(cfg?.authorizeUrlBase || "").trim();
    const clientId = String(cfg?.clientId || "").trim();
    const redirectUri = String(cfg?.redirectUri || "").trim();
    const scope = String(cfg?.scope || "").trim();
    if (!authorizeUrlBase || !clientId || !redirectUri || !scope) {
      setTips?.(
        "认证配置不完整，请检查 AUTH_SERVER_DOMAIN、AUTH_CLIENT_ID、AUTH_CLIENT_SECRET、AUTH_REDIRECT_URI",
      );
      return;
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
    saveAuthState(state.auth);
    updateAuthDisplay(ctx);
    const url = new URL(authorizeUrlBase);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", stateValue);
    window.location.href = url.toString();
  } catch (err) {
    setTips?.(`认证失败：${formatRuntimeError(err, "认证失败")}`);
  }
}

/**
 * 从当前 URL 中提取 OAuth 回调参数，并完成 token 交换和用户信息获取。
 *
 * @param {object} ctx 认证上下文。
 * @returns {boolean} 当前地址中是否包含授权码。
 */
export function captureAuthCodeFromUrl(ctx) {
  const { state, getStoreBase, setTips, onUserInfo } = ctx;
  const params = new URLSearchParams(window.location.search || "");
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code) return false;
  const expectedState = String(state.auth?.state || "");
  if (expectedState && returnedState && expectedState !== returnedState) {
    console.warn("[Auth] state mismatch", { expectedState, returnedState });
    state.auth = { ...state.auth, code: "", state: "", receivedAt: 0 };
    saveAuthState(state.auth);
    updateAuthDisplay(ctx);
    setTips?.("认证回调校验失败：state 不一致");
    return false;
  }
  state.auth = {
    ...state.auth,
    code,
    state: returnedState || expectedState || "",
    receivedAt: Date.now(),
  };
  const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", cleanUrl);
  fetchAuthConfig(getStoreBase)
    .then((cfg) => String(cfg?.redirectUri || "").trim())
    .then((redirectUri) => exchangeAuthToken(getStoreBase, code, redirectUri))
    .then((data) => {
      const accessToken = String(data?.access_token || "");
      const refreshToken = String(data?.refresh_token || "");
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
      return fetchAuthUserInfo(getStoreBase, accessToken).then((result) => {
        if (!result.ok) {
          throw new Error(`userinfo:${String(result.message || "获取用户信息失败")}`);
        }
        return result.data || {};
      });
    })
    .then((userInfo) => {
      onUserInfo?.(userInfo);
    })
    .catch((err) => {
      const message = String(err?.message || err);
      if (message.startsWith("userinfo:")) {
        setTips?.(`获取用户信息失败：${message.slice("userinfo:".length)}`);
      } else {
        setTips?.(`换取 Token 失败：${message}`);
      }
      updateAuthDisplay(ctx);
    });
  saveAuthState(state.auth);
  updateAuthDisplay(ctx);
  return true;
}
