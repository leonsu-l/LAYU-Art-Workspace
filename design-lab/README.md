# NanoBanana Studio — Creative Frontend Studio Design Lab

本目录记录项目的持久化设计状态与决策日志；可交互的在线 Design Lab 位于 `apps/web/src/design-lab/`，由 Vite 开发服务器直接托管。

## 启动与访问方式

1. 在仓库根目录运行前端开发服务器：
   ```sh
   npm run dev:web
   ```
2. 浏览器打开：
   - Design Lab 工作台：`http://127.0.0.1:5173/design-lab.html`
   - 现有生产应用：`http://127.0.0.1:5173/`（未获批准前保持隔离，不受实验代码影响）

## 设计工作流状态

- **Stage 1（发现与诊断）**：已完成对 Java 后端契约（账号/会话、共享与私有渠道、模型目录、参数模板、日额度、并发队列、持久任务恢复）及现有 5 条前端路由的盘点，定位 5 项核心视觉与体验问题。
- **Stage 2–4（选定方向 A · 全站 5 页面 M3 Expressive 原型）**：
  - **已选定方向 A · 钴蓝暗房（M3 Expressive Cobalt Studio）**，方向 B 已舍弃：冷石中性 5 级色调表面 + Cobalt Primary + Warm Amber Tertiary，无 `1px` 线框堆砌，全系列连接式形态变形组件已修复外侧圆角过冲归零闪烁问题。
  - **多页面设计体系已补全**：在 `http://127.0.0.1:5173/design-lab.html`「03 · 全站多页原型」中可切换并交互验证 `/` 创作工作台、`/gallery` 我的图库、`/channels` 自定义渠道、`/login · /password` 账号安全与 `/admin` 站点管理全部 5 个页面。
- **Stage 5–6（用户评审与生产集成）**：待用户验收 5 页面原型并确认后，再落入生产代码。
