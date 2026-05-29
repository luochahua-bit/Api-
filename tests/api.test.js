const request = require('supertest');
const app = require('../src/index');
const jwt = require('jsonwebtoken');

const testUserToken = jwt.sign({ userId: 'usr_29bfa96bd9296e1f714d' }, process.env.JWT_SECRET, { expiresIn: '1h' });

describe('GET /health', () => {
  test('returns status ok with provider counts', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/^(ok|degraded)$/);
    expect(res.body.providers).toHaveProperty('healthy');
    expect(res.body.providers).toHaveProperty('total');
    expect(typeof res.body.providers.healthy).toBe('number');
    expect(typeof res.body.providers.total).toBe('number');
  });
});

describe('GET /api/models', () => {
  test('returns model list', async () => {
    const res = await request(app).get('/api/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('GET /v1/models without auth', () => {
  test('returns 401', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/models with auth', () => {
  test('returns 403 for unknown API key', async () => {
    const res = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer sk-unknown-key');
    expect(res.status).toBe(403);
  });
});

describe('Admin login', () => {
  test('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'wrong-password', userToken: testUserToken });
    expect(res.status).toBe(401);
  });

  test('accepts correct password and returns JWT', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: '20060303', userToken: testUserToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.split('.')).toHaveLength(3);
  });

  test('rejects empty body', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Admin routes require auth', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  test('returns data with valid admin token', async () => {
    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({ password: '20060303', userToken: testUserToken });
    const token = loginRes.body.token;

    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('404 handler', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
