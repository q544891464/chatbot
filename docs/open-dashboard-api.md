# Yuxi Dashboard 公网只读 API 调用文档

## 1. 概述

该 API 面向受信任的第三方应用，提供 Yuxi Dashboard 的**只读聚合统计数据**。适用于报表、BI 看板、运营监控和业务系统集成。

- 公网基础地址：`https://blendy.top:18888/api/open/dashboard`
- 协议：HTTPS
- 数据格式：`application/json; charset=utf-8`
- 时区：`Asia/Shanghai`（响应中的 `meta.timezone` 固定为该值）
- 方法：全部为 `GET`
- 鉴权：`X-API-Key` 请求头

为保护隐私，本 API **不会返回**对话正文、消息内容、手机号、用户姓名、后台备注，也不提供任何写入、删除或同步操作。

## 2. 鉴权

每次请求必须携带以下 Header：

```http
X-API-Key: YOUR_OPEN_DASHBOARD_API_KEY
```

当前密钥由系统管理员在 app1 的 `/home/Yuxi-Know/.env` 中通过 `OPEN_DASHBOARD_API_KEY` 管理。密钥泄露时，更新该配置并重建 `api-dev` 容器即可完成轮换。

> 不要将密钥放在前端 JavaScript、移动端安装包或公开代码仓库中。建议由调用方后端代为请求本 API。

### cURL 公共写法

```bash
export YUXI_DASHBOARD_API_KEY='YOUR_OPEN_DASHBOARD_API_KEY'
export YUXI_DASHBOARD_API='https://blendy.top:18888/api/open/dashboard'

curl --request GET "$YUXI_DASHBOARD_API/overview" \
  --header "X-API-Key: $YUXI_DASHBOARD_API_KEY"
```

## 3. 通用响应结构

成功响应的顶层结构统一如下：

```json
{
  "meta": {
    "generated_at": "2026-07-28T16:47:28.152142+08:00",
    "timezone": "Asia/Shanghai"
  },
  "data": {}
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `meta.generated_at` | string (ISO 8601) | 服务端生成本次统计结果的时间 |
| `meta.timezone` | string | 固定为 `Asia/Shanghai` |
| `data` | object | 各接口的业务数据 |

## 4. 接口清单

| 接口 | 说明 |
| --- | --- |
| `GET /overview` | 全局用户、对话、消息和反馈汇总 |
| `GET /department-usage` | 组织树及各部门的对话、Token 聚合统计 |
| `GET /token-timeseries` | 输入/输出 Token 用量趋势 |

---

## 5. 获取全局汇总

### `GET /overview`

返回全局统计；不含任何用户身份信息和对话内容。

```bash
curl "$YUXI_DASHBOARD_API/overview" \
  -H "X-API-Key: $YUXI_DASHBOARD_API_KEY"
```

### 成功响应示例

```json
{
  "meta": {
    "generated_at": "2026-07-28T16:47:28.152142+08:00",
    "timezone": "Asia/Shanghai"
  },
  "data": {
    "total_conversations": 1437,
    "active_conversations": 1359,
    "total_messages": 11048,
    "total_users": 7,
    "feedback_stats": {
      "total_feedbacks": 80,
      "satisfaction_rate": 57.5
    }
  }
}
```

### `data` 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `total_conversations` | integer | 全部对话总数，包含已结束/已归档的历史对话 |
| `active_conversations` | integer | 状态为 active 的对话数 |
| `total_messages` | integer | 全部消息总数 |
| `total_users` | integer | 未删除用户总数 |
| `feedback_stats.total_feedbacks` | integer | 已提交评价总数 |
| `feedback_stats.satisfaction_rate` | number | 点赞占评价总数的百分比，范围 0–100 |

---

## 6. 获取组织架构用量

### `GET /department-usage`

返回组织架构树，以及每个部门（含下级部门）的用户、对话和 Token 聚合统计。

```bash
curl "$YUXI_DASHBOARD_API/department-usage?agent_config_id=3" \
  -H "X-API-Key: $YUXI_DASHBOARD_API_KEY"
```

### 查询参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `agent_config_id` | string | 否 | 无 | 仅统计指定智能体配置 ID 的数据。例如产数产品助手通常为 `3`，标准 ICT 助手通常为 `7`。不传则统计全部智能体。 |
| `include_empty` | boolean | 否 | `false` | 是否返回没有使用记录的组织节点。可用值：`true`、`false`。 |

### 成功响应示例

```json
{
  "meta": {
    "generated_at": "2026-07-28T16:47:29.186191+08:00",
    "timezone": "Asia/Shanghai"
  },
  "data": {
    "items": [
      {
        "department_key": "1970807494703788033",
        "department_id": "1970807494703788033",
        "parent_department_id": "1",
        "department_name": "辽宁省-省公司",
        "department_path": "辽宁省-省公司",
        "depth": 1,
        "user_count": 11,
        "conversation_count": 112,
        "input_tokens": 25272591,
        "output_tokens": 399348,
        "total_tokens": 25671939,
        "first_seen": "2026-06-16T09:21:18.829523Z",
        "last_seen": "2026-07-28T08:15:12.209048Z",
        "children": []
      }
    ],
    "total_departments": 12,
    "total_users": 11,
    "total_conversations": 112,
    "total_tokens": 25671939,
    "config_ids": ["3", "7"]
  }
}
```

### 部门节点字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `department_key` | string | 部门统计唯一键，可用于前端树节点 key |
| `department_id` | string | 通讯录部门 ID |
| `parent_department_id` | string | 上级部门 ID；根节点通常为 `1` |
| `department_name` | string | 部门名称 |
| `department_path` | string | 从根节点开始的部门路径 |
| `depth` | integer | 在组织树中的层级，根下第一层为 `1` |
| `user_count` | integer | 部门及全部下级部门的去重用户数 |
| `conversation_count` | integer | 部门及全部下级部门的去重对话数 |
| `input_tokens` | integer | 输入 Token 汇总 |
| `output_tokens` | integer | 输出 Token 汇总 |
| `total_tokens` | integer | 总 Token 汇总 |
| `first_seen` | string/null | 最早产生使用记录的时间（ISO 8601） |
| `last_seen` | string/null | 最近产生使用记录的时间（ISO 8601） |
| `children` | array | 下级部门节点，字段结构与当前节点相同 |

### 汇总字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `total_departments` | integer | 有使用记录的部门总数 |
| `total_users` | integer | 所有部门范围内的去重用户数 |
| `total_conversations` | integer | 所有部门范围内的去重对话数 |
| `total_tokens` | integer | 根节点 Token 汇总 |
| `config_ids` | string[] | 当前已发现的智能体配置 ID 列表 |

---

## 7. 获取 Token 趋势

### `GET /token-timeseries`

返回输入 Token 与输出 Token 的时间序列数据。

```bash
curl "$YUXI_DASHBOARD_API/token-timeseries?time_range=14days" \
  -H "X-API-Key: $YUXI_DASHBOARD_API_KEY"
```

### 查询参数

| 参数 | 类型 | 必填 | 默认值 | 可选值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `time_range` | string | 否 | `14days` | `14hours`、`14days`、`14weeks` | 统计粒度与窗口：最近 14 小时、14 天或 14 周。 |

### 成功响应示例

```json
{
  "meta": {
    "generated_at": "2026-07-28T16:47:29.512144+08:00",
    "timezone": "Asia/Shanghai"
  },
  "data": {
    "data": [
      {
        "date": "2026-07-16",
        "data": {
          "input_tokens": 336635,
          "output_tokens": 19429
        },
        "total": 356064
      }
    ],
    "categories": ["input_tokens", "output_tokens"],
    "total_count": 356064,
    "average_count": 25433.14,
    "peak_count": 356064,
    "peak_date": "2026-07-16"
  }
}
```

### `data` 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | array | 时间点列表；即使某个时间点无用量也会返回 0，便于直接绘图 |
| `data[].date` | string | `14hours` 时格式为 `YYYY-MM-DD HH:00`；`14days` 时为 `YYYY-MM-DD`；`14weeks` 时为 `YYYY-WW` |
| `data[].data.input_tokens` | integer | 当前时间点输入 Token |
| `data[].data.output_tokens` | integer | 当前时间点输出 Token |
| `data[].total` | integer | 输入 Token 与输出 Token 之和 |
| `categories` | string[] | 固定为 `input_tokens`、`output_tokens` |
| `total_count` | integer | 当前查询窗口内总 Token |
| `average_count` | number | 当前查询窗口内每个时间点平均 Token |
| `peak_count` | integer | 当前查询窗口内最大 Token |
| `peak_date` | string | 峰值所在时间点 |

---

## 8. JavaScript / Node.js 调用示例

```js
const baseUrl = 'https://blendy.top:18888/api/open/dashboard';
const apiKey = process.env.YUXI_DASHBOARD_API_KEY;

async function getDepartmentUsage(agentConfigId) {
  const url = new URL(`${baseUrl}/department-usage`);
  if (agentConfigId) url.searchParams.set('agent_config_id', agentConfigId);

  const response = await fetch(url, {
    headers: { 'X-API-Key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`Dashboard API failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

const result = await getDepartmentUsage('3');
console.log(result.data.total_tokens);
```

## 9. 错误码与处理建议

| HTTP 状态 | 场景 | 响应/表现 | 调用方建议 |
| --- | --- | --- | --- |
| `200` | 请求成功 | JSON 统计结果 | 正常解析 |
| `401` | 缺少、错误或失效的 `X-API-Key` | `{"detail":"Invalid X-API-Key"}` | 检查请求头与密钥轮换情况 |
| `422` | 参数不合法 | 例如 `time_range` 不是允许值 | 修正参数后重试 |
| `429` | 请求频率超限 | Nginx 限流响应 | 退避重试；建议轮询间隔不低于 1 分钟 |
| `500` | 后端统计查询异常 | Yuxi 错误响应 | 记录请求 ID/时间并联系管理员 |
| `503` | 服务尚未配置公共 API 密钥 | `Open Dashboard API is not configured` | 联系管理员检查 `OPEN_DASHBOARD_API_KEY` 配置 |
| `502` / `504` | 公网反代或上游暂时不可用 | Nginx 网关错误 | 使用指数退避重试，避免并发重试风暴 |

## 10. 限流、缓存与调用建议

- 公网入口限流为**每个来源 IP 每分钟 30 次**，允许短时突发 20 次。
- `department-usage` 会聚合组织树和对话使用量，建议调用方缓存 **5–15 分钟**。
- `overview` 和 `token-timeseries` 建议按 **1–5 分钟**轮询，不建议高频刷新。
- 所有统计均为实时查询，受数据入库进度影响；新发生的对话或 Token 数据可能有短暂延迟。
- 请使用 HTTPS，不要尝试通过裸 IP 或 HTTP 传输 API Key。

## 11. 安全边界

开放接口仅含组织级和全局级聚合指标。以下能力仍只保留在 Yuxi 后台管理员接口中：

- 对话列表、对话标题、对话详情与消息正文；
- 用户姓名、手机号及用户级使用明细；
- 组织架构同步、备注编辑；
- 知识库、智能体、Skill、系统配置的所有管理操作。
