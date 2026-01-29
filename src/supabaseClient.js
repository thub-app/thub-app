import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xyohzannkzziolhftayu.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5b2h6YW5ua3p6aW9saGZ0YXl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2NzQ1MDcsImV4cCI6MjA4NTI1MDUwN30.HAdTs9sFlplcqSbUQUwCLGWRY9Te8sV_m271FkVqsh4'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
