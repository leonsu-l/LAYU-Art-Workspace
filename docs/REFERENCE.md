# 功能、数据与 API 参考

[返回项目首页](<../README.md>) · [开发与目录约定](<DEVELOPMENT.md>)

## 图片模型与参数

模型通过下拉列表选择，保留“自定义模型 / 兼容服务别名”入口；选项按模型能力联动，切换时自动回退不支持的参数。

- **GPT**：GPT Image 2.5 Sunburst / Flare、2、1.5、1 Mini、1。支持图片质量、数量、背景、PNG/JPEG/WebP、JPEG/WebP 压缩质量及审核等级。2 / 2.5 支持受约束的自定义尺寸；更早模型使用固定尺寸。比例由尺寸决定，不发送 `aspect_ratio`、`response_format` 等非 GPT Images 生成字段。
- **Gemini**：Nano Banana 2.1、Nano Banana 2 Lite、3.1 Flash Image、3 Pro Image、2.5 Flash Image。根据型号开放分辨率、比例、思考深度及纯图片/图文输出。2.5 不发送分辨率或思考参数，Pro 思考由模型管理。Lite 的 512 档在官方文档中存在冲突，暂只开放已确认的 1K。
- 浏览器旧配置会补齐新字段，`standard` / `hd` 质量迁移为 `medium` / `high`。官方 Gemini 地址下的已退役 preview ID 在读取配置时迁移为稳定 ID；第三方服务的模型别名、API Key 和 Base URL 保留。
- 自定义 ID 使用保守的基础参数；第三方代理是否提供该模型及完整参数，以实际服务为准。Gemini 沿用正式 API 仍支持的 `generationConfig.imageConfig`，不会同时发送两套图像配置。

能力依据：[OpenAI 图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)、[Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Gemini 图片生成指南](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en)、[Gemini API 参数](https://ai.google.dev/api/generate-content?hl=en)。这些能力已做本地协议测试，不代表已验证账号权限或第三方网关可用性。

### 文生图与参考图生成

两类接口都支持文生图及“文字 + 图片”生成。在提示词下方 **拖入图片或点击上传区域**，可批量选择、预览和逐张移除参考图；拖入时高亮，超限或格式错误会提示且保留原有选择。支持键盘聚焦并打开文件选择器，不接收文件夹或网页图片链接；拖到区域外不会让浏览器跳转打开文件。没有参考图时保持原来的文生图流程。使用多张图时，可在提示词中用“第 1 张”“第 2 张”说明各自作用。

参考图限制随所选协议与模型联动，前后端共用同一套校验：

| 模型 | 应用最多张数 | 单张上限 | 原图合计上限 |
| --- | --- | --- | --- |
| GPT Image 系列 | 16 | 20 MiB | 32 MiB |
| Gemini Nano Banana 2.1、3.1 Flash Image、3 Pro Image、3.1 Flash Lite Image | 14 | 12 MiB | 12 MiB |
| Gemini 2.5 Flash Image、未识别的自定义 Gemini 型号 | 3（保守策略） | 12 MiB | 12 MiB |

- 旧版的 3 张 / 4 MiB / 8 MiB 是应用保守值，不是统一的官方上限。GPT 官方编辑接口为最多 16 张、每张小于 50 MB；目前应用仍以 20 / 32 MiB 控制浏览器内存、本地 JSON 传输和任务落盘体积。
- Gemini 内联**整个请求**上限为 20 MB。原图合计 12 MiB 编码后约 16 MiB，剩余空间用于提示词与配置，因此不能直接把 20 MB 当作原图总额；更大文件需另行接入 Files API。Gemini 2.5 的 3 张是官方效果建议，并非已确认的硬上限；自定义模型能力未知，暂用保守张数。Lite 虽可接收 14 张，但官方提示并未针对多参考图编辑优化。
- 仅接受 PNG / JPEG / WebP，不接受 SVG、GIF 或 HEIC。切换模型时不会自动删图；如果已有图片超出新模型限制，保留预览、显示原因并禁用新任务提交，直到移除部分图片或切回合适模型。
- GPT 有参考图时自动改用 `/v1/images/edits`，通过 multipart `image[]` 上传；无参考图时使用 `/v1/images/generations`。图片尺寸、数量、质量、输出格式等继续有效；multipart 编辑模式采用供应商默认审核，不发送 `moderation` 或 `input_fidelity`。第三方兼容服务需同时支持 edits 路由。
- Gemini 保持 `generateContent`，在用户 `parts` 内同时发送文字及 `inlineData` 图片，继续使用所选模型的图片生成参数。
- 参考图只在创建任务时发送至本机后端及所选供应商，不写入浏览器 localStorage；请求预览隐藏图片 Base64。后端将参考图暂存于排队任务中以支持重启恢复，终态后随原始请求一并移除，不自动加入图库；任务 API 仅返回参考图数量，不返回原图。异常临时文件/备份仍可能包含原图，应视为敏感数据。
- 在页面未刷新时，重试使用冻结的原请求（包括参考图）。刷新后，如果提交尚未确认，需要按原顺序重新选择同名、同内容的图片，并保持原提示词、配置和密钥；图片内容或顺序变化不会覆盖旧任务。**已确认接收的任务不需要重新上传。**

接口依据：[OpenAI 图片编辑 API](https://developers.openai.com/api/reference/resources/images/methods/edit)、[官方 SDK multipart 参数](https://github.com/openai/openai-node/blob/master/src/resources/images.ts)、[Gemini 图片生成/编辑指南](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en)、[Gemini 内联图片请求限制](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding?hl=en)。本功能未包含蒙版局部编辑或多轮会话。

### 请求尺寸与实际输出不一致

- GPT 的生成和参考图编辑均通过 `size=WIDTHxHEIGHT` 请求尺寸。Sunburst 的 `3840x2160` 符合官方规则，但高于 `2560x1440` 的输出为实验性功能；第三方中转仍可能忽略、重映射参数或改变返回图片。
- 结果区明确区分“请求尺寸/比例”和解码后的“原图宽 × 高”。新任务保留请求尺寸供历史查询；实际原图尺寸不一致时显示提示。旧任务若只保留了明确的非方形比例，仍可检测明显比例偏差；旧记录的 `1:1` 可能曾代表自动模式，不据此推断异常。
- 保存和下载均保留供应商返回的原始字节，不会为凑尺寸自动裁剪、拉伸或放大。不一致的输出仍保存，任务成功仅代表生成结果已落盘；不会因此自动重新请求或创建第二个付费任务。
- 如请求 `3840x2160` 却下载到方图，请向服务商提供任务时间、模型、`/v1/images/edits`、`size=3840x2160` 和实际输出尺寸，核对该次请求日志及该线路是否支持编辑模式 16:9 / 4K。不要仅通过补充官方接口没有的 `aspect_ratio` 字段猜测修复。

**New API 管理员排查：**

- 以官方 `v1.0.0-rc.44` 源码为例，[multipart 入口](https://github.com/QuantumNous/new-api/blob/633b4c5b190dc1af99a2814391354d86948e7943/relay/helper/valid_request.go#L184-L236)明确读取 `size`，[标准 OpenAI 渠道](https://github.com/QuantumNous/new-api/blob/633b4c5b190dc1af99a2814391354d86948e7943/relay/channel/openai/adaptor.go#L520-L647)会保留除重新映射的 `model` 外的普通表单字段。旧版 DALL·E 编辑文档的方形枚举不能用于推断 Sunburst 必须输出方图。
- 请检查**该次请求实际命中的渠道**：渠道类型、模型映射、参数覆盖/透传设置，以及是否由任务插件接管。模型列表中的名称或 `owned_by` 不能证明实际上游模型和转换路径。入口日志中的 `Size` 也只证明入口解析到了参数，不能证明渠道出站请求和返回像素尺寸。
- 最有价值的脱敏证据是：请求时间/请求 ID、实际渠道、出站 `model` / `size` / 比例字段、返回文件宽高。不要提供 Authorization、API Key、参考图 Base64 或私人提示词。
- 网关返回 `504` 且提示上游拨号 `i/o timeout` 时，没有拿到图片，不能据此判断尺寸是否合法或是否被执行；提高本机等待时间不能修复网关到上游的拨号超时。同步请求结果未知时不要自动重复付费调用。

## 使用方式与恢复边界

1. 在页面配置协议、Base URL、模型、API Key，输入提示词并创建任务。
2. **等到出现“后端已接收”后即可关闭页面。** 正在提交、尚未确认时仍会显示离页提醒。
3. 后端串行处理任务；页面可继续提交其他任务，历史记录显示排队、生成、成功或失败。
4. 重新打开页面，会先发现已有任务再开放提交。连接中断只表示暂时无法查询，不会把后端任务误判为失败。
5. 新图片保存在后端磁盘，并在图库展示、下载与删除。旧 IndexedDB 图库保留、单独标记来源，不会自动迁移或清空；新图片不会重复写入浏览器图库。

提交前会保存不含密钥的 UUID/时间/请求指纹。网络中断导致提交结果未知时，页面先查询该 UUID；手动重试也沿用同一 UUID 和原始内容，不会自动创建第二个付费任务。刷新后重试需要原提示词、当前协议配置、API Key 与参考图内容/顺序保持一致。使用支持 Web Locks 的现代浏览器，通过 localhost/127.0.0.1 或 HTTPS 访问。

**关闭浏览器不等于关闭后端。** 关闭后端进程、主机休眠或断网仍可能影响生成；需要长期无人值守时，应让这台机器保持运行，并由操作系统服务/进程管理器托管 `npm start`。

### 删除历史与图片

- 任务历史中的每条已成功或失败任务均可点击 **删除**；确认后删除该任务记录及其全部生成图片（包括图库条目和后端磁盘文件）。失败且没有图片的任务也可删除。
- 后端图库与任务按**整个生成任务**联动：删除其中任意一张图片，也会删除所属任务历史及同任务的其他图片，即使其他图片没有被选中。批量删除按任务去重，实际删除张数可能大于选中张数；操作不可撤销，请先下载需要保留的图片。
- 排队中、生成中的任务不允许删除（接口返回 409），避免记录消失但供应商仍在执行/计费；这不是取消生成接口。浏览器旧图库没有后端任务关联，仍只删除选中图片。
- 删除后的任务不再返回到历史或图库；后端仅保留最小任务 ID 删除标记，以拒绝延迟到达的旧请求（410），防止误重试造成重复付费。删除不清除当前编辑中的提示词、配置或参考图。
- 记录先原子删除，再清理磁盘文件；清理未完成时保存待清理列表，重试删除或重启后端会继续，不会恢复已删任务。磁盘清理失败会提示错误；临时文件和备份仍可能保留旧数据，应自行管理。

### 后端重启

- 已成功保存的任务与图片会保留。
- 尚未发往供应商的排队任务继续执行。
- 已写入完成收据、但任务索引尚未提交的结果，会从本地收据恢复，**不再次请求供应商**。
- 已经发往供应商但没有完成收据的任务标记为中断失败，不自动重试：同步供应商接口无法保证跨进程重启续传，原请求可能已扣费。
- 正常停止时尽量等待当前任务完成，未开始的任务留在队列。

每个数据目录只允许一个后端写入，即使使用不同端口也不能共用同一目录运行两个实例。异常退出后会检查旧进程 PID 并回收确认失效的锁；锁损坏、PID 被复用或恢复过程自身被中断时会拒绝启动。**只有确认所有使用该目录的进程都已停止后**，才可人工检查并移除 `writer.lock` / `writer-recovery.lock`。不要在后端运行中删除锁。

## 数据与安全

默认 `DATA_DIR=data`，相对路径以 `apps/api` 为基准；绝对路径支持不变。默认数据目录结构：

```text
apps/api/data/
  state.json           # 任务与图库索引
  images/              # 实际图片，文件名前缀为任务 UUID
  completed/           # 待合并到索引的完成收据（正常完成后清理）
  writer.lock          # 单实例写锁
```

本次已将原根级 `server-data` 中的历史任务和图片完整迁到 [API 数据目录](<../apps/api/data>)。旧配置 `DATA_DIR=server-data` 需改为 `DATA_DIR=data`；自定义相对路径需按 API 目录的新基准调整，不能继续按仓库根目录解释。

- 任务接收前先落盘；状态通过临时文件替换提交。供应商返回 URL 时，后端立即下载，不依赖可能过期的远程链接。
- 图片支持 PNG/JPEG/WebP/GIF，每张最多 25 MiB，远程图片下载超时 60 秒；待处理任务上限 100 个。
- 磁盘写入失败会暂停工作并提示检查存储。已经完整下载的结果不会因索引写入失败被删除；修复磁盘并重启可恢复已写好的收据。如果连收据也无法写入，可按图片文件名中的任务 UUID 人工找回图片。断电/磁盘损坏仍需备份保障。
- 配置、提示词和 API Key 延续原来的浏览器本地缓存方式。后端为执行排队任务，会**临时以明文保存当前协议的 API Key**；任务正常进入终态后从当前记录移除。API 响应不返回任务密钥；未使用协议的密钥不发送、不存储。异常产生的临时文件和备份也必须视为敏感数据。
- 默认数据目录与 `.env` 已忽略提交。自定义 `DATA_DIR` 时请自行排除版本控制并设置权限；备份应包含整个数据目录，推荐停止后端后备份。
- **当前是单用户、本机后端，不是公共服务。** 仅监听 `127.0.0.1`，校验 Host/Origin 与跨站请求，不开放 CORS。未实现账户鉴权、多租户隔离或公网配额控制；不要直接反向代理到公网。自定义供应商地址和远程图片 URL 也应只来自可信配置。

## 架构

- [供应商执行入口](<../apps/api/src/providerService.ts>)、[OpenAI 适配器](<../apps/api/src/providers/openAICompatibleAdapter.ts>)、[Gemini 适配器](<../apps/api/src/providers/geminiOfficialAdapter.ts>)：Node 原生 fetch、超时、协议解析。
- [任务队列](<../apps/api/src/taskStore.ts>)、[图片存储](<../apps/api/src/imageStorage.ts>)、[目录写锁](<../apps/api/src/storeLock.ts>)：与页面生命周期无关的执行与持久化。
- [HTTP 应用](<../apps/api/src/app.ts>)、[启动入口](<../apps/api/src/index.ts>)：API 与生产静态页面。
- [前端任务服务](<../apps/web/src/services/imageGenerationService.ts>)、[任务 hook](<../apps/web/src/hooks/useImageGeneration.ts>)：提交、轮询、恢复与任务选择。
- [图库服务](<../apps/web/src/services/galleryService.ts>)：合并后端图库与浏览器旧图库，按来源下载/删除。
- [请求预览](<../apps/web/src/services/requestPreview.ts>)、[API 契约包中的协议构造](<../apps/api/contracts/src/utils/providerRequests.ts>)：纯请求预览与参数构造。API 所有的纯契约代码继续通过 `@nanobanana/shared` 包名供 Web 使用，浏览器不导入供应商执行代码或其他 API 服务实现。

主要接口（JSON，`/api` 同源）：

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/tasks` | `{ id: UUID, prompt, config, referenceImages?: [{ name, mimeType, base64Data }] }`（请求体最多 44 MiB，参考图另受模型限额约束）；持久接收后返回 202 和 `{ task }`；同 ID 同内容不重复执行，不同内容返回 409；已删除 ID 返回 410，不会重放 |
| `GET /api/tasks` | `{ tasks }`，包含历史与未完成任务 |
| `GET /api/tasks/:id` | `{ task }`；未知任务为 404，已删除任务为 410 |
| `DELETE /api/tasks/:id` | 删除终态任务及全部关联图片；返回 `{ deletedTaskCount, deletedImageCount }`，重复删除为 0；进行中返回 409 |
| `GET /api/gallery` | `{ images }`，只返回元数据与本地图片 URL |
| `GET /api/gallery/stats` | `{ totalBytes, imageCount }` |
| `DELETE /api/gallery/:id` | 删除该图片所属任务历史及同任务全部图片，返回实际 `{ deletedCount }` |
| `POST /api/gallery/delete` | `{ ids }`，每批最多选择 1000 张；按所属任务整组删除，返回实际 `{ deletedCount }` |
| `GET /api/images/:filename` | 读取已登记的图片 |
| `GET /api/health` | 服务连通性检查 |
