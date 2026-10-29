# 开发与目录约定

## 职责边界

- [Web 应用](<../apps/web/package.json>)：React 页面、组件、hooks、浏览器存储与 API 客户端；静态资源放在其 [public 目录](<../apps/web/public>)，构建结果写入该应用的 `dist`。
- [API 应用](<../apps/api/package.json>)：HTTP 服务、任务队列、供应商请求与磁盘持久化；使用 Node.js 原生 TypeScript，无需先编译 JavaScript。
- [API 契约包](<../apps/api/contracts/package.json>)：归 API 所有的纯请求/响应类型、默认参数、模型能力、通用校验与协议构造；包名与导出保持不变，两端通过 `@nanobanana/shared/types/*`、`@nanobanana/shared/utils/*` 引用，不使用只对 TypeScript 生效的路径别名，也不将 API 服务实现暴露给 Web。
- 浏览器专属的拖拽、FileReader、图片解码逻辑保留在 [Web 参考图工具](<../apps/web/src/utils/referenceImages.ts>)；API 不依赖这些功能。
- 后端任务测试在 [API 测试目录](<../apps/api/tests>)；前端服务测试在 [Web 测试目录](<../apps/web/tests>)；同时涉及两端的[协议测试](<../apps/api/tests/contracts/providers.test.ts>)归 API 管理，不反向成为应用运行依赖。
- [示例图片](<examples>)不作为应用运行资源；原根级 `server-data` 中的历史任务和图片本次已完整迁至 [API 数据目录](<../apps/api/data>)，该目录不提交。

Web 不得通过相对路径导入 API 服务实现；两端共用的纯契约逻辑由 API 契约包提供。运行数据放在 API 应用内独立的数据目录，不混入源码或构建目录。根级工作区配置为 `apps/*` 与 `apps/api/contracts`；根目录只保留仓库级配置、统一锁文件和命令入口，不再保留根级 `packages`、`tests` 或 `server-data`。

## 根目录文件与清理规则

根目录保留仓库级入口和工具配置，不以“文件越少越好”为目标，也不为隐藏配置增加额外的启动参数。

| 文件或目录 | 用途 | 删除 / 迁移建议 |
| --- | --- | --- |
| [package.json](<../package.json>) | npm 工作区定义、统一命令与公共开发工具 | 保留根目录；不是前端或后端的重复配置 |
| [package-lock.json](<../package-lock.json>) | 全仓唯一依赖锁文件，供 `npm ci` 精确安装 | 保留并提交；不迁入某个应用，也不在应用下另建锁文件 |
| [.gitignore](<../.gitignore>) | 排除依赖、构建产物、密钥和本机运行数据 | 保留根目录 |
| [eslint.config.js](<../eslint.config.js>) | Web、API、契约包及测试的统一检查规则 | 保留根目录，保证命令与编辑器自动发现 |
| [README.md](<../README.md>) | 项目首页、目录概览和快速开始 | 保留精简入口；详细功能与 API 说明已迁至[参考文档](<REFERENCE.md>) |
| [.git](<../.git>) | 版本历史、分支和仓库元数据 | 不删除、不迁移；删除会丢失本地版本控制信息 |
| [.vscode](<../.vscode>) | 前后端独立调试配置 | 保留；删除不会影响命令行启动，但会失去现成的 VS Code 调试入口 |
| [apps](<../apps>) | 独立的 Web / API 应用、契约包、各自测试和 API 数据 | 保留；应用所有的文件统一归入对应应用 |
| [docs](<.>) | 开发指南、功能参考和示例图片 | 保留；详细文档和示例不再放在根目录 |
| [node_modules](<../node_modules>) | npm 安装生成的依赖与工作区链接 | 可以删除后在根目录用 `npm ci` 重建，但删除后无法直接开发、构建或启动；日常保留，不手工迁移 |

本次归属调整：原 `packages/shared` 已迁入 [API 契约包目录](<../apps/api/contracts>)；原 `tests/contracts` 已迁入 [API 协议测试目录](<../apps/api/tests/contracts>)，原根级测试类型配置已移除，由 API 的配置覆盖；原 `server-data` 已完整迁入 [API 数据目录](<../apps/api/data>)，不是删除历史数据。根目录不再保留这三个目录。

API 数据目录包含历史任务、生成图片、持久化状态及写锁，**不是缓存，不可随意删除**。后续更换数据位置，需先停止后端、备份并显式配置 `DATA_DIR`。

可按需清理的内容是日志、临时文件和可重新生成的构建产物，例如 [Web 构建目录](<../apps/web/dist>)；删除后需重新执行 `npm run build:web`，构建预览和后端静态页面在重建前不可用。本次保留根级五个必要文件、`.git` 与 `.vscode`；迁移后已更新锁文件及 `node_modules` 中的契约包工作区链接，没有清空依赖目录。

不要因 Git 状态显示旧路径为删除、新目录为未跟踪，就删除新目录或还原旧文件；目录迁移尚未提交时出现这种状态是正常的。

## 安装与独立运行

在仓库根目录执行一次 `npm install`，或使用 `npm ci` 按锁文件安装；不在每个应用里分别创建锁文件。不需要 pnpm、Turborepo 或额外的并发启动工具。

| 根目录命令 | 作用 |
| --- | --- |
| `npm run dev:web` | 仅启动前端开发服务器，`http://127.0.0.1:5173` |
| `npm run dev:api` | 仅启动后端，默认 `http://127.0.0.1:3001` |
| `npm run debug:api` | 仅启动后端并开放本机 `9229` Inspector 调试端口 |
| `npm run build:web` | 前端类型检查、构建 |
| `npm run build:api` | 后端与其共享依赖类型检查，无编译产物 |
| `npm run start:web` | 单独预览前端构建，`http://127.0.0.1:4173`，不是生产静态服务器 |
| `npm run start:api` | 单独启动后端，不启动前端进程 |
| `npm run typecheck` | 检查所有应用、API 契约包和协议测试 |
| `npm run test:web` | 前端提交与恢复服务测试 |
| `npm run test:api` | API 管理的任务、持久化、HTTP 及协议契约测试 |
| `npm run test:contracts` | 转发 API 同名脚本，仅运行其协议契约测试 |
| `npm run lint:web` / `npm run lint:api` | 分别检查前端 / 后端 |

也可以进入应用目录后运行 `npm run dev`、`npm run build`、`npm start` 或 `npm test`，npm workspace 会找到根级已安装的工具和 API 契约包。后端默认不 watch，避免代码保存触发重启、影响正在生成的任务；前端正常热更新。

统一命令 `npm run build`、`npm test`、`npm run lint` 仍可用。API 的 `npm test` 包含任务与契约测试，根级 `npm test` 仅调用 API 与 Web，不再额外执行一次契约测试。旧命令 `npm run dev` 指向 Web，`npm run dev:server` 指向 API，`npm run preview` 指向 Web 构建预览，`npm run test:server` 保留原先三组测试覆盖。

## 环境配置

- [API 配置示例](<../apps/api/.env.example>)复制到同目录 `.env`，供后端启动脚本读取；进程环境变量优先。
- [Web 配置示例](<../apps/web/.env.example>)复制到同目录 `.env`；Vite 支持自己的 `.env.local` / 按 mode 的环境文件。
- 根目录旧 `.env` **不再自动读取**，已有配置请迁入 API 应用目录。后端 `PORT` 和前端 `VITE_API_PROXY_TARGET` 分开配置；端口变更时同步修改代理目标、分别重启。
- 后端默认 `DATA_DIR=data`，解析为 [API 数据目录](<../apps/api/data>)。所有相对 `DATA_DIR` **改为相对于 `apps/api`**，不随命令工作目录变化；绝对路径支持不变。本次历史任务和图片已从原根级 `server-data` 完整迁移到新位置。旧配置 `DATA_DIR=server-data` 需改为 `DATA_DIR=data`；自定义相对路径需按新的 API 基准调整，避免误建空目录。不要为验证结构启动第二个使用相同数据目录的后端实例。
- 密钥与任务超时属于 API / 页面运行配置，不放进 `VITE_*` 变量。Web 不读取 API 的环境文件。

浏览器始终访问同源 `/api`。开发与构建预览由 Vite 代理，因此无需给后端新增 CORS 或把浏览器客户端改成跨源请求。Web 服务器可独立启动查看界面；任务查询与提交需要 API 在线。

## 分别调试

[VS Code 调试配置](<../.vscode/launch.json>)提供两个独立入口：

1. `API: 独立调试后端`：直接启动 API，自动加载该应用的环境文件，可在后端或 API 契约包源码中打断点。启动前先停止已有的同端口/同数据目录后端。
2. `Web: 调试前端（先运行 dev:web）`：先手动启动前端开发服务器，再启动 Chrome 调试；不会隐式启动后端。也可直接使用浏览器 DevTools。

不使用 VS Code 时执行 `npm run debug:api`，通过 Node Inspector 客户端连接 `127.0.0.1:9229`。调试端口仅监听本机。

## 本机运行与部署边界

分别启动两端后，前端开发/预览端口通过代理访问 API。为了兼容原有本机长期使用方式，API 仍可读取 [Web 构建产物](<../apps/web/dist>)提供页面；`npm run build && npm start` 无需启动第二个静态服务。

这不等于两个应用必须一起构建或启动：API 没有 React/Vite 运行时依赖，单独启动不要求存在 Web 构建。正式分离部署可使用本机静态服务器和同源反向代理；Vite preview 只用于预览，当前 API 仍是无账户鉴权的本机单用户服务，不应直接公开。

API 契约包导出的是 TypeScript 源码，npm 包名仍为 `@nanobanana/shared`；运行时需保留 [API 契约包源码](<../apps/api/contracts/src>)与 npm workspace 链接，不能只复制 API 的 `src` 后启动。依赖安装统一使用根级 [锁文件](<../package-lock.json>)。
