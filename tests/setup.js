// Test environment setup — must run before any app modules load
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-32bytes!!';
process.env.MARKET_ENCRYPT_KEY = 'test-encrypt-key-for-testing-32b';
process.env.PORT = '0'; // random available port
process.env.RESEND_API_KEY = ''; // disable email in tests
process.env.API_KEYS = 'sk-test-key-12345';
