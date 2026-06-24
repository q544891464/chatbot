const ua = navigator.userAgent || "";
const isAndroid = /Android|Adr/i.test(ua);
const isHarmony = /OpenHarmony|HarmonyOS/i.test(ua);
const isAndroidLike = isAndroid || isHarmony;
const isIos = /(iPhone|iPad|iPod)/i.test(ua);
const isApp = isAndroidLike || isIos;

/**
 * 生成一段桥接回调 ID，避免不同调用间的回调名冲突。
 *
 * @returns {string} 回调 ID。
 */
function createCallbackId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 统一拆包宿主回调结果，优先读取 `data` 字段。
 *
 * @param {*} payload 宿主返回的原始数据。
 * @returns {*} 拆包后的数据。
 */
function unwrapPayload(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

/**
 * 将宿主返回的用户信息规范化为对象。
 *
 * @param {*} raw 原始用户信息。
 * @returns {object|null} 规范化后的用户信息对象。
 */
function normalizeUserInfo(raw) {
  const payload = unwrapPayload(raw);
  if (payload == null) return null;
  if (typeof payload === "object") return payload;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: trimmed };
    }
  }
  return null;
}

function pickUserInfoValue(info, keys) {
  if (!info || typeof info !== "object") return "";
  for (const key of keys) {
    const value = String(info[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function getLogBaseUrl() {
  const path = window.location.pathname || "/";
  const marker = "/h5-chatbot/";
  const idx = path.indexOf(marker);
  if (idx >= 0) return `${window.location.origin}${path.slice(0, idx)}/api`;
  return `${window.location.origin}/api`;
}

function logBridgeUserInfo(method, info, error = "") {
  const payload = {
    method,
    ok: Boolean(info),
    score: scoreUserInfo(info),
    hasPhone: Boolean(pickUserInfoValue(info, ["phone", "phone_number", "mobile", "userId", "loginId"])),
    hasDepartmentId: Boolean(pickUserInfoValue(info, ["departmentId", "department_id", "deptId"])),
    hasDepartmentName: Boolean(pickUserInfoValue(info, ["departmentName", "department_name", "department", "deptName"])),
    hasOrgId: Boolean(pickUserInfoValue(info, ["orgId", "org_id"])),
    hasOrgName: Boolean(pickUserInfoValue(info, ["orgName", "org", "companyName"])),
    keys: info && typeof info === "object" ? Object.keys(info).slice(0, 30) : [],
    error: error ? String(error).slice(0, 160) : "",
  };
  fetch(`${getLogBaseUrl()}/client-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "bridge:userinfo:method", source: "platform-bridge", data: payload }),
    keepalive: true,
  }).catch(() => {});
}

function scoreUserInfo(info) {
  if (!info || typeof info !== "object") return 0;
  let score = 0;
  if (pickUserInfoValue(info, ["phone", "phone_number", "mobile", "userId", "loginId"])) score += 8;
  if (pickUserInfoValue(info, ["name", "userName", "username", "nickName"])) score += 4;
  if (pickUserInfoValue(info, ["departmentId", "department_id", "deptId"])) score += 30;
  if (pickUserInfoValue(info, ["departmentName", "department_name", "department", "deptName"])) score += 12;
  if (pickUserInfoValue(info, ["orgId", "org_id"])) score += 2;
  if (pickUserInfoValue(info, ["orgName", "org", "companyName"])) score += 2;
  return score;
}

function mergeUserInfo(base, extra) {
  if (!base) return extra || null;
  if (!extra) return base;
  const merged = { ...base };
  Object.entries(extra).forEach(([key, value]) => {
    const current = String(merged[key] ?? "").trim();
    const next = String(value ?? "").trim();
    if (!current && next) merged[key] = value;
  });
  [
    ["departmentId", "department_id", "deptId"],
    ["departmentName", "department_name", "department", "deptName"],
    ["orgId", "org_id"],
    ["orgName", "org", "companyName"],
    ["phone", "phone_number", "mobile", "userId", "loginId"],
    ["name", "userName", "username", "nickName"],
  ].forEach((keys) => {
    const current = pickUserInfoValue(merged, keys);
    const next = pickUserInfoValue(extra, keys);
    if (!current && next) merged[keys[0]] = next;
  });
  return merged;
}

/**
 * 通过 Android/iOS 宿主桥调用原生能力。
 *
 * @param {string} event 宿主事件名。
 * @param {object} data 调用参数。
 * @returns {Promise<*>} 宿主回调结果。
 */
function callApp(event, data = {}, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    if (!isApp) {
      resolve(null);
      return;
    }

    const key = createCallbackId();
    const successName = `__bridge_${key}_s`;
    const failName = `__bridge_${key}_f`;

    let settled = false;
    let timer = null;

    const finish = (fn, payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(payload);
    };

    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      delete window[successName];
      delete window[failName];
    };

    window[successName] = (payload) => {
      finish(resolve, unwrapPayload(payload));
    };

    window[failName] = (err) => {
      finish(reject, err);
    };

    timer = window.setTimeout(() => {
      finish(resolve, null);
    }, Math.max(300, Number(timeoutMs) || 1200));

    if (isAndroidLike) {
      if (window.androidMethod && typeof window.androidMethod[event] === "function") {
        const payload = JSON.stringify({ ...data, successName, failName });
        window.androidMethod[event](payload);
        return;
      }
      if (window.androidMethod && typeof window.androidMethod.sendCommand === "function") {
        const payload = JSON.stringify({ command: event, params: data, bridgeCallback: successName });
        window.androidMethod.sendCommand(payload);
        return;
      }
    }

    if (isIos && window.webkit?.messageHandlers?.[event]?.postMessage) {
      window.webkit.messageHandlers[event].postMessage({ action: event, data, successName, failName });
      return;
    }

    if (isIos && window.iOSMethodBridge && typeof window.iOSMethodBridge.postMessage === "function") {
      const payload = JSON.stringify({ api: event, successName, failName, data });
      window.iOSMethodBridge.postMessage(payload);
      return;
    }

    cleanup();
    resolve(null);
  });
}

// Fetch user info from platform SDKs (Android/iOS), return normalized object.
/**
 * 从宿主平台 SDK 获取登录用户信息。
 *
 * @returns {Promise<object|null>} 规范化后的用户信息。
 */
async function getLoginUserInfo() {
  let bestUserInfo = null;

  if (isAndroidLike && window.androidMethod && typeof window.androidMethod.jsGetUserBean === "function") {
    try {
      const raw = await Promise.resolve(window.androidMethod.jsGetUserBean());
      const normalized = normalizeUserInfo(raw);
      logBridgeUserInfo("android.jsGetUserBean", normalized);
      bestUserInfo = mergeUserInfo(bestUserInfo, normalized);
    } catch (err) {
      logBridgeUserInfo("android.jsGetUserBean", null, err?.message || err);
      // try other bridge methods below
    }
  }

  if (isApp) {
    const methods = isAndroidLike
      ? ["getUserInfo", "getLoginUserInfo", "jsGetUserInfo", "getLoginUserBean"]
      : ["getLoginUserInfo", "jsGetUserBean", "getUserInfo", "jsGetUserInfo", "getLoginUserBean"];
    for (const method of methods) {
      try {
        const data = await callApp(method, {});
        const normalized = normalizeUserInfo(data);
        logBridgeUserInfo(method, normalized);
        bestUserInfo = mergeUserInfo(bestUserInfo, normalized);
        if (pickUserInfoValue(bestUserInfo, ["departmentId", "department_id", "deptId"])) break;
      } catch (err) {
        logBridgeUserInfo(method, null, err?.message || err);
        // try next bridge method
      }
    }
  }

  return bestUserInfo;
}

function waitForPageHidden(timeout = 500) {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(document.hidden), timeout);
  });
}

function postCloseScheme(url) {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 800);
}

function getSafeLocationInfo() {
  const searchKeys = [];
  try {
    new URLSearchParams(window.location.search || "").forEach((_, key) => {
      if (!searchKeys.includes(key)) searchKeys.push(key);
    });
  } catch {
    // ignore malformed search params
  }
  return {
    origin: window.location.origin,
    pathname: window.location.pathname,
    searchKeys,
    hasHash: Boolean(window.location.hash),
  };
}

function getSafeUrlInfo(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    const searchKeys = [];
    parsed.searchParams.forEach((_, key) => {
      if (!searchKeys.includes(key)) searchKeys.push(key);
    });
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
      searchKeys,
      hasHash: Boolean(parsed.hash),
    };
  } catch {
    return { raw: "unparseable" };
  }
}

function getBridgeDiagnostics() {
  const androidMethod = window.androidMethod;
  const iosBridge = window.iOSMethodBridge;
  const webkitHandlers = window.webkit?.messageHandlers;
  const androidMethodKeys =
    androidMethod && typeof androidMethod === "object"
      ? Object.keys(androidMethod).slice(0, 80)
      : [];
  const iosBridgeKeys =
    iosBridge && typeof iosBridge === "object"
      ? Object.keys(iosBridge).slice(0, 80)
      : [];
  const webkitHandlerKeys =
    webkitHandlers && typeof webkitHandlers === "object"
      ? Object.keys(webkitHandlers).slice(0, 80)
      : [];
  return {
    userAgent: ua,
    referrer: getSafeUrlInfo(document.referrer || ""),
    location: getSafeLocationInfo(),
    isAndroid,
    isHarmony,
    isIos,
    isApp,
    historyLength: window.history.length,
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    standalone:
      Boolean(window.navigator.standalone) ||
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      false,
    bridge: {
      hasAndroidMethod: Boolean(androidMethod),
      androidMethodKeys,
      hasAndroidSendCommand: typeof androidMethod?.sendCommand === "function",
      hasIOSMethodBridge: Boolean(iosBridge),
      iosBridgeKeys,
      hasIOSPostMessage: typeof iosBridge?.postMessage === "function",
      hasWebkitMessageHandlers: Boolean(webkitHandlers),
      webkitHandlerKeys,
      hasWeixinJSBridge: Boolean(window.WeixinJSBridge),
      hasAlipayJSBridge: Boolean(window.AlipayJSBridge),
    },
  };
}

function reportExitAttempt(onAttempt, detail) {
  try {
    if (typeof onAttempt === "function") {
      onAttempt({
        ...detail,
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      });
    }
  } catch {
    // logging must not block exit
  }
}

async function exitH5Page(onAttempt) {
  if (window.WeixinJSBridge && typeof window.WeixinJSBridge.call === "function") {
    try {
      reportExitAttempt(onAttempt, { channel: "weixin", method: "closeWindow", stage: "before" });
      window.WeixinJSBridge.call("closeWindow");
      const hidden = await waitForPageHidden();
      reportExitAttempt(onAttempt, { channel: "weixin", method: "closeWindow", stage: "after", result: hidden ? "hidden" : "visible" });
      if (hidden) return true;
    } catch (err) {
      reportExitAttempt(onAttempt, { channel: "weixin", method: "closeWindow", stage: "error", error: String(err?.message || err || "unknown") });
      // fallback below
    }
  }

  if (window.AlipayJSBridge && typeof window.AlipayJSBridge.call === "function") {
    try {
      reportExitAttempt(onAttempt, { channel: "alipay", method: "closeWebview", stage: "before" });
      window.AlipayJSBridge.call("closeWebview");
      const hidden = await waitForPageHidden();
      reportExitAttempt(onAttempt, { channel: "alipay", method: "closeWebview", stage: "after", result: hidden ? "hidden" : "visible" });
      if (hidden) return true;
    } catch (err) {
      reportExitAttempt(onAttempt, { channel: "alipay", method: "closeWebview", stage: "error", error: String(err?.message || err || "unknown") });
      // fallback below
    }
  }

  if (isAndroidLike) {
    const directMethods = [
      "jsOnBackPressed",
      "onBack",
      "closeWebView",
      "closeWebview",
      "closeWindow",
      "close",
      "finish",
      "goBack",
      "back",
      "exit",
      "exitH5",
    ];
    for (const method of directMethods) {
      if (window.androidMethod && typeof window.androidMethod[method] === "function") {
        try {
          reportExitAttempt(onAttempt, { channel: "androidMethod", method, stage: "before" });
          window.androidMethod[method]();
          const hidden = await waitForPageHidden();
          reportExitAttempt(onAttempt, { channel: "androidMethod", method, stage: "after", result: hidden ? "hidden" : "visible" });
          if (hidden) return true;
        } catch (err) {
          reportExitAttempt(onAttempt, { channel: "androidMethod", method, stage: "error", error: String(err?.message || err || "unknown") });
          // try next method
        }
      }
    }
    if (window.androidMethod && typeof window.androidMethod.sendCommand === "function") {
      const commands = ["jsOnBackPressed", "onBack", "closeWebView", "closeWebview", "closeWindow", "close", "finish", "goBack", "back", "exit", "exitH5"];
      for (const command of commands) {
        try {
          reportExitAttempt(onAttempt, { channel: "androidSendCommand", method: command, stage: "before" });
          window.androidMethod.sendCommand(JSON.stringify({ command, params: {} }));
          const hidden = await waitForPageHidden();
          reportExitAttempt(onAttempt, { channel: "androidSendCommand", method: command, stage: "after", result: hidden ? "hidden" : "visible" });
          if (hidden) return true;
        } catch (err) {
          reportExitAttempt(onAttempt, { channel: "androidSendCommand", method: command, stage: "error", error: String(err?.message || err || "unknown") });
          // try next command
        }
      }
    }
  }

  if (isIos && window.webkit?.messageHandlers) {
    const handlers = ["jsOnBackPressed", "onBack", "closeWebView", "closeWebview", "closeWindow", "close", "finish", "goBack", "back", "exit", "exitH5"];
    for (const handler of handlers) {
      const bridgeHandler = window.webkit.messageHandlers[handler];
      if (!bridgeHandler || typeof bridgeHandler.postMessage !== "function") continue;
      try {
        reportExitAttempt(onAttempt, { channel: "webkitMessageHandler", method: handler, stage: "before" });
        bridgeHandler.postMessage({ action: handler, data: {} });
        const hidden = await waitForPageHidden();
        reportExitAttempt(onAttempt, { channel: "webkitMessageHandler", method: handler, stage: "after", result: hidden ? "hidden" : "visible" });
        if (hidden) return true;
      } catch (err) {
        reportExitAttempt(onAttempt, { channel: "webkitMessageHandler", method: handler, stage: "error", error: String(err?.message || err || "unknown") });
        // try next handler
      }
    }
  }

  if (isIos && window.iOSMethodBridge && typeof window.iOSMethodBridge.postMessage === "function") {
    const apis = ["jsOnBackPressed", "onBack", "closeWebView", "closeWebview", "closeWindow", "close", "finish", "goBack", "back", "exit", "exitH5"];
    for (const api of apis) {
      try {
        reportExitAttempt(onAttempt, { channel: "iOSMethodBridge", method: api, stage: "before" });
        window.iOSMethodBridge.postMessage(JSON.stringify({ api, data: {} }));
        const hidden = await waitForPageHidden();
        reportExitAttempt(onAttempt, { channel: "iOSMethodBridge", method: api, stage: "after", result: hidden ? "hidden" : "visible" });
        if (hidden) return true;
      } catch (err) {
        reportExitAttempt(onAttempt, { channel: "iOSMethodBridge", method: api, stage: "error", error: String(err?.message || err || "unknown") });
        // try next api
      }
    }
  }

  const schemes = [
    "jsbridge://close",
    "jsbridge://closeWebView",
    "app://close",
    "app://closeWebView",
    "native://close",
    "native://closeWebView",
  ];
  for (const scheme of schemes) {
    try {
      reportExitAttempt(onAttempt, { channel: "scheme", method: scheme, stage: "before" });
      postCloseScheme(scheme);
      const hidden = await waitForPageHidden(300);
      reportExitAttempt(onAttempt, { channel: "scheme", method: scheme, stage: "after", result: hidden ? "hidden" : "visible" });
      if (hidden) return true;
    } catch (err) {
      reportExitAttempt(onAttempt, { channel: "scheme", method: scheme, stage: "error", error: String(err?.message || err || "unknown") });
      // try next scheme
    }
  }

  return false;
}

export {
  isAndroid,
  isHarmony,
  isIos,
  isApp,
  callApp,
  exitH5Page,
  getBridgeDiagnostics,
  getLoginUserInfo,
};
