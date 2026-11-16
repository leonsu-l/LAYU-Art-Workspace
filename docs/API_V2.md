# Java 多用户 API 协作契约

阶段一已通过：23 项相关测试（HTTP 2、协议 8、图片 4、任务 9），JDK21打包成功。第二阶段以下契约用于后端/前端并行实现；如需更改，先协调集成者，不能自行漂移。所有业务 URL 在 `/api` 下，JSON 错误沿用 `{error:{code,message,retryable,status}}`。日期 ISO 字符串，用户/资源 ID 是 UUID。

## 账号和安全

使用 Spring Security + 服务端持久化随机会话（HttpOnly `STUDIO_SESSION` Cookie），Cookie SameSite=Lax，部署可配置Secure。Spring Security CSRF使用JS可读的 `XSRF-TOKEN` cookie，所有POST/PUT/DELETE带 `X-XSRF-TOKEN`。前端启动先 GET /auth/session 触发CSRF token生成。

- GET `/auth/session` -> `{user: User|null}`，匿名200。
- POST `/auth/register` `{username,password,inviteCode}` -> `{user: User}`，注册即登录。邀请码无限次/不过期，可撤销，仅普通用户。
- POST `/auth/login` `{username,password}` -> `{user: User}`。
- POST `/auth/logout` -> `{ok:true}`。
- POST `/auth/password` `{currentPassword,newPassword}` -> `{ok:true}`，改密后旧会话失效，客户端回登录页。
- `User = {id,username,role:'USER'|'ADMIN',mustChangePassword:boolean}`。
- 被禁用用户的全部会话失效；必须改密时仅允许session/password/logout，其他业务接口403。
- 管理员端：GET `/admin/users` -> `{users: AdminUser[]}`，AdminUser增加 `enabled:boolean,dailyLimit:number|null,createdAt:string`。dailyLimit=null继承，-1无限，0禁止共享调用。
- PATCH `/admin/users/{id}` `{enabled?:boolean,dailyLimit?:number|null}` -> `{user:AdminUser}`；仅能禁用普通用户，quota覆盖可设置。不要允许修改role。
- POST `/admin/users/{id}/reset-password` `{password}` -> `{ok:true}`；只可重置普通用户且mustChangePassword=true，撤销其会话。
- GET `/admin/invites` -> `{invites: Invite[]}`；POST `/admin/invites` 空JSON -> `{invite:Invite}`；DELETE `/admin/invites/{id}` 撤销 -> `{ok:true}`。
- Invite = `{id,code,enabled,createdAt,registrationCount}`；只给管理员返回。
- 服务端代码给其他模块提供 `studio.api.auth.AuthService.requireUser()` 和 `.requireAdmin()`，返回 `UserPrincipal(id,username,role,mustChangePassword)`；只在HTTP线程使用。禁用用户在数据库事务中发布 `UserDisabledEvent(String userId)`，任务模块监听取消未开始任务。

## 渠道 / 模型 / 模板

- GET `/channels` -> `{channels:Channel[]}`：可见的共享渠道及自己私有渠道；管理员仍不能读其他人的私有渠道。
- POST `/channels` `{name,provider,scope:'shared'|'private',baseUrl,apiKey,enabled?,enabledModels?:string[]}` -> `{channel:Channel}`。shared仅管理员。
- PUT `/channels/{id}` `{name,provider,baseUrl,apiKey?:string,enabled,enabledModels:string[]}` -> `{channel:Channel}`。apiKey省略/空串保留旧值；只有管理员改共享、所有者改私有。
- DELETE `/channels/{id}` -> `{ok:true}`，终止排队任务，执行中可收尾，历史结果不删除。
- Channel = `{id,name,provider:'openai-compatible'|'gemini-compatible',scope:'shared'|'private',baseUrl:string,enabled:boolean,hasApiKey:boolean,canManage:boolean,enabledModels:string[]}`。不给密钥/密文；非管理员的共享baseUrl可为空。不自动更换已失效的选择。
- GET `/channels/{id}/models` -> `{models:Model[],enabledModels:string[],updatedAt:string|null,error:string|null,stale:boolean,canManage:boolean}`；管理者看完整目录，普通用户的共享目录只含启用ID（含手动ID）。Model=`{id,name}`。
- POST `/channels/{id}/models/refresh` 空JSON -> 同上；仅渠道管理者手动刷新。缓存按渠道隔离，失败保留旧目录并返回error；刷新不调用生成。后台定期刷新。
- 管理者通过PUT渠道的enabledModels启用/手填共享模型；私有用户可填写任意模型ID。发现出的所有条目不保证能生成图片。
- GET `/templates` -> `{templates:Template[]}`；POST `/admin/templates` `{name,provider,params}` -> `{template:Template}`；PUT `/admin/templates/{id}`同body同response；DELETE对应路径 -> `{ok:true}`。
- Template=`{id,name,provider,params}`。模板仅预填参数，不限制，不指定model/channel/key。更新不覆盖已有用户参数。
- GET `/preferences?channelId=...&model=...` -> `{params:object|null}`；PUT `/preferences` `{channelId,model,params}` -> `{ok:true}`；用户隔离，不保存个人模板。

## 生成 / 额度 / 管理信息

- POST `/tasks` 改为 `{id,prompt,channelId,model,params,referenceImages?}` -> 202 `{task}`。禁止从客户端提交/覆盖apiKey/baseUrl/provider；这些从所选渠道解析。
- params沿用当前协议字段名：OpenAI size,quality,n,background,outputFormat,outputCompression,moderation；Gemini imageSize,aspectRatio,imageOnly,thinkingLevel。auto表示不发送Gemini imageSize/thinkingLevel/aspectRatio对应可选项。未知字段不透传，值不按静态模型能力表改写，保留类型/格式/应用资源预算。
- Task、图库、图片、GET/DELETE tasks等响应保留阶段一结构；全部按当前用户隔离。用户更改渠道后重试同一ID：以原始客户端请求指纹判定，不因为服务器密钥/地址变化而409；已接收任务使用原快照。禁用账户/渠道不得让原排队请求执行。
- GET `/me/quota` -> `{date:string,limit:number|null,used:number,remaining:number|null,configured:boolean,unlimited:boolean}`。used含排队预占；limit=null未设置，-1无限。私有渠道不占该额度。
- GET `/admin/settings` -> `{settings:{defaultDailyLimit:number|null,globalConcurrency:number,perUserConcurrency:number,queueLimit:number}}`。
- PUT `/admin/settings` 同settings字段（不包settings） -> `{settings:...}`。默认日额度不预填固定数字。全站、单人并发1..32、队列1..10000；初始并发2/1、队列100，管理者可改。
- GET `/admin/usage` -> `{users:[{userId,username,total,succeeded,failed,active}],channels:[{channelId,name,total,succeeded,failed,active}],tasks:[{id,userId,username,channelId,status,createdAt}]}`。最多100条最近任务，无prompt/图片/密钥；用户删任务不会抹去用量计数。
- 站内任务额度：受理预占；任何失败全额返还、重复处理不重复退款；成功任务删除不返还。按Asia/Shanghai统计，失败撤销所属日的扣额，不变成另一日的额外额度。任务未发送即可取消退款，已发送允许收尾。

## 前端实现边界

保留当前未提交的M3风格、主题、工作台和图库布局；这是业务适配不是重新视觉设计。一级站点默认/自定义，协议在下方。加入登录注册/强制改密、管理员用户/邀请码/共享渠道/模板/额度/使用量界面。移除旧浏览器密钥配置及旧图库入口，不把旧数据静默认领给新账号；清理只限本应用旧key/DB，不能localStorage.clear或清其他站点数据。待确认提交按用户隔离，保留同UUID恢复/冻结请求行为，429也是明确未受理可解除待确认；网络500等结果未知仍需查询。注销要清除内存任务/参考图/缓存并取消旧请求，跨账号不得看到旧画面或前一个账号待确认记录。生成请求预览只展示应用API或脱敏配置，绝不伪造/展示共享密钥。
