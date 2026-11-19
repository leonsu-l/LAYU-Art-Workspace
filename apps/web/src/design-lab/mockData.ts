import type { GeneratedImage, GenerateImageResult, GenerationTask } from '@nanobanana/shared/types/generation'
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

const LAB_NOW_MS = Date.now()
const HOURS = 3_600_000
const DAYS = 86_400_000

function isoOffset(offsetMs: number): string {
  return new Date(LAB_NOW_MS + offsetMs).toISOString()
}

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
  legacy: svgArtwork('ARCHIVE · CERAMIC STILL LIFE', '#211D38', '#100E1B', '#A78BFA', 'arch'),
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
  date: '2026-11-19',
  limit: 50,
  used: 12,
  remaining: 38,
  configured: true,
  unlimited: false,
}

export interface LabGeneratedImage extends GeneratedImage {
  retentionDays?: number | null
  expiresAt?: string | null
}

export interface LabGenerateImageResult extends Omit<GenerateImageResult, 'images'> {
  images: LabGeneratedImage[]
}

export interface LabGenerationTask extends Omit<GenerationTask, 'result'> {
  result?: LabGenerateImageResult
}

const EXPIRES_7D_SOON = isoOffset(18 * HOURS)
const EXPIRES_30D = isoOffset(28 * DAYS)

export const MOCK_TASKS: LabGenerationTask[] = [
  {
    id: 'task-8f2a1c40',
    status: 'succeeded',
    provider: 'openai-compatible',
    model: 'gpt-image-2.5-flare',
    prompt: '极简建筑美术馆中庭，清晨低角度阳光穿透磨砂玻璃天窗，地面形成几何光影，胶片质感',
    createdAt: isoOffset(-6 * DAYS - 6 * HOURS),
    updatedAt: isoOffset(-6 * DAYS - 6 * HOURS),
    expectedImageCount: 1,
    expectedAspectRatio: '4:3',
    requestedSize: '1536x1024',
    referenceImageCount: 0,
    result: {
      provider: 'openai-compatible',
      model: 'gpt-image-2.5-flare',
      createdAt: isoOffset(-6 * DAYS - 6 * HOURS),
      images: [
        {
          mimeType: 'image/webp',
          url: MOCK_ARTWORKS.single,
          retentionDays: 7,
          expiresAt: EXPIRES_7D_SOON,
        },
      ],
    },
  },
  {
    id: 'task-5c9e0b12',
    status: 'succeeded',
    provider: 'openai-compatible',
    model: 'gpt-image-2.5-flare',
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    createdAt: isoOffset(-2 * DAYS),
    updatedAt: isoOffset(-2 * DAYS),
    expectedImageCount: 4,
    expectedAspectRatio: '1:1',
    requestedSize: '1024x1024',
    referenceImageCount: 1,
    result: {
      provider: 'openai-compatible',
      model: 'gpt-image-2.5-flare',
      createdAt: isoOffset(-2 * DAYS),
      images: [
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame1, retentionDays: 30, expiresAt: EXPIRES_30D },
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame2, retentionDays: 30, expiresAt: EXPIRES_30D },
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame3, retentionDays: 30, expiresAt: EXPIRES_30D },
        { mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.frame4, retentionDays: 30, expiresAt: EXPIRES_30D },
      ],
    },
  },
  {
    id: 'task-legacy-01',
    status: 'succeeded',
    provider: 'gemini-compatible',
    model: 'gemini-nano-banana-2.1',
    prompt: '宋代青瓷茶具与粗陶托盘静物研究，柔和窗侧光',
    createdAt: isoOffset(-45 * DAYS),
    updatedAt: isoOffset(-45 * DAYS),
    expectedImageCount: 1,
    expectedAspectRatio: '4:3',
    referenceImageCount: 0,
    result: {
      provider: 'gemini-compatible',
      model: 'gemini-nano-banana-2.1',
      createdAt: isoOffset(-45 * DAYS),
      // Deliberately omit retentionDays & expiresAt to verify legacy permanent fallback
      images: [{ mimeType: 'image/svg+xml', url: MOCK_ARTWORKS.legacy }],
    },
  },
  {
    id: 'task-3d71a904',
    status: 'running',
    provider: 'gemini-compatible',
    model: 'gemini-nano-banana-2.1',
    prompt: '雨夜东京街角书店橱窗，暖色台灯与湿润沥青地面反光，35mm 纪实摄影',
    createdAt: isoOffset(-1 * HOURS),
    updatedAt: isoOffset(-1 * HOURS),
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
    createdAt: isoOffset(-3 * HOURS),
    updatedAt: isoOffset(-3 * HOURS),
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

/** Top-level default retention policy returned by GET /api/gallery */
export const MOCK_GALLERY_RETENTION_DAYS: number | null = 7

/** Public gallery item contract (no bucket / local / fallback source exposed to regular users). */
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
  retentionDays?: number | null
  expiresAt?: string | null
}

export const MOCK_GALLERY_ITEMS: MockGalleryItem[] = [
  {
    key: 'srv-1',
    taskId: 'task-8f2a1c40',
    url: MOCK_ARTWORKS.single,
    prompt: '极简建筑美术馆中庭，清晨低角度阳光穿透磨砂玻璃天窗，地面形成几何光影，中画幅胶片质感',
    model: 'gpt-image-2.5-flare',
    createdAt: isoOffset(-6 * DAYS - 6 * HOURS),
    bytes: 1840 * 1024,
    dimensions: '1536 × 1024',
    groupCount: 1,
    retentionDays: 7,
    expiresAt: EXPIRES_7D_SOON,
  },
  {
    key: 'srv-2',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame1,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: isoOffset(-2 * DAYS),
    bytes: 1420 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
    retentionDays: 30,
    expiresAt: EXPIRES_30D,
  },
  {
    key: 'srv-3',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame2,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: isoOffset(-2 * DAYS),
    bytes: 1380 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
    retentionDays: 30,
    expiresAt: EXPIRES_30D,
  },
  {
    key: 'srv-4',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame3,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: isoOffset(-2 * DAYS),
    bytes: 1410 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
    retentionDays: 30,
    expiresAt: EXPIRES_30D,
  },
  {
    key: 'srv-5',
    taskId: 'task-5c9e0b12',
    url: MOCK_ARTWORKS.frame4,
    prompt: '四组现代工业设计材质探索：阳极氧化铝、磨砂玻璃与暖白陶瓷的光影构成',
    model: 'gpt-image-2.5-flare',
    createdAt: isoOffset(-2 * DAYS),
    bytes: 1350 * 1024,
    dimensions: '1024 × 1024',
    groupCount: 4,
    retentionDays: 30,
    expiresAt: EXPIRES_30D,
  },
  {
    key: 'srv-6',
    taskId: 'task-legacy-01',
    url: MOCK_ARTWORKS.legacy,
    prompt: '宋代青瓷茶具与粗陶托盘静物研究，柔和窗侧光',
    model: 'gemini-nano-banana-2.1',
    createdAt: isoOffset(-45 * DAYS),
    bytes: 1620 * 1024,
    dimensions: '1360 × 1024',
    groupCount: 1,
    retentionDays: null,
    expiresAt: null,
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

/* ==========================================================================
   ADMIN STORAGE & CLOUDFLARE R2 BUCKETS (/api/admin/storage/*)
   ========================================================================== */

export type BucketJurisdiction = 'default' | 'eu' | 'fedramp'

export interface StorageSettingsContract {
  activeBucketId: string | null
  retentionDays: number | null
}

export interface R2BucketInfo {
  id: string
  accountId: string
  bucketName: string
  jurisdiction: BucketJurisdiction
  hasAccessKeyId: boolean
  hasSecretAccessKey: boolean
  hasAnalyticsToken: boolean
}

export type CloudflareUsageStatus =
  | 'available'
  | 'not_configured'
  | 'forbidden'
  | 'no_data'
  | 'unavailable'

export interface BucketUsageContract {
  application: {
    imageCount: number
    totalBytes: number
  }
  cloudflare: {
    status: CloudflareUsageStatus
    payloadBytes: number | null
    metadataBytes: number | null
    objectCount: number | null
    sampledAt: string | null
  }
}

export const MOCK_STORAGE_SETTINGS: StorageSettingsContract = {
  activeBucketId: 'bkt-00000001-4a2b-4c3d-8e1f-000000000001',
  retentionDays: 7,
}

export const MOCK_R2_BUCKETS: R2BucketInfo[] = [
  {
    id: 'bkt-00000001-4a2b-4c3d-8e1f-000000000001',
    accountId: '9f8e7d6c5b4a3210fedcba9876543210',
    bucketName: 'nanobanana-prod-media',
    jurisdiction: 'default',
    hasAccessKeyId: true,
    hasSecretAccessKey: true,
    hasAnalyticsToken: true,
  },
  {
    id: 'bkt-00000002-4a2b-4c3d-8e1f-000000000002',
    accountId: '9f8e7d6c5b4a3210fedcba9876543210',
    bucketName: 'studio-eu-archive',
    jurisdiction: 'eu',
    hasAccessKeyId: true,
    hasSecretAccessKey: true,
    hasAnalyticsToken: false,
  },
  {
    id: 'bkt-00000003-4a2b-4c3d-8e1f-000000000003',
    accountId: '11223344556677889900aabbccddeeff',
    bucketName: 'r2-staging-verify',
    jurisdiction: 'default',
    hasAccessKeyId: true,
    hasSecretAccessKey: true,
    hasAnalyticsToken: true,
  },
  {
    id: 'bkt-00000004-4a2b-4c3d-8e1f-000000000004',
    accountId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    bucketName: 'nanobanana-cold-spare',
    jurisdiction: 'fedramp',
    hasAccessKeyId: true,
    hasSecretAccessKey: true,
    hasAnalyticsToken: true,
  },
]

export const MOCK_BUCKET_USAGE: Record<string, BucketUsageContract> = {
  'bkt-00000001-4a2b-4c3d-8e1f-000000000001': {
    application: { imageCount: 48, totalBytes: 124_800_000 },
    cloudflare: {
      status: 'available',
      payloadBytes: 132_450_000,
      metadataBytes: 540_200,
      objectCount: 52,
      sampledAt: isoOffset(-3 * HOURS),
    },
  },
  'bkt-00000002-4a2b-4c3d-8e1f-000000000002': {
    application: { imageCount: 12, totalBytes: 31_200_000 },
    cloudflare: {
      status: 'not_configured',
      payloadBytes: null,
      metadataBytes: null,
      objectCount: null,
      sampledAt: null,
    },
  },
  'bkt-00000003-4a2b-4c3d-8e1f-000000000003': {
    application: { imageCount: 0, totalBytes: 0 },
    cloudflare: {
      status: 'forbidden',
      payloadBytes: null,
      metadataBytes: null,
      objectCount: null,
      sampledAt: null,
    },
  },
  'bkt-00000004-4a2b-4c3d-8e1f-000000000004': {
    application: { imageCount: 0, totalBytes: 0 },
    cloudflare: {
      status: 'no_data',
      payloadBytes: null,
      metadataBytes: null,
      objectCount: null,
      sampledAt: null,
    },
  },
}

/**
 * Even when `application.imageCount === 0` (see bkt-00000003), the backend can
 * still reject DELETE with HTTP 409 because of pending deletions or in-flight
 * uncertain writes waiting for a ~1-day re-verification pass.
 */
export const MOCK_BUCKET_DELETE_BLOCK_REASONS: Record<string, string> = {
  'bkt-00000002-4a2b-4c3d-8e1f-000000000002':
    '这个桶里还有 12 张未过期图片，暂时不能删。',
  'bkt-00000003-4a2b-4c3d-8e1f-000000000003':
    '虽然有效图片数为 0，但还有待清理的旧文件或未确认任务，暂时不能删。',
}

/* ==========================================================================
   ADMIN OPERATIONAL ISSUES (/api/admin/issues/*)
   ========================================================================== */

export type AdminIssueKind =
  | 'GENERATION_FAILED'
  | 'R2_FALLBACK'
  | 'IMAGE_WRITE_FAILED'
  | 'IMAGE_READ_FAILED'
  | 'IMAGE_DELETE_FAILED'

export type AdminIssueStatus = 'open' | 'resolved'

export type AdminIssueErrorCode =
  | 'AUTH'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'BAD_RESPONSE'
  | 'STORAGE'
  | 'UNSUPPORTED'
  | 'UNKNOWN'

export interface AdminIssueRecord {
  id: string
  kind: AdminIssueKind
  taskId: string | null
  ownerId: string | null
  channelId: string | null
  bucketId: string | null
  errorCode: AdminIssueErrorCode
  status: AdminIssueStatus
  occurrences: number
  firstSeen: number
  lastSeen: number
  impact: string
  advice: string
}

export const MOCK_ADMIN_ISSUES: AdminIssueRecord[] = [
  {
    id: 'iss-10000001-4a2b-4c3d-8e1f-000000000001',
    kind: 'R2_FALLBACK',
    taskId: '8f2a1c40-7b30-4e92-910a-000000000101',
    ownerId: 'u-2',
    channelId: 'ch-shared-openai',
    bucketId: 'bkt-00000001-4a2b-4c3d-8e1f-000000000001',
    errorCode: 'NETWORK',
    status: 'open',
    occurrences: 4,
    firstSeen: LAB_NOW_MS - 3 * HOURS,
    lastSeen: LAB_NOW_MS - 14 * 60_000,
    impact: '对象存储不可用，已尝试使用备用存储。',
    advice: '检查对象存储配置和可用性，确认备用存储容量。',
  },
  {
    id: 'iss-10000002-4a2b-4c3d-8e1f-000000000002',
    kind: 'IMAGE_DELETE_FAILED',
    taskId: null,
    ownerId: 'u-3',
    channelId: null,
    bucketId: 'bkt-00000003-4a2b-4c3d-8e1f-000000000003',
    errorCode: 'AUTH',
    status: 'open',
    occurrences: 11,
    firstSeen: LAB_NOW_MS - 2 * DAYS,
    lastSeen: LAB_NOW_MS - 42 * 60_000,
    impact: '图片清理未完成，可能残留存储数据。',
    advice: '检查存储权限和连接，保留并重试清理任务。',
  },
  {
    id: 'iss-10000003-4a2b-4c3d-8e1f-000000000003',
    kind: 'GENERATION_FAILED',
    taskId: '1a04f881-2d11-4099-a2bc-000000000202',
    ownerId: 'u-3',
    channelId: 'ch-shared-openai',
    bucketId: null,
    errorCode: 'RATE_LIMIT',
    status: 'open',
    occurrences: 3,
    firstSeen: LAB_NOW_MS - 5 * HOURS,
    lastSeen: LAB_NOW_MS - 1 * HOURS,
    impact: '生成任务未完成，可能已经产生上游费用。',
    advice: '检查渠道及任务状态，确认费用后再手动重试。',
  },
  {
    id: 'iss-10000004-4a2b-4c3d-8e1f-000000000004',
    kind: 'IMAGE_READ_FAILED',
    taskId: '5c9e0b12-901a-4b11-8011-000000000303',
    ownerId: 'u-2',
    channelId: 'ch-shared-gemini',
    bucketId: 'bkt-00000002-4a2b-4c3d-8e1f-000000000002',
    errorCode: 'STORAGE',
    status: 'resolved',
    occurrences: 2,
    firstSeen: LAB_NOW_MS - 6 * DAYS,
    lastSeen: LAB_NOW_MS - 5 * DAYS,
    impact: '已保存图片暂时无法读取。',
    advice: '检查存储连接、权限和文件完整性。',
  },
  {
    id: 'iss-10000005-4a2b-4c3d-8e1f-000000000005',
    kind: 'IMAGE_WRITE_FAILED',
    taskId: '9c1e3a77-5541-4c22-9100-000000000404',
    ownerId: 'u-admin',
    channelId: 'ch-shared-openai',
    bucketId: 'bkt-00000001-4a2b-4c3d-8e1f-000000000001',
    errorCode: 'STORAGE',
    status: 'resolved',
    occurrences: 1,
    firstSeen: LAB_NOW_MS - 12 * DAYS,
    lastSeen: LAB_NOW_MS - 12 * DAYS,
    impact: '生成图片未能完整保存。',
    advice: '检查存储空间、权限和连接，确认费用后再手动重试。',
  },
]
