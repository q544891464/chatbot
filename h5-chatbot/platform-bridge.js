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
function callApp(event, data = {}) {
  return new Promise((resolve, reject) => {
    if (!isApp) {
      resolve(null);
      return;
    }

    const key = createCallbackId();
    const successName = `__bridge_${key}_s`;
    const failName = `__bridge_${key}_f`;

    const cleanup = () => {
      delete window[successName];
      delete window[failName];
    };

    window[successName] = (payload) => {
      cleanup();
      resolve(unwrapPayload(payload));
    };

    window[failName] = (err) => {
      cleanup();
      reject(err);
    };

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
    try {
      const data = await callApp("getLoginUserInfo", {});
      return normalizeUserInfo(data);
    } catch {
      return null;
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

async function exitH5Page() {
  if (window.WeixinJSBridge && typeof window.WeixinJSBridge.call === "function") {
    try {
      window.WeixinJSBridge.call("closeWindow");
      if (await waitForPageHidden()) return true;
    } catch {
      // fallback below
    }
  }

  if (window.AlipayJSBridge && typeof window.AlipayJSBridge.call === "function") {
    try {
      window.AlipayJSBridge.call("closeWebview");
      if (await waitForPageHidden()) return true;
    } catch {
      // fallback below
    }
  }

  if (isAndroid) {
    const directMethods = [
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
          window.androidMethod[method]();
          if (await waitForPageHidden()) return true;
        } catch {
          // try next method
        }
      }
    }
    if (window.androidMethod && typeof window.androidMethod.sendCommand === "function") {
      const commands = ["closeWebView", "closeWebview", "closeWindow", "close", "finish", "goBack", "back", "exit", "exitH5"];
      for (const command of commands) {
        try {
          window.androidMethod.sendCommand(JSON.stringify({ command, params: {} }));
          if (await waitForPageHidden()) return true;
        } catch {
          // try next command
        }
      }
    }
  }

  if (isIos && window.iOSMethodBridge && typeof window.iOSMethodBridge.postMessage === "function") {
    const apis = ["closeWebView", "closeWebview", "closeWindow", "close", "finish", "goBack", "back", "exit", "exitH5"];
    for (const api of apis) {
      try {
        window.iOSMethodBridge.postMessage(JSON.stringify({ api, data: {} }));
        if (await waitForPageHidden()) return true;
      } catch {
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
      postCloseScheme(scheme);
      if (await waitForPageHidden(300)) return true;
    } catch {
      // try next scheme
    }
  }

  return false;
}

export { isAndroid, isIos, isApp, callApp, exitH5Page, getLoginUserInfo };
