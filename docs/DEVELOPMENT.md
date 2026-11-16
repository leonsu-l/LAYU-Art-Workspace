# 开发说明

## 职责与依赖

- [后端 Maven 项目](<../apps/api/pom.xml>)：Java 21、Spring Boot Web/Security/JDBC、Flyway、PostgreSQL。采用单体分层，数据库持久化任务与配额，不依赖 Redis/MQ。
- [前端应用](<../apps/web/package.json>)：React/Vite，浏览器只调用同源 `/api`；不直接持有供应商密钥或发送生成请求。
- [TypeScript 契约包](<../apps/api/contracts/package.json>)：供前端类型、参数建议与请求预览使用，仍以 `@nanobanana/shared` 导入。Java 有自己的 DTO/验证与协议测试，不运行 TS。
- npm 仍为单仓库入口，使用根 [锁文件](<../package-lock.json>)。后端 npm 脚本只是 Maven/Java 命令封装，不需要 Node 作为后端运行时。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 安装前端与仓库开发依赖 |
| `npm run dev:api` | `mvn spring-boot:run`；先提供 PostgreSQL 环境变量 |
| `npm run debug:api` | Java 调试模式，JDWP 监听本机 5005 |
| `npm run dev:web` | Vite，默认 5173，代理 API 至本机 3001 |
| `npm run build:api` | Maven 打包可执行 Spring Boot JAR |
| `npm run build:web` | 前端类型检查并构建静态资源 |
| `npm run start:api` | 启动已经构建的 JAR，不同时提供前端 |
| `npm run start:web` | Vite 构建预览；正式部署使用 Caddy |
| `npm run test:api` | Java 回归测试 |
| `npm run test:web` | 前端服务/参数/UI 逻辑测试 |
| `npm run test:contracts` | Java 上游协议适配测试 |
| `npm run typecheck` | Java 编译及前端/契约类型检查 |
| `npm run lint:web` | 前端 ESLint |
| `npm run lint:api` | Java 编译检查，不宣称包含 Java 静态风格规则 |

按变更范围选择最小测试，不把整套测试作为每次修改的必经步骤。独立协议测试可运行 `mvn -f apps/api/pom.xml -Dtest=ProviderServiceTest test`。

## 环境与调试

环境变量及生产容器说明见 [部署指南](<DEPLOYMENT.md>)。Java 直接运行不自动读取 `.env`，需显式导出环境；[API 环境示例](<../apps/api/.env.example>)列出可用变量。Compose 使用根目录 `.env` 做变量替换，前端 Vite 仍读取自身环境配置。

[VS Code 调试入口](<../.vscode/launch.json>)使用 Java 扩展附加到 5005；先手动启动 `npm run debug:api`。前端调试仍先启动 Vite。不要并行启动两个使用同一数据库/图片目录的 API 实例。

## 持久化与边界

- 新 API 默认 `DATA_DIR=./data-java`，相对 Java 进程工作目录；通过 npm 启动时该目录在 API 应用下。线上建议绝对路径或 Compose 卷。
- 数据库与图片目录需一起备份。生成的 `master.key` 或外部 `ENCRYPTION_KEY` 不可丢失。
- 任务提交在同一事务预占配额、保存加密快照；派发前检查账号/渠道是否仍启用。修改配置不会改变已受理任务的快照。
- 进程有单写者文件锁；数据库事务串行化关键状态变更。排队扫描只读取元数据，避免把所有参考图快照载入内存。
- 上游请求不自动重试。收据完成但数据库未完成时，重启只补提交；不确定的已运行任务失败并返还原日额度。
- 旧 Node 后端不再运行，旧 API 不兼容，旧数据不归属任何新账号，也不会导入新图库。

协议与接口细节见 [API 契约](<API_V2.md>)，产品决策见 [重构计划](<JAVA_REBUILD_PLAN.md>)。
