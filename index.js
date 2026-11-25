import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString || connectionString.includes('<PASTE_')) {
    throw new Error('Set DATABASE_URL in .env before running this script.');
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
});

try {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    `);

    const saved = await pool.query(
        `INSERT INTO users (name, email)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING
         RETURNING *`,
        ['Grace Hopper', 'grace@example.com'],
    );

    if (saved.rows.length > 0) {
        console.log('Saved:', saved.rows[0]);
    } else {
        console.log('Already saved:', 'grace@example.com');
    }

    const { rows } = await pool.query('SELECT * FROM users ORDER BY id');
    console.table(rows);
} finally {
    await pool.end();
}
