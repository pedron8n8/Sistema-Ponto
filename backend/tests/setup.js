// Setup global para os testes

// Mock do dotenv
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_KEY = 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// Silencia logs durante testes
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Cleanup após cada teste
afterEach(() => {
  jest.clearAllMocks();
});
