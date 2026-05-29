const ua = navigator.userAgent || "";
const isAndroid = /Android|Adr/i.test(ua);
const isIos = /(iPhone|iPad|iPod)/i.test(ua);
const isApp = isAndroid || isIos;

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

    if (isAndroid) {
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
  if (isAndroid && window.androidMethod && typeof window.androidMethod.jsGetUserBean === "function") {
    try {
      const raw = await Promise.resolve(window.androidMethod.jsGetUserBean());
      return normalizeUserInfo(raw);
    } catch {
      return null;
    }
  }

  // Fallback to generic bridge call used by iOS/other SDKs.
  if (isApp) {
    const methods = ["getLoginUserInfo", "jsGetUserBean", "getUserInfo", "jsGetUserInfo", "getLoginUserBean"];
    for (const method of methods) {
      try {
        const data = await callApp(method, {});
        const normalized = normalizeUserInfo(data);
        if (normalized) return normalized;
      } catch {
        // try next bridge method
      }
    }
  }

  return null;
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

  if (isAndroid) {
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

export { isAndroid, isIos, isApp, callApp, exitH5Page, getBridgeDiagnostics, getLoginUserInfo };
