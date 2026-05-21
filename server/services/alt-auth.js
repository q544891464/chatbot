const { safeFetch } = require("../lib/http-utils");

function parseJwtExp(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return 0;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
  try {
    const json = Buffer.from(payload + pad, "base64").toString("utf8");
    const data = JSON.parse(json);
    return Number(data?.exp || 0);
  } catch {
    return 0;
  }
}

function createAltAuthService(config) {
  const tokenCache = { token: "", expMs: 0 };
  const failureCache = { untilMs: 0, message: "" };
  let tokenPromise = null;

  function hasValidToken() {
    return tokenCache.token && Date.now() < tokenCache.expMs;
  }

  function getCachedFailure() {
    if (!failureCache.untilMs || Date.now() >= failureCache.untilMs) return "";
    return failureCache.message || "ALT auth service is temporarily unavailable";
  }

  function recordFailure(err) {
    failureCache.untilMs = Date.now() + config.failureCooldownMs;
    failureCache.message = String(err?.message || err || "ALT auth service unavailable");
  }

  function clearFailure() {
    failureCache.untilMs = 0;
    failureCache.message = "";
  }

  async function requestToken() {
    if (!config.authUrl || !config.username || !config.password) {
      throw new Error("Missing ALT auth config");
    }
    const cachedFailure = getCachedFailure();
    if (cachedFailure) {
      throw new Error(`ALT auth service temporarily unavailable: ${cachedFailure}`);
    }

    const params = new URLSearchParams();
    params.set("grant_type", "password");
    params.set("username", config.username);
    params.set("password", config.password);
    if (String(config.scope || "").trim()) params.set("scope", config.scope);
    if (String(config.clientId || "").trim()) params.set("client_id", config.clientId);
    if (String(config.clientSecret || "").trim()) {
      params.set("client_secret", config.clientSecret);
    }

    try {
      const res = await safeFetch(config.authUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }, "ALT auth service", config.timeoutMs);

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || res.statusText || "ALT token request failed");
      }

      const data = await res.json().catch(() => ({}));
      const token = String(data?.access_token || "");
      if (!token) throw new Error("ALT token missing in response");

      const exp = parseJwtExp(token);
      tokenCache.token = token;
      tokenCache.expMs = exp ? exp * 1000 - 30_000 : Date.now() + 50 * 60 * 1000;
      clearFailure();
      return token;
    } catch (err) {
      recordFailure(err);
      throw err;
    }
  }

  async function getToken() {
    if (config.authUrl) {
      if (hasValidToken()) return tokenCache.token;
      if (tokenPromise) return tokenPromise;
      tokenPromise = requestToken().finally(() => {
        tokenPromise = null;
      });
      return tokenPromise;
    }
    if (!config.staticToken) {
      throw new Error("Missing ALT_API_TOKEN or ALT_AUTH_URL env var on server");
    }
    return config.staticToken;
  }

  return { getToken };
}

module.exports = {
  createAltAuthService,
  parseJwtExp,
};
