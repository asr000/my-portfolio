import { createClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from './http.js'
import './authCallback.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('缺少 Supabase 配置，请检查 .env.local 并重启开发服务器。')
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fetchWithTimeout },
})
