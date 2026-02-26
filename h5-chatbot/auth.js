import { safeJsonParse } from "./utils.js";

const AUTH_STORAGE_KEY = "h5ChatbotAuth:v1";

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
  const codeText = auth.code ? auth.code : "-";
  const stateText = auth.state ? auth.state : "-";
  const accessText = auth.accessToken ? auth.accessToken : "-";
  const refreshText = auth.refreshToken ? auth.refreshToken : "-";
  if (el.authCodeValue) el.authCodeValue.textContent = codeText;
  if (el.authStateValue) el.authStateValue.textContent = stateText;
  if (el.authAccessTokenValue) el.authAccessTokenValue.textContent = accessText;
  if (el.authRefreshTokenValue)
    el.authRefreshTokenValue.textContent = refreshText;
}

async function fetchAuthConfig(getStoreBase) {
  const url = `${getStoreBase()}/auth-config`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "auth config failed");
  }
  return res.json().catch(() => ({}));
}

async function exchangeAuthToken(getStoreBase, code, redirectUri) {
  const url = `${getStoreBase()}/auth-token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "token request failed");
  }
  return res.json().catch(() => ({}));
}

async function fetchAuthUserInfo(getStoreBase, accessToken) {
  const url = `${getStoreBase()}/auth-userinfo`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
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
      message:
        data?.error || text || res.statusText || "userinfo request failed",
      data,
    };
  }
  return { ok: true, status: res.status, data };
}

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

export async function startAuthFlow(ctx) {
  const { state, getStoreBase, setTips } = ctx;
  try {
    const cfg = await fetchAuthConfig(getStoreBase);
    const authorizeUrlBase = String(cfg?.authorizeUrlBase || "").trim();
    const clientId = String(cfg?.clientId || "").trim();
    const redirectUri = String(cfg?.redirectUri || "").trim();
    const scope = String(cfg?.scope || "").trim();
    if (!authorizeUrlBase || !clientId || !redirectUri || !scope) {
      setTips?.("认证配置不完整，请检查环境变量。");
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
    setTips?.(`认证失败：${String(err?.message || err)}`);
  }
}

export function captureAuthCodeFromUrl(ctx) {
  const { state, getStoreBase, setTips, onUserInfo } = ctx;
  const params = new URLSearchParams(window.location.search || "");
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code) return false;
  const expectedState = String(state.auth?.state || "");
  if (expectedState && returnedState && expectedState !== returnedState) {
    // eslint-disable-next-line no-console
    console.warn("[Auth] state mismatch", { expectedState, returnedState });
    state.auth = { ...state.auth, code: "", state: "", receivedAt: 0 };
    saveAuthState(state.auth);
    updateAuthDisplay(ctx);
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
        throw new Error("empty access_token");
      }
      return fetchAuthUserInfo(getStoreBase, accessToken).then((result) => {
        if (!result.ok) {
          throw new Error(`userinfo:${String(result.message || "failed")}`);
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
        setTips?.(`换取 token 失败：${message}`);
      }
      updateAuthDisplay(ctx);
    });
  saveAuthState(state.auth);
  updateAuthDisplay(ctx);
  return true;
}
