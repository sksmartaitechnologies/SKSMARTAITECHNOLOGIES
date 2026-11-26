import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.GEMINI_API_KEY = '';
process.env.VERCEL = '1';

const [{ default: app }, { pool }] = await Promise.all([
  import('./api/[...path].js'),
  import('./server.js')
]);

const originalQuery = pool.query.bind(pool);
const registrationSchemaQueries = [];
const registrationInserts = [];
pool.query = async (query, values) => {
  const sql = String(query).toLowerCase();
  if (sql.includes('create table if not exists registrations')) {
    registrationSchemaQueries.push(sql);
  }
  if (sql.includes('insert into registrations')) {
    registrationInserts.push({ sql, values });
  }
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
    ['/api/chat', { message: 'Tell me about internship options.' }]
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

test('registration accepts camelCase fields and inserts all values after table setup', async () => {
  const response = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Another',
      lastName: 'Student',
      email: 'another@example.com',
      phone: '0987654321',
      course: 'Data Science',
      status: 'Working'
    })
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);
  assert.deepEqual(await response.json(), {
    success: true,
    message: 'Thank you! Our team will contact you shortly.'
  });
  assert.ok(registrationSchemaQueries.some((sql) => sql.includes('create table if not exists registrations')));
  assert.deepEqual(registrationInserts[registrationInserts.length - 1].values, [
    'Another',
    'Student',
    'another@example.com',
    '0987654321',
    'Data Science',
    'Working'
  ]);
});

test('registration returns a clear JSON error when the database insert fails', async () => {
  const normalQuery = pool.query;
  pool.query = async () => {
    throw new Error('simulated database failure');
  };

  let response;
  try {
    response = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Student',
        email: 'test@example.com',
        phone: '1234567890',
        course: 'Data Science',
        status: 'Studying'
      })
    });
  } finally {
    pool.query = normalQuery;
  }

  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Unable to save registration. Please try again later.'
  });
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

test('chat falls back to the built-in response when Gemini is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      throw new Error('simulated timeout');
    }
    return originalFetch(input, options);
  };

  let response;
  try {
    response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Tell me about online and offline courses.' })
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GEMINI_API_KEY = '';
  }

  assert.equal(response.status, 200);
  const reply = (await response.json()).reply;
  assert.match(reply, /Data Science/i);
  assert.doesNotMatch(reply, /\.html/i);
});

test('chat sends history to Gemini and returns its response', async () => {
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  let geminiRequest;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      geminiRequest = { input: String(input), options };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, options);
  };

  let response;
  try {
    response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Tell me about courses',
        history: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Welcome' }
        ]
      })
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GEMINI_API_KEY = '';
  }

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: 'Gemini answer' });
  assert.equal(geminiRequest.input, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(geminiRequest.options.headers['x-goog-api-key'], 'test-key');
  const payload = JSON.parse(geminiRequest.options.body);
  assert.equal(payload.contents[0].role, 'user');
  assert.equal(payload.contents[1].role, 'model');
  assert.equal(payload.contents[2].parts[0].text, 'Tell me about courses');
  assert.match(payload.systemInstruction.parts[0].text, /Data Science/);
  assert.match(payload.systemInstruction.parts[0].text, /certificate QR code/);
  assert.match(payload.systemInstruction.parts[0].text, /custom website development/);
  assert.doesNotMatch(payload.systemInstruction.parts[0].text, /\.html/i);
});

test('chat fallback covers fees, enrollment, certificate checks, and IT solutions', async () => {
  const replies = {};
  const messages = {
    fees: 'What are the internship fees and stipend?',
    enrollment: 'How do I register?',
    certificate: 'How do I verify a certificate?',
    services: 'Tell me about IT solutions'
  };

  for (const [intent, message] of Object.entries(messages)) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    assert.equal(response.status, 200);
    replies[intent] = (await response.json()).reply;
    assert.doesNotMatch(replies[intent], /\.html/i);
  }

  assert.match(replies.fees, /fees vary by selected program, duration/i);
  assert.match(replies.fees, /stipend opportunities based on performance and project role/i);
  assert.match(replies.fees, /\[Contact Page\]\(\/contact\)/);
  assert.match(replies.enrollment, /academic details and preferred domain/i);
  assert.match(replies.enrollment, /confirm enrollment and schedule details/i);
  assert.match(replies.certificate, /\[Verify Certificate Page\]\(\/verify\)/);
  assert.match(replies.services, /custom website development/i);
  assert.match(replies.services, /\[Services Page\]\(\/services\)/);
});

test('chat falls back when Gemini rate limits requests', async () => {
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      return new Response('{}', { status: 429 });
    }
    return originalFetch(input, options);
  };

  let response;
  try {
    response = await originalFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Tell me about online and offline courses.' })
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.GEMINI_API_KEY = '';
  }

  assert.equal(response.status, 200);
  assert.match((await response.json()).reply, /Data Science/);
});

test('certificate lookup returns only approved public fields', async () => {
  const normalQuery = pool.query;
  pool.query = async (query, values) => {
    if (String(query).toLowerCase().includes('from certificates')) {
      assert.deepEqual(values, ['SKSAIDM202602']);
      return {
        rows: [{
          certificate_number: 'SKSAIDM202602',
          name: 'Example Student',
          date: '2026-03-15',
          college: 'Private College',
          phone: '1234567890',
          email: 'private@example.com'
        }],
        rowCount: 1
      };
    }
    return normalQuery(query, values);
  };

  let response;
  try {
    response = await fetch(`${baseUrl}/api/verify?certificate_number=SKSAIDM202602`);
  } finally {
    pool.query = normalQuery;
  }

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    verified: true,
    certificate_number: 'SKSAIDM202602',
    name: 'Example Student',
    date: '2026-03-15'
  });
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
