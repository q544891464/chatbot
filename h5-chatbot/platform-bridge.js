const ua = navigator.userAgent || "";
const isAndroid = /Android|Adr/i.test(ua);
const isIos = /(iPhone|iPad|iPod)/i.test(ua);
const isApp = isAndroid || isIos;

function createCallbackId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function unwrapPayload(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

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

export { isAndroid, isIos, isApp, callApp, getLoginUserInfo };
