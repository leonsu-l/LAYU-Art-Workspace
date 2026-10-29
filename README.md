# NanoBanana Console

React + TypeScript 图片生成工作台，配有一个轻量 Node.js 后端。支持 OpenAI-Compatible、Gemini-Compatible 和自定义 Base URL。

**前端只提交任务与查询结果；供应商请求、等待图片、下载与保存全部由后端执行。** 后端确认接收后，刷新、关闭页面或切换到图库都不会取消任务。重新打开页面会恢复任务历史与结果。

## 项目结构

采用 **npm workspaces 单仓库、前后端独立应用**：

```text
apps/
  web/                 # React + Vite：前端源码、静态资源、配置与测试
    src/
    public/
    tests/
    .env.example
    package.json
  api/                 # Node.js：HTTP API、任务队列、供应商与持久化
    src/
    contracts/         # API 所有的纯契约、参数、校验和协议构造包
      src/
      package.json     # 包名仍为 @nanobanana/shared
    tests/
      contracts/       # API 管理的跨端协议一致性测试
    data/              # 历史任务与图片，完整迁移至此，不提交
    .env.example
    package.json
docs/
  examples/            # 示例图片，不混入应用源码
package.json           # 仓库级命令与开发工具
package-lock.json      # 全仓唯一锁文件
```

前后端通过 `/api` 通信，**Web 不导入 API 服务实现**；API 所有的[纯契约包](<apps/api/contracts/package.json>)继续通过 `@nanobanana/shared` 包名供两端使用。根级工作区只包含 `apps/*` 与 `apps/api/contracts`，不再单设根级契约、测试或运行数据目录。具体命令、独立调试及迁移说明见[开发指南](<docs/DEVELOPMENT.md>)。

## 快速开始

要求 **Node.js >= 22.18**（建议 Node 24 LTS），无需额外数据库、Redis 或后端框架。在仓库根目录安装一次依赖：

```sh
npm install
```

开发时使用两个终端，彼此不会自动启动或停止：

```sh
# 终端 1：后端，http://127.0.0.1:3001
npm run dev:api

# 终端 2：前端，http://127.0.0.1:5173
npm run dev:web
```

也可分别进入 `apps/api`、`apps/web` 执行 `npm run dev`。Vite 将 `/api` 转发到后端，浏览器不再直连供应商。前端支持热更新；修改后端代码后需重启后端，刻意不使用自动重启，避免中断正在生成的任务。

分别构建、启动本机构建预览：

```sh
npm run build:web
npm run build:api       # 原生 TypeScript 运行，build 只做类型检查

# 两个终端分别执行
npm run start:api       # http://127.0.0.1:3001
npm run start:web       # http://127.0.0.1:4173，Vite preview，非生产服务器
```

仍保留本机长期使用的兼容方式：`npm run build && npm start`，后端会同时提供 [前端构建产物](<apps/web/dist>)与 API，访问 **http://127.0.0.1:3001**。`npm run dev`、`npm run dev:server`、`npm run preview` 也保留为兼容入口。正式分离部署应由静态服务器提供前端，并将同源 `/api` 反向代理至本机后端；当前服务不应直接暴露公网。

### 配置

两端各自管理配置，默认值即可运行；需要修改时，将[后端配置示例](<apps/api/.env.example>)、[前端配置示例](<apps/web/.env.example>)分别复制为各自目录下的 `.env`，或设置进程环境变量：

| 应用 | 变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| API | `PORT` | `3001` | 后端端口 |
| API | `DATA_DIR` | `data` | **相对于 `apps/api`**或使用绝对路径，存放任务与图片 |
| API | `IMAGE_REQUEST_TIMEOUT_MS` | `180000` | 供应商请求超时，限制为 15000–600000 ms |
| Web | `VITE_API_PROXY_TARGET` | `http://127.0.0.1:3001` | Vite 开发与预览代理目标 |

旧根目录 `.env` 需迁移到 `apps/api`；后端不读取 `.env.local`。本次已将原根级 `server-data` 中的历史任务和图片完整迁至 [API 数据目录](<apps/api/data>)；旧配置 `DATA_DIR=server-data` 应改为 `DATA_DIR=data`，自定义相对路径也需按 API 目录的新基准调整，绝对路径支持不变。修改后端端口时，同步修改前端代理目标并分别重启。不要把密钥放进 `VITE_*` 变量；前端不会读取后端环境文件。旧的 `VITE_IMAGE_REQUEST_TIMEOUT_MS` 不再生效。

## 详细文档

- [开发指南](<docs/DEVELOPMENT.md>)：独立启动、调试、环境配置及根目录清理规则。
- [功能、数据与 API 参考](<docs/REFERENCE.md>)：模型参数、参考图限制、故障排查、任务恢复、数据安全与接口说明。

## 验证

```sh
npm run test:server
npm run build
```

API 测试包含任务测试与其管理的协议契约测试；根级 `npm test` 依次调用 API、Web 测试，不重复执行契约测试，`npm run test:contracts` 仅转发 API 的同名脚本。针对性测试使用本机模拟供应商与临时数据，不需要真实密钥，不会调用收费 API。覆盖脱离客户端连接的执行、幂等提交、重启恢复、写锁、存储失败恢复、URL 图片落盘、图库删除、跨站拒绝、协议错误/超时以及浏览器提交恢复。供应商超时测试约需 15 秒。
