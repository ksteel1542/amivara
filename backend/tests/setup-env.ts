// Loaded by Jest before any test file (package.json "jest.setupFiles").
// ConfigModule validates the environment when AppModule is imported, so
// test defaults must exist before then. No real database is used.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://amivara:amivara@localhost:5432/amivara_test';
// Sandbox-style Smile ID credentials so verification sessions and webhook
// signatures can be exercised without the real provider.
process.env.SMILE_ID_PARTNER_ID ??= '000';
process.env.SMILE_ID_API_KEY ??= 'test-smile-api-key';
process.env.SMILE_ID_CALLBACK_URL ??= 'https://api.example.test/v1/verification/webhook';
