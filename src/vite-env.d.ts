/// <reference types="vite/client" />

// Exposed by vite to client code via import.meta.env
// Set in `.env` locally
interface ImportMetaEnv {
  VITE_SENTRY_DSN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
