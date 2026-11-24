# LAYU Art Workspace

面向个人与小型团队的 AI 图像生成工作台。前端基于 React + TypeScript，后端基于 **Java 21 + Spring Boot 3.5 + PostgreSQL**，图片默认保存在持久化本地卷（也支持接入私有 Cloudflare R2），所有上游渠道请求和密钥均由服务端统一托管。

## 它能做什么

- **文生图 & 图生图**：支持 OpenAI Compatible 与 Gemini Compatible 双协议，支持多张参考图上传、参数微调与管理员预设模板。
- **持久化任务队列**：提交后任务在服务端后台执行，刷新或关闭页面不会丢失；支持单人/全站并发控制与排队上限。
- **共享与私有渠道隔离**：管理员维护站点共享渠道与可用模型；成员也可在「渠道设置」中添加自己的私有渠道（不占站点日额度）。API Key 全程服务端加密存储，不回传浏览器。
- **私有图库与额度管理**：历史任务、提示词和生成图片仅创建者本人可见；共享渠道按日计算额度（失败任务自动退还站内额度），支持单图/批量删除及按天自动过期清理。
- **邀请制账号体系**：管理员签发邀请码供成员注册，支持账号启用/禁用与密码重置。

---

## 快速开始（Docker Compose 一键部署）

最省心的启动方式是使用根目录的 [compose.yaml](compose.yaml)，它会一并拉起 PostgreSQL、Java 后端和内置 Caddy 静态站点。

### 1. 准备配置文件

确保机器已安装 **Docker** 与 **Docker Compose v2**，然后复制环境变量模板：

```sh
cp .env.example .env
# Windows PowerShell:
# Copy-Item .env.example .env
```

打开 `.env`，按你的实际情况修改以下几项：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_PASSWORD` | **必填**，自行设置一个高强度数据库密码 |
| `BOOTSTRAP_ADMIN_USERNAME` | **首次启动必填**，初始管理员用户名（3–64 位字母、数字、`.`、`_` 或 `-`） |
| `BOOTSTRAP_ADMIN_PASSWORD` | **首次启动必填**，初始管理员密码（**至少 12 位**） |
| `COOKIE_SECURE` | 本机用 `http://localhost:8080` 试用时**改为 `false`**；线上挂了 HTTPS 域名后保持 `true` |
| `WEB_PORT` | 本地访问端口，默认 `8080`（仅监听 `127.0.0.1`） |

### 2. 启动服务

```sh
docker compose up -d --build
```

查看后端启动日志，确认数据库迁移和初始化完成：

```sh
docker compose logs --tail=100 api
```

启动成功后，浏览器访问 `http://localhost:8080`（若修改了 `WEB_PORT` 则替换为对应端口），使用刚才设置的管理员账号登录即可。

> [!TIP]
> **安全建议**：首次登录确认管理员账号可用后，建议清空 `.env` 中的 `BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD`，再执行 `docker compose up -d api` 重建 API 容器，避免初始密码长期留在容器环境变量中。

---

## 首次使用指南：从登录到出第一张图

刚启动时还没有配置任何模型渠道，按下面两步就能跑通生图：

### 第一步：管理员初始化站点（`/admin`）

1. 使用管理员账号登录后，进入右上角或导航栏的 **管理后台（`/admin`）**。
2. **添加共享渠道**：选择协议（OpenAI Compatible 或 Gemini Compatible），填入上游接口地址与 API Key。
3. **启用模型**：点击拉取模型列表（如果上游不提供 `/models` 接口，也可以手动填写模型 ID），**勾选启用**你想开放给用户的模型。
4. **设置默认日额度**：未配置默认日额度时，站点共享生图功能默认关闭。根据需要填入每天可用次数（填 `-1` 表示不限次，填 `0` 表示禁止）。
5. **邀请成员（可选）**：在后台生成邀请码发给团队成员，对方即可在登录页（`/login`）注册普通账号。

### 第二步：在工作台生图（`/`）

1. 回到主工作台：
   - 如果使用管理员配置的线路，顶部选择 **「站点默认渠道」**。
   - 如果想用自己的 API Key，先去 **「渠道」（`/channels`）** 页面添加一条个人渠道，再在工作台顶部切换到 **「自定义渠道」**。
2. 选好协议与模型，输入提示词，按需上传参考图并调整比例/尺寸等参数，点击生成。
3. 任务进入后台队列后即可放心切换或刷新页面，出图后可在工作台右侧预览下载，或在 **「图库」（`/gallery`）** 中统一查看、管理。

---

## 生产环境配置 HTTPS（Nginx / 宝塔反代）

Compose 内的 Web 容器仅监听 `127.0.0.1:8080` 的 HTTP，不直接占用宿主机 80/443 端口。上线绑定域名时，推荐使用宿主机的 Nginx（如宝塔面板）配置 SSL 证书并整站反代到 `http://127.0.0.1:8080`：

1. `.env` 中保持 `COOKIE_SECURE=true`（只要用户通过 HTTPS 访问站点就必须为 `true`，否则无法写入登录 Cookie）。
2. 在 Nginx 的 `server` 块中将请求体上限调大（避免上传参考图时被 Nginx 拦截报 `413`），并关闭代理缓存：

```nginx
client_max_body_size 50m;

location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_send_timeout 200s;
    proxy_read_timeout 200s;
    proxy_cache off;
}
```

更完整的运维命令（CLI 找回/重置管理员、R2 存储配置、数据备份与注意事项）请参考 [部署指南](docs/DEPLOYMENT.md)。

---

## 本地开发上手

本地运行需要准备：**JDK 21**、**Maven 3.9+**、**Node.js 22.18+** 以及 **PostgreSQL 17**。

### 1. 安装前端依赖

```sh
npm ci
```

### 2. 启动数据库

如果本机不想单独装 PostgreSQL，可以直接用 Compose 只拉起数据库（默认映射 `127.0.0.1:5432`）：

```sh
docker compose up -d db
```

### 3. 启动 Java 后端

> [!NOTE]
> 直接通过 Maven 启动后端时**不会自动读取根目录 `.env`**，需要在当前终端里手动导出数据库环境变量。

**Linux / macOS：**

```sh
export DATABASE_URL=jdbc:postgresql://localhost:5432/studio
export DATABASE_USER=studio
export DATABASE_PASSWORD=你的数据库密码
# 首次本地启动需要初始化管理员时，可一并设置：
# export BOOTSTRAP_ADMIN_USERNAME=admin
# export BOOTSTRAP_ADMIN_PASSWORD=your-strong-password-123
npm run dev:api
```

**Windows PowerShell：**

```powershell
$env:DATABASE_URL="jdbc:postgresql://localhost:5432/studio"
$env:DATABASE_USER="studio"
$env:DATABASE_PASSWORD="你的数据库密码"
# 首次本地启动需要初始化管理员时，可一并设置：
# $env:BOOTSTRAP_ADMIN_USERNAME="admin"
# $env:BOOTSTRAP_ADMIN_PASSWORD="your-strong-password-123"
npm run dev:api
```

后端默认监听 `http://127.0.0.1:3001`，图片和密钥默认保存在 `apps/api/data-java`。

### 4. 启动前端开发服务器

另开一个终端窗口：

```sh
npm run dev:web
```

Vite 默认监听 `http://127.0.0.1:5173`，并自动把 `/api` 请求代理到 `http://127.0.0.1:3001`。浏览器打开 `http://127.0.0.1:5173` 即可开始调试。

### 常用开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run test:api` | 运行 Java 后端测试（使用 H2 内存库与本地模拟上游，不消耗真实额度） |
| `npm run test:web` | 运行前端单元测试 |
| `npm run typecheck` | 执行 Java 编译检查与 TypeScript 类型检查 |
| `npm run lint:web` | 运行前端 ESLint 检查 |
| `npm run build` | 打包构建后端可执行 JAR 与前端静态资源 |

---

## 项目目录

```text
apps/
  web/                React + Vite 前端工作台、图库、渠道与管理页面
  api/                Java 21 + Spring Boot 后端（认证、配额、队列、渠道与存储）
    contracts/        前后端共享的 TypeScript 类型与参数工具
compose.yaml          PostgreSQL + Java API + Caddy 容器编排
deploy/Caddyfile      生产环境静态资源与同源 /api 反代配置
docs/                 部署、开发、接口与运行边界详细文档
```

## 延伸阅读

- [部署与运维指南](docs/DEPLOYMENT.md) — Nginx 反代、管理员 CLI 恢复、R2 对象存储及数据备份
- [本地开发说明](docs/DEVELOPMENT.md) — 调试配置、独立测试与持久化细节
- [功能与运行边界](docs/REFERENCE.md) — 额度规则、上传大小限制、任务恢复机制说明
- [API v2 接口契约](docs/API_V2.md) — 前后端接口详细定义
