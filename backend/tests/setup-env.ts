// Loaded by Jest before any test file (package.json "jest.setupFiles").
// ConfigModule validates the environment when AppModule is imported, so
// test defaults must exist before then. No real database is used.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://amivara:amivara@localhost:5432/amivara_test';
