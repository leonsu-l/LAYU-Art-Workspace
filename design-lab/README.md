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

## 设计工作流与最新迭代汇总

- **Stage 1（发现与诊断）**：已完成对 Java 后端契约（账号/会话、共享与私有渠道、模型目录、参数模板、日额度、并发队列、持久任务恢复）及现有 5 条前端路由的盘点，定位 5 项核心视觉与体验问题。
- **Stage 2–4（选定方向 A · M3 Expressive 组件与 5 页原型体系）**：
  - **视觉方向 A（钴蓝暗房 / Cobalt Studio）**：浅/深双主题冷石 5 级色调表面阶梯 + Cobalt Primary + Warm Amber Tertiary（方向 B 已完全舍弃）；修复连接式选项组外侧圆角过冲闪烁问题（精确半高外圆角锁定）。
  - **全站 5 页面覆盖**：在 `http://127.0.0.1:5173/design-lab.html`「03 · 全站多页原型」中可交互验证 `/` 创作工作台、`/gallery` 我的图库、`/channels` 自定义渠道、`/login · /password` 账号安全与 `/admin`（含 6 大管理子模块）。
  - **导航与手势动效**：主/副栏目升级为 M3 Primary Tabs（`3px` 主题色基线短条滑块）；顶级大栏目支持手机端（`390px`）指尖拖拽滑动与双端水平切页动画，页内子栏目保持手动点击切换。
  - **图库清理与选框修正**：移除前端旧版浏览器图库兼容提示与筛选（仅保留后端云端作品与整组联删说明）；选中框改为静态 `20px` 圆角配 `1px` 渐入淡出边框及 `22×22` 居中勾选符号。
  - **统一 M3 Snackbar 反馈**：将各页操作成功、刷新、模板应用、警告与任务详情迁入底部反转表面浮动条（展开大图预览时自动上避底栏），阻断性提示与强制改密规则保留内联。
  - **沉浸式图库预览与应用级缩放动效**：重构全屏磨砂浮层预览（顶部胶囊控制条 + 底部可收起提示词停靠栏，支持点击/键盘隐藏浮层）；通过 `lightboxTransition.ts`（`buildContainerMorphKeyframes`）驱动 28 帧非匀速解耦曲线与抛物线轨迹（`340ms` 展开 / `260ms` 实时追踪 `←` `→` 后当前卡片或原卡片槽位收回），消除关闭后全屏闪回并支持开关/切换途中随时打断。
  - **图库 Hover + 选中状态叠加修正**：以 `:hover:not(.galleryCardSelected)`（同步修复工作台 `.filmCard`）与 `--md-sys-color-secondary-container-hover`（浅色 `#C3D1FC` / 深色 `#324477`）解决选中态被未选中 Hover 色覆盖问题，实现 Hover + 选中时蓝色略微加深。
  - **M3 Expressive Shimmer Skeleton 占位体系**：新增 `LabSkeleton.tsx` 与 `ShimmerImage`，以 GPU 合成的 `translate3d` 钴蓝微光扫掠按 M3 形态尺度占位（圆形、胶囊文本、填充输入框、6 联比例矩阵、Split CTA 与 `4:3` 媒体框，含 `prefers-reduced-motion` 降级），覆盖全部 5 页数据/图片加载态、模型目录刷新与组件沙盒第 7 面板。
  - **全局可复用点击晕开效果**：新建 `LabRipple.tsx`（`RippleButton` + `RippleOverlay`）统一复用 `useRipple.ts` 并清除 `LabControls` 中的重复实现，通过 `:where(.rippleHost)` 为全站所有按钮、列表卡片、缩略图（白色微光）、LightBox 控制条、Snackbar 与密码显隐开关提供一致的 M3 点击涟漪反馈。
- **Stage 5–6（当前状态：待评审后落入生产）**：仍隔离于 `apps/web/src/design-lab/`，现有生产代码保持零入侵；获批后即可按「共用顶栏与令牌 → `/` 工作台 → 其余 4 页」顺序推进生产集成。
