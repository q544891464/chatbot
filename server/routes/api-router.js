function createApiRouter(deps) {
  const {
    appConfig,
    authConfig,
    corsHeaders,
    formatInternalError,
    handleAuthToken,
    handleAuthUserInfo,
    handleAuthUserInfoClientLog,
    handleAltChat,
    handleAltChatStream,
    handleAltThread,
    handleAudioToText,
    handleChatMessages,
    handleClientLog,
    handleConversationsList,
    handleConversationsSync,
    handleFeedback,
    handleFeedbackStatus,
    handleMessageMeta,
    handleStatic,
    handleUrlEntryUserInfo,
    handleVideoProxy,
    health,
    sendJson,
  } = deps;

  return async function routeRequest(req, res) {
    try {
      const url = new URL(req.url || "/", "http://localhost");

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, health());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/app-config") {
        sendJson(res, 200, appConfig());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth-config") {
        sendJson(res, 200, authConfig(url.searchParams.get("appVariant"), url.searchParams.get("redirectUri")));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth-token") {
        await handleAuthToken(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/auth-userinfo") {
        await handleAuthUserInfo(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/url-entry-userinfo") {
        await handleUrlEntryUserInfo(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/auth-userinfo-log") {
        await handleAuthUserInfoClientLog(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/client-log") {
        await handleClientLog(req, res);
        return;
      }

      if (url.pathname === "/api/feedback") {
        if (req.method === "POST") {
          await handleFeedback(req, res);
          return;
        }
        if (req.method === "GET") {
          await handleFeedbackStatus(req, res, url.searchParams.get("messageId"));
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/conversations") {
        await handleConversationsList(req, res, url);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/message-meta") {
        await handleMessageMeta(req, res, url);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/conversations/sync") {
        await handleConversationsSync(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/alt-chat") {
        await handleAltChat(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/alt-chat-stream") {
        await handleAltChatStream(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/alt-thread") {
        await handleAltThread(req, res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/audio-to-text") {
        await handleAudioToText(req, res);
        return;
      }

      if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/video-proxy") {
        await handleVideoProxy(req, res, url);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/chat-messages") {
        await handleChatMessages(req, res);
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        await handleStatic(req, res);
        return;
      }

      res.writeHead(405, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
    } catch (err) {
      const code = err?.statusCode || 500;
      sendJson(res, code, {
        error: formatInternalError(err),
        source: "server",
        errorCode: String(err?.code || ""),
      });
    }
  };
}

module.exports = { createApiRouter };
