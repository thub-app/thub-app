import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xyohzannkzziolhftayu.supabase.co'
const supabaseAnonKey = 'ТВОЯТ_PUBLISHABLE_KEY_ТУК'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
