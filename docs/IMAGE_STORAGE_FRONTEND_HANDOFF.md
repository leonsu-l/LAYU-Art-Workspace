# 前端任务委派：图片有效期、存储管理与问题日志

接手范围：把以下后端契约接入图库、任务历史和管理员后台。**普通用户只需要知道图能保存多久；不应知道文件在本地、R2 或曾经回退。** 页面结构、交互和视觉设计由前端 agent 决定。本次未改前端。

## 1. 图库与任务：两个不同的有效期字段

`GET /api/gallery` 仍返回 `images`，新增顶层 `retentionDays`。即使图库为空也有该字段。下面只列与此次变更相关的字段；原有 `id`、`createdAt`、`provider`、`model`、`prompt`、`mimeType`、`bytes`、`url` 均保留。

```json
{
  "retentionDays": 7,
  "images": [
    {"id":"…", "url":"/api/images/…", "retentionDays":30, "expiresAt":"2026-12-19T08:00:00Z"},
    {"id":"…", "url":"/api/images/…", "retentionDays":null, "expiresAt":null}
  ]
}
```

- **顶层** `retentionDays` 是现在保存新生成图时的政策；`null` 表示永久。**每张图**的 `retentionDays` 和 `expiresAt` 才是这张图的承诺。按整组图片保存成功起算，每天 24 小时；`expiresAt` 是 UTC 时间点，可转换为用户本地时间。不要用供应商的 `createdAt`、提交时间或当前政策重算。上例的三种值同时出现是正常的。
- 新任务的 `result.images[]` 在原有 `mimeType`、`url` 外也带 `retentionDays`、`expiresAt`。升级前的图库图永久；旧任务结果 JSON 可能根本没有这两个字段，同样按永久处理。这里的 `provider` 始终指生成渠道协议，不是文件存储来源。
- 到期的是**整个成功任务及其全部生成图**，不是用坏图占位来保留历史。到点后，`GET /api/tasks`、图库列表和 `GET /api/gallery/stats`（仍为 `{imageCount,totalBytes}`）都不再包含这组数据。本人查询任务详情、用合法原请求重放该 UUID 返回 **410**；其他用户查询返回 **404**。过期图片 URL 返回 **404**，不暴露到期、文件不存在和无权访问的区别。
- 详情上的 410 是已删除，不是未知提交，不要自动创建新任务。图片 404 不能单独证明已到期，可重新拉取图库/任务列表；勿保留已经失效的预览。手动删图库中一张图仍会删除整个任务组；成功任务的额度与管理用量历史不因删除而撤销。
- 预览/下载继续使用原 `url`、同源会话和 `no-store`。即便 R2 写入失败而改存本地，成功响应和 URL 形状也不变。服务端拒绝到期后的新读取，但无法撤销用户已下载的副本。

现有接入点：[图库服务](../apps/web/src/services/galleryService.ts)当前丢弃顶层策略；其中 `source: 'server'` 只是区分历史浏览器图库的客户端标记。请一并更新关联类型，不要新增用户可见的物理来源字段。[任务轮询](../apps/web/src/hooks/useImageGeneration.ts)及[提交恢复](../apps/web/src/services/imageGenerationService.ts)已有 410 分支，应继续使用。

## 2. 管理员：新图写入策略与私有桶

以下均在 **`/api/admin/storage`** 下，只允许管理员。存储设置是独立接口；不要合并到旧的 `/api/admin/settings`（它仍只负责额度和并发）。

| 方法与相对路径 | 请求 | 成功响应 |
| --- | --- | --- |
| `GET /settings` | — | `{activeBucketId, retentionDays}`，无外层包装 |
| `PUT /settings` | 两个字段都必传：`activeBucketId: UUID 或 null`，`retentionDays: 1..3650 的整数或 null` | 同 GET |
| `GET /buckets` | — | `{buckets: BucketInfo[]}` |
| `POST /buckets` | `accountId, bucketName, accessKeyId, secretAccessKey` 必填；`jurisdiction, analyticsToken` 可选 | `{bucket: BucketInfo}` |
| `PATCH /buckets/{id}` | 只能传 `accessKeyId, secretAccessKey, analyticsToken` 的需要变更项 | `{bucket: BucketInfo}` |
| `DELETE /buckets/{id}` | — | `{ok:true}`；仍有引用时 409 |
| `GET /buckets/{id}/usage` | — | 见下一节 |

`activeBucketId: null` 表示本地；`retentionDays: null` 表示永久；两者独立且均为出厂默认。新建桶配置**不会自动启用**。策略切换不迁移文件、不追溯改期。切回本地也不会停用旧桶的读、删和密钥轮换。

`BucketInfo = {id,accountId,bucketName,jurisdiction,hasAccessKeyId,hasSecretAccessKey,hasAnalyticsToken}`；后三个 `has…` 是布尔值，不是遮罩后的密钥。账户 ID 为 32 位十六进制；桶名 3–63 位小写字母、数字与连字符，首尾不能为连字符。`jurisdiction` 为 `default`（省略时默认）、`eu` 或 `fedramp`。这里登记的是已有私有桶，接口不创建或删除 Cloudflare 的桶本身。

凭据只写不回显。PATCH 中**省略**某凭据表示不变，不能用空串或遮罩占位符代替。只有 `analyticsToken: null` 表示显式清除可选统计令牌。不要把凭据放入 URL、日志、持久客户端状态或遥测。桶身份不可修改；要换账户、桶名或辖区，创建新配置再切换。正在作为新图目标、仍有图片、在途写入或待清理对象的配置不可移除（409）；同一桶重复登记也是 409。即使本应用有效图片数为 0，也可能有待删对象或等待二次核查的写入（写入结果不确定时，约一天后复查）；不要仅凭用量判断可删除。

## 3. 管理员：同桶两种用量

```json
{
  "application": {"imageCount":2, "totalBytes":8000},
  "cloudflare": {"status":"available", "payloadBytes":10000, "metadataBytes":420, "objectCount":3, "sampledAt":"2026-11-19T08:00:00Z"}
}
```

`application` 只计算本应用在**该桶**仍有效的图库图，不包括回退本地、已过期或待删对象。`cloudflare` 是该账户该桶在 [Cloudflare Analytics API](https://developers.cloudflare.com/r2/platform/metrics-analytics/#storage) 最近 31 天内最新的整桶样本；对象内容 `payloadBytes` 与元数据 `metadataBytes` 分列。对比图片字节时使用 `payloadBytes`，不要把差值当作泄漏或待删数量。其他应用对象、清理时差和指标延迟均可造成差异。`sampledAt` 是官方采样时间，不是页面请求时间。

| `cloudflare.status` | 含义 |
| --- | --- |
| `available` | 有样本；数值为 0 时才表示测得 0 |
| `not_configured` | 未配独立的 Analytics Token |
| `forbidden` | 官方查询的身份/权限被拒绝 |
| `no_data` | 查询未得到样本 |
| `unavailable` | 网络、限流、格式异常等原因暂不可用 |

后四种状态下官方数值和时间均为 `null`，HTTP 仍可成功，`application` 仍有值。勿把 `null` 显示成 0。令牌需要 [Account → Account Analytics → Read](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)，不是 R2 S3 读写密钥；不配令牌不影响存取图片。

## 4. 管理员：站内待处理问题

| 接口 | 契约 |
| --- | --- |
| `GET /api/admin/issues/summary` | `{openCount}`：未处理问题条数，不是累计发生次数 |
| `GET /api/admin/issues?page=0&size=20&status=open` | `{issues, page, size, total}`。`page` 从 0 开始、最大 10000；`size` 1–100；`status` 可省略（全部），或 `open` / `resolved`。按最近发生时间倒序。 |
| `POST /api/admin/issues/{id}/resolve` | 无需请求体，返回 `{ok:true}`；不存在或已过期 404 |

每条问题包含 `id, kind, taskId, ownerId, channelId, bucketId, errorCode, status, occurrences, firstSeen, lastSeen, impact, advice`。上下文 ID 可以为 `null`；`firstSeen` / `lastSeen` 是 **Unix 毫秒数**，与图片的 ISO 字符串不同。`impact` 和 `advice` 是后端提供的安全描述，不需要拼接原始异常。

`kind` 为 `GENERATION_FAILED`（生成失败）、`R2_FALLBACK`（R2 写失败，转试本地）、`IMAGE_WRITE_FAILED`（保存未完成）、`IMAGE_READ_FAILED`（有效记录对应的文件读失败）或 `IMAGE_DELETE_FAILED`（物理清理未完成）。回退告警本身不等于生成失败；若本地也写失败，另有保存故障，任务走原有失败/退额流程。服务端不因回退重新调用上游。

同一问题重复发生会累加 `occurrences` 并更新 `lastSeen`；标记处理后再发生会重新变为 `open`。标记处理**不会**触发重新生成、修复或删除文件。按最近发生时间保留 30 天，独立于任务删除。仅站内查询，不需浏览器上报或站外推送。问题中没有提示词、图片、原始上游响应或密钥。

## 联调验收

1. 空图库也能说明新图默认政策；同时有永久、7 天、30 天图时，各图显示自己的真实有效期。图库和任务均不显示桶/回退信息。
2. 修改策略、切桶后，旧图仍可打开且到期日不变；过期任务从历史、图库和统计同步消失，旧 URL 失效，不自动重放或扣费。
3. 管理员可轮换旧桶凭据、区分“不能删除仍在用的配置”和网络失败；官方用量不可用时仍显示本应用数字。普通账号不请求管理员接口。
4. R2 回退成功时用户可读图，管理员可发现、查看和处理相应告警；重复发生能看到累计次数和重新打开的状态。

接口统一采用现有[会话、CSRF 与错误处理](../apps/web/src/services/backendClient.ts)：Cookie 鉴权；POST/PUT/PATCH/DELETE 带 `X-XSRF-TOKEN`；错误形状 `{error:{code,message,retryable,status}}`。不要把跨用户或已注销会话的缓存带到新会话。
