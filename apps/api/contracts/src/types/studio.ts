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
