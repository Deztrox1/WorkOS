/// <reference types="vite/client" />
declare const __VAPID_FILE__: string;
declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_DATA?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
