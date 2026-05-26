function normalizeMessage(msg) {
  const role = msg?.role === "assistant" ? "assistant" : "user";
  const content = String(msg?.content || "");
  const time = String(msg?.time || "");
  const id = msg?.id ?? msg?.messageId;
  const externalMessageId =
    msg?.externalMessageId ?? msg?.external_message_id ?? msg?.externalMessageID;
  const base = { role, content, time };
  if (id !== undefined && id !== null && String(id).trim()) {
    base.id = Number.isFinite(Number(id)) ? Number(id) : String(id);
  }
  if (externalMessageId !== undefined && externalMessageId !== null) {
    const trimmed = String(externalMessageId).trim();
    if (trimmed) base.externalMessageId = trimmed;
  }
  return base;
}

function normalizeConversation(item) {
  const now = Date.now();
  const messages = Array.isArray(item?.messages) ? item.messages.map(normalizeMessage) : [];
  const platform = item?.platform === "agent" ? "agent" : "dify";
  return {
    id: String(item?.id || `conv-${now}`),
    title: String(item?.title || "新对话"),
    conversationId: String(item?.conversationId || ""),
    platform,
    messages: messages.slice(-80),
    createdAt: Number(item?.createdAt || now),
    updatedAt: Number(item?.updatedAt || now),
  };
}

function normalizeUserPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items.map(normalizeConversation) : [];
  const preferredActive = String(payload?.activeId || "");
  const activeId = items.some((c) => c.id === preferredActive) ? preferredActive : items[0]?.id || "";
  return { items, activeId };
}

function normalizeAppVariant(appVariant) {
  return String(appVariant || "default").trim().slice(0, 64) || "default";
}

function createConversationService(pool) {
  async function fetchUserConversations(userKey, appVariant = "default") {
    const variant = normalizeAppVariant(appVariant);
    const conn = await pool.getConnection();
    try {
      const [userRows] = await conn.execute(
        "SELECT id, active_conversation_key FROM users WHERE user_key = ?",
        [userKey],
      );
      if (!userRows.length) return { items: [], activeId: "" };

      const userId = userRows[0].id;
      const [stateRows] = await conn.execute(
        "SELECT active_conversation_key FROM user_variant_states WHERE user_id = ? AND app_variant = ?",
        [userId, variant],
      );
      const activeKey = String(
        stateRows?.[0]?.active_conversation_key ||
          (variant === "default" ? userRows[0].active_conversation_key : "") ||
          "",
      );
      const [convRows] = await conn.execute(
        "SELECT id, conversation_key, title, platform, dify_conversation_id, created_at_ms, updated_at_ms FROM conversations WHERE user_id = ? AND app_variant = ? ORDER BY updated_at_ms DESC",
        [userId, variant],
      );

      if (!convRows.length) return { items: [], activeId: "" };

      const convIds = convRows.map((row) => row.id);
      const placeholders = convIds.map(() => "?").join(",");
      const [msgRows] = await conn.query(
        `SELECT id, conversation_id, role, content, time_label, position, external_message_id FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, position`,
        convIds,
      );

      const msgMap = new Map();
      for (const row of msgRows) {
        const list = msgMap.get(row.conversation_id) || [];
        list.push({
          id: row.id,
          role: row.role === "assistant" ? "assistant" : "user",
          content: String(row.content || ""),
          time: String(row.time_label || ""),
          externalMessageId: row.external_message_id
            ? String(row.external_message_id)
            : "",
        });
        msgMap.set(row.conversation_id, list);
      }

      const items = convRows.map((row) =>
        normalizeConversation({
          id: String(row.conversation_key || ""),
          title: String(row.title || ""),
          conversationId: String(row.dify_conversation_id || ""),
          platform: row.platform === "agent" ? "agent" : "dify",
          messages: msgMap.get(row.id) || [],
          createdAt: Number(row.created_at_ms || Date.now()),
          updatedAt: Number(row.updated_at_ms || Date.now()),
        }),
      );

      const activeId = items.some((c) => c.id === activeKey) ? activeKey : items[0]?.id || "";
      return { items, activeId };
    } finally {
      conn.release();
    }
  }

  async function syncUserConversations(userKey, payload, appVariant = "default") {
    const variant = normalizeAppVariant(appVariant);
    const normalized = normalizeUserPayload(payload);
    const messageIds = {};
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [userResult] = await conn.execute(
        "INSERT INTO users (user_key, active_conversation_key) VALUES (?, ?) ON DUPLICATE KEY UPDATE active_conversation_key = IF(? = 'default', VALUES(active_conversation_key), active_conversation_key), id = LAST_INSERT_ID(id)",
        [userKey, variant === "default" ? normalized.activeId || null : null, variant],
      );
      const userId = userResult.insertId;
      await conn.execute(
        "INSERT INTO user_variant_states (user_id, app_variant, active_conversation_key) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE active_conversation_key = VALUES(active_conversation_key)",
        [userId, variant, normalized.activeId || null],
      );

      const [existingRows] = await conn.execute(
        "SELECT id, conversation_key FROM conversations WHERE user_id = ? AND app_variant = ?",
        [userId, variant],
      );
      const existingMap = new Map(existingRows.map((row) => [row.conversation_key, row.id]));
      const keepKeys = new Set();

      for (const conv of normalized.items) {
        const convKey = String(conv.id || "");
        keepKeys.add(convKey);
        const title = String(conv.title || "");
        const platform = conv.platform === "agent" ? "agent" : "dify";
        const difyConversationId = conv.conversationId ? String(conv.conversationId) : null;
        const createdAtMs = Number(conv.createdAt || Date.now());
        const updatedAtMs = Number(conv.updatedAt || Date.now());

        let convId = existingMap.get(convKey);
        if (convId) {
          await conn.execute(
            "UPDATE conversations SET title = ?, platform = ?, dify_conversation_id = ?, created_at_ms = ?, updated_at_ms = ? WHERE id = ?",
            [title, platform, difyConversationId, createdAtMs, updatedAtMs, convId],
          );
        } else {
          const [insertResult] = await conn.execute(
            "INSERT INTO conversations (user_id, app_variant, conversation_key, title, platform, dify_conversation_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [userId, variant, convKey, title, platform, difyConversationId, createdAtMs, updatedAtMs],
          );
          convId = insertResult.insertId;
          existingMap.set(convKey, convId);
        }

        const messages = Array.isArray(conv.messages) ? conv.messages.map(normalizeMessage) : [];
        const [existingMessageRows] = await conn.execute(
          "SELECT id FROM messages WHERE conversation_id = ?",
          [convId],
        );
        const existingMessageIds = new Set(existingMessageRows.map((row) => Number(row.id)));
        const keepMessageIds = [];

        for (const [idx, msg] of messages.entries()) {
          const role = msg.role === "assistant" ? "assistant" : "user";
          const content = String(msg.content || "");
          const timeLabel = String(msg.time || "");
          const externalMessageId = msg.externalMessageId ? String(msg.externalMessageId) : null;
          const numericId = Number.parseInt(String(msg.id || ""), 10);
          if (Number.isFinite(numericId) && existingMessageIds.has(numericId)) {
            await conn.execute(
              "UPDATE messages SET role = ?, content = ?, time_label = ?, position = ?, created_at_ms = ?, external_message_id = ? WHERE id = ? AND conversation_id = ?",
              [role, content, timeLabel, idx, updatedAtMs, externalMessageId, numericId, convId],
            );
            keepMessageIds.push(numericId);
          } else {
            const [insertMessageResult] = await conn.execute(
              "INSERT INTO messages (conversation_id, role, content, time_label, position, created_at_ms, external_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [convId, role, content, timeLabel, idx, updatedAtMs, externalMessageId],
            );
            keepMessageIds.push(insertMessageResult.insertId);
          }
        }

        if (keepMessageIds.length) {
          const placeholders = keepMessageIds.map(() => "?").join(",");
          await conn.execute(
            `DELETE FROM messages WHERE conversation_id = ? AND id NOT IN (${placeholders})`,
            [convId, ...keepMessageIds],
          );
        } else {
          await conn.execute("DELETE FROM messages WHERE conversation_id = ?", [convId]);
        }
        messageIds[convKey] = keepMessageIds;
      }

      if (keepKeys.size) {
        const keys = Array.from(keepKeys);
        const placeholders = keys.map(() => "?").join(",");
        await conn.execute(
          `DELETE FROM conversations WHERE user_id = ? AND app_variant = ? AND conversation_key NOT IN (${placeholders})`,
          [userId, variant, ...keys],
        );
      } else {
        await conn.execute("DELETE FROM conversations WHERE user_id = ? AND app_variant = ?", [userId, variant]);
      }

      await conn.commit();
      return { messageIds };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  return {
    fetchUserConversations,
    syncUserConversations,
  };
}

module.exports = {
  createConversationService,
  normalizeAppVariant,
  normalizeConversation,
  normalizeMessage,
  normalizeUserPayload,
};
