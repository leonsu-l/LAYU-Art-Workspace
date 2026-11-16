# Docker 与 Java 部署

## 完整站点

需要 Docker Engine + Compose v2，以及安装在同一宿主机上的宝塔 Nginx。域名和公网 HTTPS 由宝塔配置；Compose 不占用宿主机 80/443。Web 仅映射 `127.0.0.1:8080`（可用 `WEB_PORT` 修改），API 不映射宿主机端口，PostgreSQL 仅映射本机回环地址。若宝塔 Nginx 本身运行在另一容器或另一服务器，不能直接使用这里的回环地址，需要另行配置容器网络或受限的内网入口。

1. 将 [环境变量示例](<../.env.example>) 复制为仓库根目录 `.env`。
2. 填写独立数据库密码、首次管理员用户名和密码；按需设置 `WEB_PORT`。没有默认账号密码。首次启动创建管理员后，移除两个 `BOOTSTRAP_ADMIN_*` 值再重建 API 容器，避免在容器环境中长期保留初始密码。
3. 执行：

```sh
docker compose up -d --build
docker compose logs --tail=100 api
```

容器内 Caddy 仅监听 HTTP 80，提供静态页面、SPA 路由回退和 `/api` 转发，不签发证书。生产保留 `COOKIE_SECURE=true`：判断依据是浏览器访问宝塔的 **HTTPS** 地址，而不是 Nginx 到容器的内部 HTTP。仅本机通过 `http://localhost:8080` 试用时才设 `COOKIE_SECURE=false`。

### 宝塔 Nginx 反向代理

1. 在宝塔创建域名站点，申请/安装 SSL 证书并开启强制 HTTPS。
2. 添加整站反代，目标 URL 为 `http://127.0.0.1:8080`（修改 `WEB_PORT` 后同步调整），发送域名使用原访问域名。
3. 关闭该反代的页面/接口缓存，不能缓存含登录 Cookie 或个人作品的响应。不单独映射 `/api` 到 Java 端口，整站使用同一个入口即可。
4. 在该站点的 `server` 块设置上传上限，并调整宝塔生成的代理配置。下面的 `location /` 应替换或修改现有同路径代理块，**不要重复添加**；保留宝塔管理的证书、监听和 HTTP→HTTPS 跳转配置。

```nginx
# Place inside the HTTPS server block, outside location blocks.
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

上传上限需覆盖应用的 44 MiB 任务 JSON，避免参考图被 Nginx 提前以 413 拒绝；同时检查宝塔是否在其他嵌套配置设了更小上限。200 秒读超时覆盖模型目录多页刷新，生成本身是异步任务提交，不要求把浏览器请求挂到出图结束。不需要 WebSocket 专用配置。

先在服务器执行 `curl -I http://127.0.0.1:8080/` 和 `curl http://127.0.0.1:8080/api/health`；再通过宝塔检查 Nginx 配置并重载。最后在公网 HTTPS 域名验证登录、上传参考图、生成轮询与图片下载，刷新 `/gallery` 或 `/admin` 应仍能打开页面。首次登录失败时检查 HTTPS 和 `COOKIE_SECURE`，不要通过取消鉴权来排查。

首次登录后，管理员配置共享渠道及启用模型，再设置默认或用户日额度；默认日额度未配置时不能调用共享渠道。模板仅预填参数，不证明上游支持。个人渠道不占共享日额度，但仍受全站和单人并发限制。用户提交失败总是返还站内额度，供应商可能仍已收费。

## 管理员维护

CLI 直接使用数据库，不启动另一套 Web/任务进程，也不争用图片目录写锁。先让主服务完成数据库迁移。密码只通过 `ADMIN_PASSWORD` 环境传入，不作为命令行参数：

```sh
# Bash: read without displaying the password or writing it to shell history.
read -rs -p 'New administrator password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
docker compose exec -e ADMIN_PASSWORD api java -jar /app/studio-api.jar --admin-command=create-admin --admin-username=your-admin
unset ADMIN_PASSWORD
```

重置已有管理员使用 `--admin-command=reset-admin`。不会把同名普通用户提升为管理员。普通用户重置在管理页面完成，下次登录必须改密。

Windows PowerShell 可在当前进程设置 `$env:ADMIN_PASSWORD`（避免把真实密码写进脚本/命令历史），执行同样的 `docker compose exec -e ADMIN_PASSWORD ...`，随后移除该环境变量。

## 持久化与备份

- `postgres_data`：账号、会话、渠道、模型目录、模板、偏好、任务、额度与图库索引。
- `studio_data`：图片、完成收据及默认生成的 `master.key`。
- 公网证书与 Nginx 配置由宝塔管理，按宝塔的备份方式单独保存；Web 容器没有需要备份的证书卷。

需要同时备份数据库和图片卷；先停止接收新任务，等待执行中的请求结束，再停 API 做一致性备份。若使用 `ENCRYPTION_KEY`，另行安全备份该密钥；若自动生成密钥，必须保留 `master.key`。密钥与数据库不匹配时后端拒绝启动，避免误清除无法解密的任务。普通 `docker compose down` 不删除卷；**不要对需要保留的数据执行 `down -v`**。

只支持一个 API 实例，不扩容副本；进程使用数据目录写锁。异常退出后重启，排队任务继续处理，已请求上游但没有完成收据的任务失败并返还站内额度，不自动重发付费调用。收据存在时仅恢复落库，不再次生成。

## 本地开发

后端要求 JDK 21、Maven 3.9+ 和 PostgreSQL 17；前端要求 Node 22.18+。Maven 编译目标是 Java 21。项目 npm API 命令现在启动 Java，不再启动 Node 后端。

```sh
# Start the database only; it listens on 127.0.0.1:5432.
docker compose up -d db
# Set DATABASE_URL=jdbc:postgresql://localhost:5432/studio,
# DATABASE_USER=studio and DATABASE_PASSWORD in the shell.
npm run dev:api
# In another shell:
npm run dev:web
```

Maven/Java 直接启动不会自动加载根 `.env`；使用当前 shell 环境变量。前端 Vite 开发代理默认指向 `127.0.0.1:3001`。

```sh
npm run test:api
npm run test:web
npm run build
```

后端测试使用 H2 PostgreSQL 兼容模式及本地模拟上游，不调用真实付费渠道。不能把这些测试等同于真实 PostgreSQL/Docker 启动验证。当前实施机器未安装 Docker；容器启动验证结果以交付说明为准。

## 已明确的边界

HTTP(S) 渠道目标不做域名、IP、端口白名单；所有注册用户可能让 API 请求其可达的内网服务。无限复用邀请码泄漏后，撤销不会禁用已注册账号。按用户选择保留这两项行为，不把应用当成隔离不可信租户的公共平台。基本登录鉴权、资源所有权、CSRF 和密钥不回传仍然生效。

图片最多 25 MiB/张、每任务最多 10 张输出；内联上游响应存在多份内存副本。建议从较低并发开始，按实际图片大小/主机内存调整管理员并发设置和 Java 堆预算。此系统只统计任务额度，不保证供应商费用上限。
