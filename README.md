# NanoBanana Console

面向小型工作室的图片生成工作台。前端保留 React + TypeScript / M3 界面，后端已重构为 **Java 21 + Spring Boot 3.5 + PostgreSQL**。图片保存在持久化本地卷，供应商请求由后端执行。

## 功能

- 文本与参考图生成、持久任务队列、刷新后恢复、结果预览下载、私有图库与批量删除。
- 用户名/密码/邀请码注册；普通用户与管理员权限、账号禁用、强制改密。
- 顶层选择「站点默认渠道 / 自定义渠道」，下方再选择 OpenAI / Gemini 协议。
- 管理员维护共享渠道和启用模型；每个用户维护自己的私有渠道。密钥仅服务端加密保存，不回显。
- 通过渠道 API 获取模型目录，保留失败缓存并支持手填 ID；不写死“最新模型”，不自动升级或替换模型。
- 管理员维护参数预填模板，用户可修改参数；按用户、渠道、模型保存最近参数。
- 管理员设置共享日额度、单人/全站并发和排队上限；失败任务一次性返还站内额度。私有渠道不占共享额度。

任务、提示词和图片只有创建者可见；管理员统计不包含这些内容或私有密钥。邀请码无限次、无有效期、可撤销，注册者始终为普通用户。

## 启动

推荐使用 [Docker Compose 配置](<compose.yaml>)。复制 [环境变量示例](<.env.example>) 为根目录 `.env`，填写数据库密码和首次管理员凭据，按需修改本机 `WEB_PORT`（默认 8080）：

```sh
docker compose up -d --build
```

没有默认管理员密码。登录后先配置共享渠道、启用模型及日额度；未配置额度时共享生成关闭。由宝塔 Nginx 配置域名和 HTTPS，整站反代至 `http://127.0.0.1:8080`；容器内 Caddy 仅提供 HTTP 静态页面和同源 API 转发，不占用宿主机 80/443。完整说明、管理员恢复命令、备份及本地开发见 [部署指南](<docs/DEPLOYMENT.md>)。

本地开发要求 JDK 21、Maven 3.9+、PostgreSQL 和 Node 22.18+：

```sh
npm ci
# Set DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD in the shell first.
npm run dev:api
# Another terminal:
npm run dev:web
```

Java 后端默认监听 `127.0.0.1:3001`，Vite 默认 `127.0.0.1:5173` 并代理 `/api`。前后端独立运行，`npm start` 现在只启动构建后的 Java API；生产页面由 Compose 的 Web 服务提供。

## 项目结构

```text
apps/api/pom.xml             Java 21 / Spring Boot 构建
apps/api/src/main/java       认证、渠道、配额、队列、供应商、图片存储
apps/api/src/main/resources  应用配置与 Flyway 数据库迁移
apps/api/src/test/java       Java 回归测试（H2 + 本地模拟上游）
apps/api/contracts           前端使用的 TypeScript 契约与参数工具
apps/web                    React 工作台、图库、账号及管理界面
compose.yaml                PostgreSQL + Java API + Caddy/Web
deploy/Caddyfile             同源反代和静态页面服务
```

Java 不执行或依赖 TypeScript。旧 Node 后端接口与旧业务数据不迁移，新数据使用数据库和独立持久卷。原有前端主题/布局改动保留。

## 开发与验证

```sh
npm run test:api
npm run test:web
npm run build
```

测试不调用真实付费供应商。当前后端验证使用 H2 的 PostgreSQL 兼容模式，不等于真实 PostgreSQL 或容器部署验证。

- [开发说明](<docs/DEVELOPMENT.md>)
- [功能与运行边界](<docs/REFERENCE.md>)
- [新版 API 契约](<docs/API_V2.md>)
- [已确认的重构计划](<docs/JAVA_REBUILD_PLAN.md>)
