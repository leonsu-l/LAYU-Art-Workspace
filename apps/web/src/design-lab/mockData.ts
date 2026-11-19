import type { GenerationTask } from '@nanobanana/shared/types/generation'
import type {
  AdminUser,
  Channel,
  Invite,
  ModelCatalog,
  Quota,
  Settings,
  Template,
  Usage,
} from '@nanobanana/shared/types/studio'

function svgArtwork(title: string, bgStart: string, bgEnd: string, accent: string, shape: 'circle' | 'arch' | 'prism' | 'grid'): string {
  const motif =
    shape === 'circle'
      ? `<circle cx="320" cy="210" r="115" fill="${accent}" opacity="0.88"/><circle cx="385" cy="175" r="56" fill="#fff" opacity="0.22"/>`
      : shape === 'arch'
        ? `<path d="M180 400V220a140 140 0 0 1 280 0v180Z" fill="${accent}" opacity="0.82"/><circle cx="320" cy="175" r="46" fill="#fff" opacity="0.28"/>`
        : shape === 'prism'
          ? `<polygon points="320,75 470,340 170,340" fill="${accent}" opacity="0.85"/><polygon points="320,75 470,340 320,280" fill="#000" opacity="0.22"/>`
          : `<rect x="175" y="105" width="130" height="130" rx="18" fill="${accent}" opacity="0.9"/><rect x="335" y="105" width="130" height="130" rx="65" fill="#fff" opacity="0.25"/><rect x="175" y="265" width="290" height="90" rx="18" fill="${accent}" opacity="0.5"/>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bgStart}"/>
        <stop offset="100%" stop-color="${bgEnd}"/>
      </linearGradient>
    </defs>
    <rect width="640" height="480" fill="url(#g)"/>
    ${motif}
    <text x="32" y="446" fill="#ffffff" fill-opacity="0.72" font-family="monospace" font-size="14">${title}</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const MOCK_ARTWORKS = {
  single: '/studio-still-life.webp',
  frame1: svgArtwork('FRAME 01 · ARCHITECTURAL STUDY', '#192647', '#0D1322', '#6D93FF', 'arch'),
  frame2: svgArtwork('FRAME 02 · PRISM REFRACTION', '#1E2A38', '#11161E', '#F5B73B', 'prism'),
  frame3: svgArtwork('FRAME 03 · SOLAR ECLIPSE', '#2C1814', '#140D0B', '#FF6B47', 'circle'),
  frame4: svgArtwork('FRAME 04 · MODULAR FORM', '#172824', '#0C1412', '#34D399', 'grid'),
}

export const MOCK_CHANNELS: Channel[] = [
  {
    id: 'ch-shared-openai',
    name: 'OpenAI Studio 官方镜像',
    provider: 'openai-compatible',
    scope: 'shared',
    baseUrl: 'https://api.studio.internal/v1',
    enabled: true,
    hasApiKey: true,
    canManage: false,
    enabledModels: ['gpt-image-2.5-flare', 'gpt-image-1.5', 'gpt-image-1'],
  },
  {
    id: 'ch-shared-gemini',
    name: 'Gemini Banana 集群',
    provider: 'gemini-compatible',
    scope: 'shared',
    baseUrl: 'https://gemini.studio.internal/v1beta',
    enabled: true,
    hasApiKey: true,
    canManage: false,
    enabledModels: ['gemini-nano-banana-2.1', 'gemini-2.5-flash-image'],
  },
  {
    id: 'ch-private-openai',
    name: '我的私有中转站',
    provider: 'openai-compatible',
    scope: 'private',
    baseUrl: 'https://my-relay.example.com/v1',
    enabled: true,
    hasApiKey: true,
    canManage: true,
    enabledModels: ['gpt-image-1.5'],
  },
]

export const MOCK_CATALOG_BY_CHANNEL: Record<string, ModelCatalog> = {
  'ch-shared-openai': {
    models: [
      { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare · 推荐' },
      { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
      { id: 'gpt-image-1', name: 'GPT Image 1' },
    ],
    enabledModels: ['gpt-image-2.5-flare', 'gpt-image-1.5', 'gpt-image-1'],
    updatedAt: '2026-11-18T00:10:00Z',
    error: null,
    stale: false,
    canManage: false,
  },
  'ch-shared-gemini': {
    models: [
      { id: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1 · 推荐' },
      { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' },
    ],
    enabledModels: ['gemini-nano-banana-2.1', 'gemini-2.5-flash-image'],
    updatedAt: '2026-11-18T00:10:00Z',
    error: null,
    stale: false,
    canManage: false,
  },
  'ch-private-openai': {
    models: [
      { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
    ],
    enabledModels: ['gpt-image-1.5'],
    updatedAt: '2026-11-18T00:05:00Z',
    error: null,
    stale: false,
    canManage: true,
  },
}

export const MOCK_TEMPLATES: Template[] = [
  {
    id: 'tpl-editorial',
    name: '建筑摄影 · 16:9 高清',
    provider: 'openai-compatible',
    params: { size: '1536x1024', quality: 'high', outputFormat: 'png', n: 1 },
  },
  {
    id: 'tpl-batch',
    name: '多方案草图 · 4 张 1:1',
    provider: 'openai-compatible',
    params: { size: '1024x1024', quality: 'medium', outputFormat: 'webp', n: 4 },
  },
  {
    id: 'tpl-gemini-poster',
    name: '竖版海报 · 9:16 2K',
    provider: 'gemini-compatible',
    params: { aspectRatio: '9:16', imageSize: '2K', thinkingLevel: 'medium', imageOnly: true },
  },
]

export const MOCK_QUOTA: Quota = {
  date: '2026-11-18',
  limit: 50,
  used: 12,
  remaining: 38,
  configured: true,
  unlimited: false,
}

export const MOCK_TASKS: GenerationTask[] = [
  {
    id: 'task-8f2a1c40',
    status: 'succeeded',
    provider: 'openai-compatible',
    model: 'gpt-image-2.5-flare',
    prompt: '极简建筑美术馆中庭，清晨低角度阳光穿透磨砂玻璃天窗，地面形成几何光影，胶片质感',
    createdAt: '2026-11-18T00:18:00Z',
    updatedAt: '2026-11-18T00:18:24Z',
    expectedImageCount: 1,
    expectedAspectRatio: '4:3',
    requestedSize: '1536x1024',
    referenceImageCount: 0,
    result: {
      provider: 'openai-compatible',
      model: 'gpt-image-2.5-flare',
      createdAt: '2026-11-18T00:18:24Z',
      images: [{ mimeType: 'image/webp', url: MOCK_ARTWORKS.single }],
    },
  },
  {
    id: 'task-5c9e0b12',
    status: 'succeeded',
    provider: 'openai-compatible',
    model: 'gpt-image-2.5-flare',
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    createdAt: '2026-11-18T00:12:00Z',
    updatedAt: '2026-11-18T00:12:40Z',
    expectedImageCount: 4,
    expectedAspectRatio: '1:1',
    requestedSize: '1024x1024',
    referenceImageCount: 1,
    result: {
      provider: 'openai-compatible',
      model: 'gpt-image-2.5-flare',
      createdAt: '2026-11-18T00:12:40Z',
      images: [
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame1 },
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame2 },
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame3 },
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame4 },
      ],
    },
  },
  {
    id: 'task-3d71a904',
    status: 'running',
    provider: 'gemini-compatible',
    model: 'gemini-nano-banana-2.1',
    prompt: '雨夜东京街角书店橱窗，暖色台灯与湿润沥青地面反光，35mm 纪实摄影',
    createdAt: '2026-11-18T00:25:00Z',
    updatedAt: '2026-11-18T00:25:10Z',
    expectedImageCount: 2,
    expectedAspectRatio: '3:4',
    referenceImageCount: 0,
  },
  {
    id: 'task-1a04f881',
    status: 'failed',
    provider: 'openai-compatible',
    model: 'gpt-image-1',
    prompt: '高饱和度赛博霓虹商业海报设计',
    createdAt: '2026-11-17T23:52:00Z',
    updatedAt: '2026-11-17T23:52:12Z',
    expectedImageCount: 1,
    expectedAspectRatio: '9:16',
    requestedSize: '1024x1792',
    error: {
      code: 'RATE_LIMIT',
      message: '上游渠道并发或额度暂时受限（HTTP 429）',
      retryable: true,
    },
  },
]

export const MOCK_PROMPT_PRESETS = [
  {
    label: '建筑光影静物',
    prompt: '极简建筑美术馆中庭，清晨低角度阳光穿透磨砂玻璃天窗，地面形成几何光影，中画幅胶片质感',
  },
  {
    label: '工业材质构成',
    prompt: '四组现代工业设计材质探索：拉丝阳极氧化铝、半透磨砂亚克力与温润陶瓷在柔和棚拍光下的构图',
  },
  {
    label: '微缩生态装置',
    prompt: '透明玻璃容器内的微缩苔藓森林与微型悬浮步道，微距景深，冷暖对比工作室照明',
  },
]

export interface MockGalleryItem {
  key: string
  taskId: string
  url: string
  prompt: string
  model: string
  createdAt: string
  bytes: number
  dimensions: string
  groupCount: number
}

export const MOCK_GALLERY_ITEMS: MockGalleryItem[] = [
  {
    key: 'srv-1',
    taskId: 'task-8f2a1c40',
    url: MOCK_ARTWORKS.single,
    prompt: '极简建筑美术馆中庭，清晨低角度阳光穿透磨砂玻璃天窗，地面形成几何光影，中画幅胶片质感',
    model: 'gpt-image-2.5-flare',
    createdAt: '2026-11-18T00:18:24Z',
    bytes: 1840 * 1024,
    dimensions: '1536 × 1024',
    groupCount: 1,
  },
  {
    key: 'srv-2',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame1,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: '2026-11-18T00:12:40Z',
    bytes: 1420 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
  },
  {
    key: 'srv-3',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame2,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: '2026-11-18T00:12:40Z',
    bytes: 1380 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
  },
  {
    key: 'srv-4',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame3,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: '2026-11-18T00:12:40Z',
    bytes: 1410 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
  },
  {
    key: 'srv-5',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame4,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: '2026-11-18T00:12:40Z',
    bytes: 1350 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
  },
]

export const MOCK_ADMIN_USERS: AdminUser[] = [
  { id: 'u-admin', username: 'leon', role: 'ADMIN', mustChangePassword: false, enabled: true, dailyLimit: -1, createdAt: '2026-11-01T08:00:00Z' },
  { id: 'u-2', username: 'designer.mei', role: 'USER', mustChangePassword: false, enabled: true, dailyLimit: 80, createdAt: '2026-11-04T11:30:00Z' },
  { id: 'u-3', username: 'studio.guest', role: 'USER', mustChangePassword: true, enabled: true, dailyLimit: null, createdAt: '2026-11-12T09:15:00Z' },
  { id: 'u-4', username: 'archived.user', role: 'USER', mustChangePassword: false, enabled: false, dailyLimit: 0, createdAt: '2026-10-20T16:40:00Z' },
]

export const MOCK_INVITES: Invite[] = [
  { id: 'inv-1', code: 'STUDIO-2026-OPEN', enabled: true, createdAt: '2026-11-01T08:00:00Z', registrationCount: 14 },
  { id: 'inv-2', code: 'BETA-DESIGN-TEAM', enabled: true, createdAt: '2026-11-10T10:00:00Z', registrationCount: 6 },
  { id: 'inv-3', code: 'OLD-TEMP-ACCESS', enabled: false, createdAt: '2026-10-15T12:00:00Z', registrationCount: 3 },
]

export const MOCK_ADMIN_SETTINGS: Settings = {
  defaultDailyLimit: 50,
  globalConcurrency: 2,
  perUserConcurrency: 1,
  queueLimit: 100,
}

export const MOCK_ADMIN_USAGE: Usage = {
  users: [
    { userId: 'u-admin', username: 'leon', total: 64, succeeded: 60, failed: 3, active: 1 },
    { userId: 'u-2', username: 'designer.mei', total: 42, succeeded: 39, failed: 3, active: 0 },
    { userId: 'u-3', username: 'studio.guest', total: 9, succeeded: 8, failed: 1, active: 0 },
  ],
  channels: [
    { channelId: 'ch-shared-openai', name: 'OpenAI Studio 官方镜像', total: 78, succeeded: 74, failed: 4, active: 0 },
    { channelId: 'ch-shared-gemini', name: 'Gemini Banana 集群', total: 37, succeeded: 33, failed: 3, active: 1 },
  ],
  tasks: [
    { id: 'task-3d71a904', userId: 'u-admin', username: 'leon', channelId: 'ch-shared-gemini', status: 'running', createdAt: '2026-11-18T00:25:00Z' },
    { id: 'task-8f2a1c40', userId: 'u-admin', username: 'leon', channelId: 'ch-shared-openai', status: 'succeeded', createdAt: '2026-11-18T00:18:00Z' },
    { id: 'task-5c9e0b12', userId: 'u-2', username: 'designer.mei', channelId: 'ch-shared-openai', status: 'succeeded', createdAt: '2026-11-18T00:12:00Z' },
    { id: 'task-1a04f881', userId: 'u-3', username: 'studio.guest', channelId: 'ch-shared-openai', status: 'failed', createdAt: '2026-11-17T23:52:00Z' },
  ],
}
