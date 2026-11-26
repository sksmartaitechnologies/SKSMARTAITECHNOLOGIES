import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const databaseUrl = process.env.DATABASE_URL?.trim();
const FORM_SUCCESS_MESSAGE = 'Thank you! Our team will contact you shortly.';
if (!databaseUrl) {
  console.error('DATABASE_URL is missing; form submissions cannot be saved to Neon PostgreSQL.');
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  statement_timeout: 10000
});

let formTablesSetup;

async function ensureFormTables() {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing; configure Neon PostgreSQL before saving forms.');
  }
  if (!formTablesSetup) {
    formTablesSetup = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS registrations (
          id BIGSERIAL PRIMARY KEY,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          course TEXT NOT NULL,
          current_status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS enquiries (
          id BIGSERIAL PRIMARY KEY,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS career_applications (
          id BIGSERIAL PRIMARY KEY,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          role TEXT NOT NULL,
          experience_level TEXT NOT NULL,
          portfolio_url TEXT,
          message TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      formTablesSetup = null;
      throw error;
    });
  }
  await formTablesSetup;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function reportFormDatabaseError(res, operation, error) {
  const missingDatabaseUrl = !databaseUrl;
  console.error(`${operation} database operation failed:`, error);
  return res.status(missingDatabaseUrl ? 503 : 500).json({
    success: false,
    error: missingDatabaseUrl
      ? 'DATABASE_URL is not configured.'
      : `Unable to save ${operation}. Please try again later.`
  });
}

// 1. Save "Register Now" Form
app.post('/api/register', async (req, res) => {
  const body = req.body || {};
  const values = [
    body.firstName ?? body.first_name,
    body.lastName ?? body.last_name,
    body.email,
    body.phone,
    body.course,
    body.status ?? body.current_status
  ];
  if (!values.every(isNonEmptyString)) {
    return res.status(400).json({ success: false, error: 'Please complete all registration fields.' });
  }

  try {
    await ensureFormTables();
    await pool.query(
      `INSERT INTO registrations (first_name, last_name, email, phone, course, current_status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      values.map((value) => value.trim())
    );
    return res.status(200).json({ success: true, message: FORM_SUCCESS_MESSAGE });
  } catch (error) {
    return reportFormDatabaseError(res, 'registration', error);
  }
});

// 2. Save "Send Us a Message" Form
app.post('/api/enquiry', async (req, res) => {
  const { full_name, email, phone, message } = req.body || {};
  const values = [full_name, email, phone, message];
  if (!values.every(isNonEmptyString)) {
    return res.status(400).json({ success: false, error: 'Please complete all enquiry fields.' });
  }

  try {
    await ensureFormTables();
    await pool.query(
      `INSERT INTO enquiries (full_name, email, phone, message)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      values.map((value) => value.trim())
    );
    return res.status(200).json({ success: true, message: FORM_SUCCESS_MESSAGE });
  } catch (error) {
    return reportFormDatabaseError(res, 'enquiry', error);
  }
});

app.post('/api/careers', async (req, res) => {
  const { full_name, email, phone, role, experience_level, portfolio_url, message } = req.body || {};
  if (![full_name, email, phone, role, experience_level, message].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ success: false, error: 'Please provide all required application fields.' });
  }
  if (portfolio_url != null && typeof portfolio_url !== 'string') {
    return res.status(400).json({ success: false, error: 'Portfolio URL must be a string.' });
  }

  try {
    await ensureFormTables();
    await pool.query(
      `INSERT INTO career_applications
        (full_name, email, phone, role, experience_level, portfolio_url, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [full_name.trim(), email.trim(), phone.trim(), role.trim(), experience_level.trim(), portfolio_url?.trim() || null, message.trim()]
    );
    return res.status(200).json({ success: true, message: FORM_SUCCESS_MESSAGE });
  } catch (error) {
    return reportFormDatabaseError(res, 'career application', error);
  }
});

app.get('/api/users', async (_req, res) => {
  try {
    await ensureFormTables();
    const result = await pool.query('SELECT name, email FROM users ORDER BY name');
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('User list database query failed:', error);
    return res.status(500).json({ error: 'Unable to load users.' });
  }
});

app.post('/api/users', async (req, res) => {
  const { name, email } = req.body || {};
  if (!isNonEmptyString(name) || !isNonEmptyString(email)) {
    return res.status(400).json({ success: false, error: 'Name and email are required.' });
  }

  try {
    await ensureFormTables();
    const result = await pool.query(
      `INSERT INTO users (name, email)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [name.trim(), email.trim()]
    );
    if (!result.rows.length) {
      return res.status(409).json({ success: false, error: 'A user with this email already exists.' });
    }
    return res.status(201).json({ success: true });
  } catch (error) {
    return reportFormDatabaseError(res, 'user', error);
  }
});

function builtInChatReply(message) {
  const normalized = message.toLowerCase();
  if (/₹\s*49|2[- ]hour|live workshop|workshops?/.test(normalized)) {
    return {
      reply: 'Our 2-hour live workshops have a ₹49 registration fee and include a live session plus a verified e-certificate. See /training.html for details. We also offer hands-on 1-, 3- and 6-month internship tracks with project mentoring and placement support.'
    };
  }
  if (/fee|fees|price|pricing|cost|schedule|event/.test(normalized)) {
    return {
      reply: 'The 2-hour live workshops cost ₹49 and include a live session plus a verified e-certificate. For course fees or upcoming dates, contact SK SMART AI TECHNOLOGIES at +91 93614 83073.',
      whatsapp_url: 'https://wa.me/919361483073'
    };
  }
  if (/certificate|verify|verification/.test(normalized)) {
    return { reply: 'Enter your certificate number or scan the certificate QR code on /verify.html to check it against the official SK SMART AI TECHNOLOGIES registry.', action: 'verify_certificate' };
  }
  if (/internship|bootcamp|placement/.test(normalized)) {
    return {
      reply: 'Our courses and internships are available online and offline. Topics include Data Science, AI, Machine Learning, Deep Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java Programming. See /courses.html and /training.html for details.'
    };
  }
  if (/course|training|learn|class/.test(normalized)) {
    return {
      reply: 'Our online and offline courses cover Data Science, Artificial Intelligence, Machine Learning, Deep Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java Programming. See /courses.html and /training.html.'
    };
  }
  if (/solution|service|enterprise|software|cloud|automation|website|mobile app/.test(normalized)) {
    return {
      reply: 'Our IT solutions include Website Building, Mobile App Development, Software Development, Data Analytics, and Digital Marketing. See /services.html or /contact.html. Call +91 93614 83073 or email sksmartaitechnologies@gmail.com for enquiries.'
    };
  }
  if (/contact|phone|call|email|whatsapp/.test(normalized)) {
    return {
      reply: 'Contact SK SMART AI TECHNOLOGIES at +91 93614 83073 or sksmartaitechnologies@gmail.com.'
    };
  }
  return {
    reply: 'I can help with SK SMART AI TECHNOLOGIES courses, IT solutions, internships and workshops, certificate verification, or contacting our team.',
    options: ['Courses & Internships', '₹49 Live Workshops', 'Verify Certificate', 'IT Solutions & Contact']
  };
}

const CHAT_SYSTEM_PROMPT = 'You are the helpful, concise website assistant for SK SMART AI TECHNOLOGIES. Answer using only these known business details and do not invent prices, schedules, guarantees, or services. Courses and internships are available in online and offline modes and cover Data Science, Artificial Intelligence (AI), Machine Learning, Deep Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java Programming. Internship tracks include 1-, 3-, and 6-month options with hands-on projects, mentoring, and placement support. See /courses.html and /training.html. The 2-hour live workshops have a ₹49 registration fee and include a live session plus a verified e-certificate; see /training.html. To verify a certificate, enter its Certificate Number or scan the certificate QR code on /verify.html. IT solutions include website building, mobile app development, software development, data analytics, and digital marketing; see /services.html and /contact.html. Contact the team at +91 93614 83073 or sksmartaitechnologies@gmail.com. Keep replies focused and point visitors to the relevant page when useful.';

function sanitizedChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    if (!['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim()) return [];
    return [{
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content.trim().slice(0, 2000) }]
    }];
  });
}

async function geminiChatReply(message, history) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
        contents: [
          ...sanitizedChatHistory(history),
          { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Gemini API returned HTTP ${response.status}.`);
    const result = await response.json();
    const reply = result.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part.text === 'string' ? part.text : '')
      .join('');
    if (typeof reply === 'string' && reply.trim()) return reply.trim();
    console.error('Gemini chat response did not contain a reply; using the built-in assistant.');
  } catch (error) {
    console.warn('Gemini chat request failed; using the built-in assistant:', error);
  } finally {
    clearTimeout(timeout);
  }
  return null;
}

app.post('/api/chat', async (req, res) => {
  const message = req.body?.message;
  if (!isNonEmptyString(message)) {
    return res.status(400).json({ error: 'Please enter a message.' });
  }
  const reply = await geminiChatReply(message.trim(), req.body?.history);
  return res.status(200).json(reply ? { reply } : builtInChatReply(message.trim()));
});

function extractCertificateNumber(value) {
  if (!isNonEmptyString(value)) return '';
  const input = value.trim();
  let url;
  try {
    url = new URL(input);
  } catch {
    if (!/[/?]/.test(input)) return input;
    try {
      url = new URL(input, 'https://verification.invalid');
    } catch {
      return input;
    }
  }

  for (const [key, parameterValue] of url.searchParams) {
    if (key.toLowerCase() === 'id' && parameterValue.trim()) {
      return parameterValue.trim();
    }
  }
  const pathSegments = url.pathname.split('/').filter(Boolean);
  return pathSegments.length ? pathSegments[pathSegments.length - 1] : '';
}

async function verifyCertificate(res, submittedValue) {
  const certificateNumber = extractCertificateNumber(submittedValue);
  if (!certificateNumber) {
    return res.status(400).json({ error: 'Please enter a certificate number.' });
  }

  try {
    let result;
    try {
      result = await pool.query(
        `SELECT certificate_number, name, date
         FROM certificates
         WHERE UPPER(TRIM(certificate_number)) = UPPER(TRIM($1))`,
        [certificateNumber]
      );
    } catch (error) {
      if (error.code !== '42703' || error.column !== 'certificate_number') throw error;
      result = await pool.query(
        `SELECT certificate_id, name, date
         FROM certificates
         WHERE UPPER(TRIM(certificate_id)) = UPPER(TRIM($1))`,
        [certificateNumber]
      );
    }

    if (!result.rows.length || !(result.rows[0].certificate_number ?? result.rows[0].certificate_id)) {
      return res.status(404).json({ verified: false });
    }
    const row = result.rows[0];
    return res.status(200).json({
      verified: true,
      certificate_number: row.certificate_number ?? row.certificate_id,
      name: row.name,
      date: row.date
    });
  } catch (error) {
    console.error('Certificate verification database query failed:', error);
    return res.status(500).json({ error: 'Certificate verification is temporarily unavailable.' });
  }
}

// 3. Add a New Certificate (For You to Issue Certificates)
app.post('/api/certificates', async (req, res) => {
  const { certificate_id, student_name, course_name, issue_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO certificates (certificate_id, student_name, course_name, issue_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [certificate_id.trim().toUpperCase(), student_name, course_name, issue_date]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. Verify Certificate (Manual Search & QR Code Scan)
app.get('/api/verify', async (req, res) => {
  const submittedValue = Object.entries(req.query)
    .find(([key]) => ['id', 'certificate_number'].includes(key.toLowerCase()))?.[1];
  return verifyCertificate(res, submittedValue);
});

app.get('/api/verify/:certInput', async (req, res) => {
  return verifyCertificate(res, req.params.certInput);
});

app.use('/api', (_req, res) => {
  return res.status(404).json({ success: false, error: 'API endpoint not found.' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (!req.path.startsWith('/api/')) return next(error);

  const status = Number(error.status || error.statusCode);
  const statusCode = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const message = error.type === 'entity.parse.failed'
    ? 'Invalid JSON request body.'
    : 'The API request could not be completed.';
  console.error(`Unhandled API error (${statusCode}) for ${req.method} ${req.originalUrl}:`, error);
  return res.status(statusCode).json({ success: false, error: message });
});

export { pool };
export default app;

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Website running on port ${port}`));
}