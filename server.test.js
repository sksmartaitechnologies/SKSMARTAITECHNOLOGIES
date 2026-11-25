import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.NVIDIA_API_KEY = '';
process.env.VERCEL = '1';

const [{ default: app }, { pool }] = await Promise.all([
  import('./api/[...path].js'),
  import('./server.js')
]);

const originalQuery = pool.query.bind(pool);
pool.query = async (query) => {
  const sql = String(query).toLowerCase();
  if (sql.includes('select name, email from users')) {
    return { rows: [{ name: 'Test User', email: 'test@example.com' }], rowCount: 1 };
  }
  if (sql.includes('select certificate_id')) {
    return { rows: [], rowCount: 0 };
  }
  return { rows: [{ id: '1' }], rowCount: 1 };
};

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  pool.query = originalQuery;
  await pool.end();
});

test('registration, enquiry, careers, and chat POST endpoints return success instead of 405', async () => {
  const submissions = [
    ['/api/register', {
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com',
      phone: '1234567890',
      course: 'AI',
      current_status: 'Student'
    }],
    ['/api/enquiry', {
      full_name: 'Test User',
      email: 'test@example.com',
      phone: '1234567890',
      message: 'Please share course details.'
    }],
    ['/api/careers', {
      full_name: 'Test User',
      email: 'test@example.com',
      phone: '1234567890',
      role: 'Developer',
      experience_level: 'Entry level',
      portfolio_url: '',
      message: 'Application test.'
    }],
    ['/api/chat', { message: 'Tell me about workshops.' }]
  ];

  for (const [path, body] of submissions) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200, `${path} should return HTTP 200`);
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    const result = await response.json();
    assert.equal(result.success ?? Boolean(result.reply), true, `${path} should return success`);
    if (path !== '/api/chat') {
      assert.equal(result.message, 'Thank you! Our team will contact you shortly.');
    }
  }
});

test('API parser errors and unknown endpoints return JSON instead of HTML', async () => {
  const invalidBodyResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid json'
  });
  assert.equal(invalidBodyResponse.status, 400);
  assert.match(invalidBodyResponse.headers.get('content-type') || '', /application\/json/i);
  assert.deepEqual(await invalidBodyResponse.json(), {
    success: false,
    error: 'Invalid JSON request body.'
  });

  const missingRouteResponse = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(missingRouteResponse.status, 404);
  assert.match(missingRouteResponse.headers.get('content-type') || '', /application\/json/i);
  assert.deepEqual(await missingRouteResponse.json(), {
    success: false,
    error: 'API endpoint not found.'
  });
});

test('chat falls back to the built-in response when NVIDIA is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  process.env.NVIDIA_API_KEY = 'test-key';
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://integrate.api.nvidia.com/')) {
      throw new Error('simulated timeout');
    }
    return originalFetch(input, options);
  };

  let response;
  try {
    response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Tell me about workshops.' })
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NVIDIA_API_KEY = '';
  }

  assert.equal(response.status, 200);
  assert.match((await response.json()).reply, /workshops/i);
});

test('users and certificate endpoints handle GET, POST, and CORS preflight requests', async () => {
  const usersResponse = await fetch(`${baseUrl}/api/users`);
  assert.equal(usersResponse.status, 200);
  assert.deepEqual(await usersResponse.json(), [
    { name: 'Test User', email: 'test@example.com' }
  ]);

  const createUserResponse = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Another User', email: 'another@example.com' })
  });
  assert.equal(createUserResponse.status, 201);
  assert.deepEqual(await createUserResponse.json(), { success: true });

  const verifyResponse = await fetch(`${baseUrl}/api/verify/SK-TEST-1`);
  assert.equal(verifyResponse.status, 404);
  assert.notEqual(verifyResponse.status, 405);

  for (const path of ['/api/register', '/api/enquiry', '/api/careers', '/api/chat', '/api/users', '/api/verify/SK-TEST-1']) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.test',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(response.status, 204, `${path} should allow CORS preflight`);
  }
});
