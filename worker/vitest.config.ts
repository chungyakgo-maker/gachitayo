// Cloudflare의 Workers용 Vitest 환경 (사양서 10.1): 테스트가 실제 Workers 런타임(workerd)에서 돈다. R2는 메모리에 둔다.
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          SUPABASE_URL: 'https://test-project.supabase.co',
          ALLOWED_ORIGIN: 'https://example.github.io',
        },
      },
    }),
  ],
});
