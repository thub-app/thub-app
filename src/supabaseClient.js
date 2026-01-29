import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xyohzannkzziolhftayu.supabase.co'
const supabaseAnonKey = 'sb_publishable_by1vBM0ddFkyykzmjw_Hrw_NSin9VpR'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
