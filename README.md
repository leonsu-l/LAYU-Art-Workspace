# NanoBanana Frontend Console

一个基于 React + TypeScript + Vite 的前端页面，用于连接图片生成供应商。

首版能力：

- 支持 OpenAI-Compatible 与 Gemini-Compatible 两种协议适配
- 所有协议均支持自定义 Base URL（不再存在不可修改的固定官方地址）
- 用户可配置：供应商、模型、API Key、Base URL 与协议专属生图参数（变更后自动缓存）
- 支持根据当前协议实时预览请求地址（endpoint）
- 生成成功后自动保存图片到本地 Gallery（IndexedDB）
- Gallery 支持总占用统计、图片预览弹窗、图片下载
- 主页标题区显示站点缓存总量（配置+Prompt+Gallery）
- 生成中刷新/关闭标签页会触发离页提示，避免图片结果丢失
- 样式体系采用 Tailwind CSS + CSS Modules（模块样式与布局样式分层）

## 快速开始

```bash
npm install
npm run dev
```

可选：在 `.env.local` 配置图片请求超时（毫秒），默认 `180000`（180 秒）。

```bash
VITE_IMAGE_REQUEST_TIMEOUT_MS=180000
```

生产构建：

```bash
npm run lint
npm run build
npm run preview
```

## 页面与架构说明

### UI 分区

- 连接配置面板：供应商、模型、密钥、Base URL、请求参数
- 提示词工作台：输入 prompt 并发起生成
- 结果面板：loading、错误态、图片结果展示
- Gallery 页面：本地图片列表、总占用、悬浮预览/下载按钮

### 分层约束

- `src/components`：纯 UI 与用户交互
- `src/hooks`：状态编排与页面用例逻辑
- `src/services`：供应商适配器与 API 调用
- `src/types`：领域类型
- `src/utils`：校验、错误、存储等纯工具

依赖方向固定：`components -> hooks -> services`。

## 协议配置规则

- `openai-compatible`
  - Endpoint 自动补全为 `/v1/images/generations`
  - 支持参数：`size`、`aspect_ratio`、`quality`、`n`
- `gemini-compatible`
  - Endpoint 自动补全为 `/models/{model}:generateContent?key=...`
  - 支持参数：`image_size`、`aspect_ratio`、`imageOnly`、`thinkingLevel`

两种协议的配置（Base URL、模型、密钥、参数）相互独立，切换协议不会互相覆盖。

## 持久化策略

- 配置与提示词会自动写入 `localStorage`
- 生成图片使用 `IndexedDB` 保存到本地 Gallery
- API Key 采用自动缓存，并通过非阻断提示条提示本地存储风险
- 主页显示缓存总量：`localStorage`（配置+Prompt）+ `IndexedDB`（Gallery）

## 离页保护

- 当请求进行中且尚未收到图片时，页面会通过 `window.onbeforeunload` 进行离页拦截。
- 若此时刷新或关闭标签页，浏览器会提示离开风险（具体提示文案可能被浏览器替换为默认文本）。

## 安全与风险说明

当前是纯前端直连方案，API Key 存在浏览器端暴露风险，且可能受到 CORS 策略影响。

生产环境建议改为后端代理方案：

- 前端不持久化敏感密钥
- 后端统一鉴权、限流与审计
- 规避浏览器跨域限制并提升可控性

## 后续扩展预留

首版仅启用文本生图。

已在服务层和类型层预留：

- 参考图编辑能力（image-to-image）
- 多轮会话历史能力
