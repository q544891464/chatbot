function parseDurationMs(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getFetchFailureReason(err) {
  if (err?.name === "AbortError" || err?.code === "ABORT_ERR") {
    return "timeout";
  }
  return String(err?.cause?.code || err?.code || err?.message || err || "");
}

function createTimeoutSignal(timeoutMs, externalSignal) {
  if (!timeoutMs && !externalSignal) {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  let timeout = 0;

  const abortFromExternal = () => {
    if (!controller.signal.aborted) {
      controller.abort(externalSignal?.reason || new Error("Request aborted"));
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }

  if (timeoutMs) {
    timeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timeout) clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    },
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 0) {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs, options.signal);
  try {
    return await fetch(url, {
      ...options,
      ...(signal ? { signal } : {}),
    });
  } finally {
    cleanup();
  }
}

async function safeFetch(url, options, label, timeoutMs = 0) {
  try {
    return await fetchWithTimeout(url, options, timeoutMs);
  } catch (err) {
    const reason = getFetchFailureReason(err);
    const suffix = reason === "timeout" && timeoutMs ? `timeout after ${timeoutMs}ms` : reason;
    throw new Error(`${label} unreachable: ${suffix}`);
  }
}

module.exports = {
  fetchWithTimeout,
  getFetchFailureReason,
  parseDurationMs,
  safeFetch,
};
