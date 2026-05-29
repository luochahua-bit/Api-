const request = require('supertest');
const app = require('../src/index');
const jwt = require('jsonwebtoken');

// Get a valid admin token for authenticated tests
let adminToken;
const testUserToken = jwt.sign({ userId: 'usr_29bfa96bd9296e1f714d' }, process.env.JWT_SECRET, { expiresIn: '1h' });

beforeAll(async () => {
  const res = await request(app)
    .post('/api/admin/login')
    .send({ password: '20060303', userToken: testUserToken });
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

describe('Admin login', () => {
  test('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'wrong', userToken: testUserToken });
    expect(res.status).toBe(401);
  });

  test('rejects without userToken', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: '20060303' });
    expect(res.status).toBe(400);
  });
});

describe('Rate limiting', () => {
  test('admin login rate limits after 5 attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/admin/login')
        .send({ password: 'wrong', userToken: testUserToken });
    }
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'wrong', userToken: testUserToken });
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
