import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const databaseUrl = process.env.DATABASE_URL?.trim();
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
  const { first_name, last_name, email, phone, course, current_status } = req.body || {};
  const values = [first_name, last_name, email, phone, course, current_status];
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
    return res.status(201).json({ success: true });
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
    return res.status(201).json({ success: true });
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
    return res.status(201).json({ success: true });
  } catch (error) {
    return reportFormDatabaseError(res, 'career application', error);
  }
});

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
app.get('/api/verify/:certId', async (req, res) => {
  const certId = req.params.certId.trim().toUpperCase();
  try {
    const result = await pool.query(
      'SELECT certificate_id, student_name, course_name, issue_date FROM certificates WHERE certificate_id = $1',
      [certId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, message: 'Fake or Invalid Certificate' });
    }
    res.json({ valid: true, certificate: result.rows[0] });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

export default app;

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Website running on port ${port}`));
}