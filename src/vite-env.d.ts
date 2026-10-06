/// <reference types="vite/client" />

/** Version aus package.json, zur Build-Zeit durch Vite eingesetzt. */
declare const __APP_VERSION__: string
/** Build-Zeitpunkt (ISO), zur Build-Zeit durch Vite eingesetzt. */
declare const __BUILD_TIME__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
