import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let careerTableSetup;

async function ensureCareerApplicationsTable() {
  if (!careerTableSetup) {
    careerTableSetup = pool.query(`
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
    `).catch((error) => {
      careerTableSetup = null;
      throw error;
    });
  }
  await careerTableSetup;
}

// 1. Save "Register Now" Form
app.post('/api/register', async (req, res) => {
  const { first_name, last_name, email, phone, course, current_status } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO registrations (first_name, last_name, email, phone, course, current_status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [first_name, last_name, email, phone, course, current_status]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 2. Save "Send Us a Message" Form
app.post('/api/enquiry', async (req, res) => {
  const { full_name, email, phone, message } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO enquiries (full_name, email, phone, message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [full_name, email, phone, message]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
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
    await ensureCareerApplicationsTable();
    const result = await pool.query(
      `INSERT INTO career_applications
        (full_name, email, phone, role, experience_level, portfolio_url, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [full_name.trim(), email.trim(), phone.trim(), role.trim(), experience_level.trim(), portfolio_url?.trim() || null, message.trim()]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Career application could not be saved:', err);
    res.status(500).json({ success: false, error: 'The application could not be saved. Please try again later.' });
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