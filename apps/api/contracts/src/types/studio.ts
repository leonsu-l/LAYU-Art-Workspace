import type { ProviderType, OpenAIImageParams, GeminiImageParams } from './generation.ts'
export interface User { id: string; username: string; role: 'USER' | 'ADMIN'; mustChangePassword: boolean }
export interface AdminUser extends User { enabled: boolean; dailyLimit: number | null; createdAt: string }
export interface Invite { id: string; code: string; enabled: boolean; createdAt: string; registrationCount: number }
export interface Channel { id: string; name: string; provider: ProviderType; scope: 'shared' | 'private'; baseUrl: string; enabled: boolean; hasApiKey: boolean; canManage: boolean; enabledModels: string[] }
export interface ModelCatalog { models: { id: string; name: string }[]; enabledModels: string[]; updatedAt: string | null; error: string | null; stale: boolean; canManage: boolean }
export interface Template { id: string; name: string; provider: ProviderType; params: Partial<OpenAIImageParams & GeminiImageParams> }
export interface Settings { defaultDailyLimit: number | null; globalConcurrency: number; perUserConcurrency: number; queueLimit: number }
export interface Quota { date: string; limit: number | null; used: number; remaining: number | null; configured: boolean; unlimited: boolean }
export interface Usage { users: { userId: string; username: string; total: number; succeeded: number; failed: number; active: number }[]; channels: { channelId: string; name: string; total: number; succeeded: number; failed: number; active: number }[]; tasks: { id: string; userId: string; username: string; channelId: string; status: string; createdAt: string }[] }

export type BucketJurisdiction = 'default' | 'eu' | 'fedramp'

export interface StorageSettings {
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

export interface BucketUsage {
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

export interface AdminIssue {
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

export interface AdminIssuesPage { issues: AdminIssue[]; page: number; size: number; total: number }
export interface AdminIssuesSummary { openCount: number }
