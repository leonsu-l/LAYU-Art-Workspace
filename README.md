# NanoBanana Frontend Console

一个基于 React + TypeScript + Vite 的前端页面，用于连接图片生成供应商。

首版能力：

- 支持 Gemini 官方图片链路（默认模型 `gemini-3.1-flash-image-preview`）
- 支持 OpenAI-Compatible 和自定义 OpenAI-Compatible Base URL
- 用户可配置并持久化保存：供应商、模型、API Key、Base URL
- 样式体系采用 Tailwind CSS + CSS Modules（模块样式与布局样式分层）

## 快速开始

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run lint
npm run build
npm run preview
```

## 页面与架构说明

### UI 分区

- 连接配置面板：供应商、模型、密钥、Base URL、持久化行为
- 提示词工作台：输入 prompt 并发起生成
- 结果面板：loading、错误态、图片结果展示

### 分层约束

- `src/components`：纯 UI 与用户交互
- `src/hooks`：状态编排与页面用例逻辑
- `src/services`：供应商适配器与 API 调用
- `src/types`：领域类型
- `src/utils`：校验、错误、存储等纯工具

依赖方向固定：`components -> hooks -> services`。

## 供应商配置规则

- `gemini-official`
  - 使用 Gemini 官方 REST 接口
  - Base URL 在首版中固定，不从 UI 覆盖
- `openai-compatible`
  - 按 OpenAI-Compatible 协议请求图片端点
- `custom-openai-compatible`
  - 用户自定义 Base URL，自动补全 `/v1/images/generations`

## 持久化策略

- 使用 `localStorage` 保存配置
- 可选保存 API Key
- 首次保存 API Key 时会弹窗提示风险确认
- 可通过页面按钮清空本地配置

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
