import { createContext, useContext } from 'react'
import type { User } from '@nanobanana/shared/types/studio'
interface Session { user: User | null; loading: boolean; error: string | null; refresh: () => Promise<void>; authenticate: (register: boolean, body: object) => Promise<void>; logout: () => Promise<void>; forgetSession: () => void }
export const SessionContext = createContext<Session | null>(null)
export function useSession(): Session { const context = useContext(SessionContext); if (!context) throw new Error('SessionProvider missing'); return context }
