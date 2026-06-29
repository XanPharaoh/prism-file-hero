import pathlib
lines = [
    'export interface SupabaseEnv {',
    '  SUPABASE_URL: string;',
    '  SUPABASE_SERVICE_ROLE_KEY: string;',
    '}',
    '',
    'function authHeaders(env: SupabaseEnv): Record<string, string> {',
    '  return {',
    '    apikey: env.SUPABASE_SERVICE_ROLE_KEY,',
    '    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,',
    "    'Content-Type': 'application/json',",
    '  };',
    '}',
]
pathlib.Path(r'worker\src\db.ts').write_text('\n'.join(lines), encoding='utf-8')
print('done')
