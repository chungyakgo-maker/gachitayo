// Cloudflare의 Workers용 Vitest 환경 (사양서 10.1): 테스트가 실제 Workers 런타임(workerd)에서 돈다.
// R2와 D1은 메모리에 두고, D1에는 migrations/의 표를 만든다.
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { ALLOWED_ORIGIN: 'https://example.github.io', TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
