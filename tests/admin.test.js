const request = require('supertest');
const app = require('../src/index');

// Get a valid admin token for authenticated tests
let adminToken;
beforeAll(async () => {
  const res = await request(app)
    .post('/api/admin/login')
    .send({ password: 'test-admin-password-123' });
  adminToken = res.body.token;
});

describe('Admin provider management', () => {
  test('GET /api/admin/providers returns list', async () => {
    const res = await request(app)
      .get('/api/admin/providers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
  });

  test('GET /api/admin/keys returns list', async () => {
    const res = await request(app)
      .get('/api/admin/keys')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys || res.body)).toBe(true);
  });

  test('GET /api/admin/logs returns list', async () => {
    const res = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /api/admin/stats returns stats', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRequests');
  });
});

describe('Rate limiting', () => {
  test('admin login rate limits after 5 attempts', async () => {
    // Make 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/admin/login')
        .send({ password: 'wrong' });
    }
    // 6th attempt should be rate limited
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'wrong' });
    expect(res.status).toBe(429);
  });
});

describe('Market auth endpoints', () => {
  test('POST /api/market/auth/send-code without email returns 400', async () => {
    const res = await request(app)
      .post('/api/market/auth/send-code')
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/market/auth/login without credentials returns 400', async () => {
    const res = await request(app)
      .post('/api/market/auth/login')
      .send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/market/auth/login with wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/market/auth/login')
      .send({ username: 'nonexistent', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('Marketplace browsing', () => {
  test('GET /api/market/listings returns listings', async () => {
    const res = await request(app).get('/api/market/listings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data || res.body)).toBe(true);
  });
});
