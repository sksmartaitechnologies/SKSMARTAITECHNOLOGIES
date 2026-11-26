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
  if (/\b(?:fee|fees|cost|pricing|price|stipend|stipends|salary|payment)\b/.test(normalized)) {
    return {
      reply: 'Course and internship fees vary by selected program, duration, and training mode (Online or Offline). Eligible internship candidates may also receive stipend opportunities based on performance and project role. For the exact fee structure and syllabus, please submit your details on the [Contact Page](/contact), or explore [Courses](/courses) and [Training](/training).'
    };
  }
  if (/\b(?:apply|application|register|registration|admission|enroll|enrollment|enrol|enrolment|process)\b/.test(normalized)) {
    return {
      reply: 'To get started: 1) Explore programs on [Courses](/courses) or [Training](/training). 2) Submit the registration/enquiry form on the [Contact Page](/contact) with your academic details and preferred domain. 3) Our team will reach out to confirm enrollment and schedule details.'
    };
  }
  if (/certificate|verify|verification/.test(normalized)) {
    return { reply: 'Please enter your Certificate Number directly in this chat, or use the [Verify Certificate Page](/verify) to enter your ID or scan your certificate QR code.', action: 'verify_certificate' };
  }
  if (/internship|bootcamp|placement/.test(normalized)) {
    return {
      reply: 'Our Online and Offline courses and internships cover Data Science, Artificial Intelligence (AI), Machine Learning, Deep Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java Programming. Explore [Courses](/courses) and [Training](/training) to find a program that suits you.'
    };
  }
  if (/course|training|learn|class/.test(normalized)) {
    return {
      reply: 'SK SMART AI TECHNOLOGIES offers Online and Offline programs in Data Science, Artificial Intelligence (AI), Machine Learning, Deep Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java Programming. Explore [Courses](/courses) and [Training](/training) for program details.'
    };
  }
  if (/solution|service|enterprise|software|cloud|automation|website|mobile app/.test(normalized)) {
    return {
      reply: 'SK SMART AI TECHNOLOGIES provides custom website development, mobile app development, software development, data analytics, and digital marketing. Learn more on the [Services Page](/services) or connect through the [Contact Page](/contact).'
    };
  }
  if (/contact|phone|call|email|whatsapp/.test(normalized)) {
    return {
      reply: 'For assistance, please use the [Contact Page](/contact).'
    };
  }
  return {
    reply: 'Hello! I can help with our courses and internships, certificate verification, or IT solutions. Explore [Courses](/courses), [Training](/training), [Verify Certificate Page](/verify), [Services Page](/services), or [Contact Page](/contact).'
  };
}

const CHAT_SYSTEM_PROMPT = 'You are the professional, welcoming assistant for SK SMART AI TECHNOLOGIES. Give clear, helpful answers in a natural tone, using only the facts in this prompt. Never display raw file paths or file extensions. Link to pages using Markdown and these clean paths: [Courses](/courses), [Training](/training), [Verify Certificate Page](/verify), [Services Page](/services), [Contact Page](/contact). Courses and internships are available Online and Offline and cover Data Science, Artificial Intelligence (AI), Machine Learning, Deep Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java Programming. Course and internship fees vary by selected program, duration, and training mode. Eligible internship candidates may receive stipend opportunities based on performance and project role. For exact fees and the syllabus, direct visitors to submit their details on the Contact Page, or review Courses and Training. For registration, explain these steps: explore programs on Courses or Training; submit the registration/enquiry form on Contact with academic details and preferred domain; then the team will reach out to confirm enrollment and schedule details. For certificate verification, ask visitors to enter their Certificate Number directly in chat or use the Verify Certificate Page to enter the ID or scan the certificate QR code. IT solutions include custom website development, mobile app development, software development, data analytics, and digital marketing; direct business enquiries to Services or Contact. Do not invent fees, eligibility outcomes, or schedules.';

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