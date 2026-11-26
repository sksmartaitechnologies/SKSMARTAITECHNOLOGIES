import os
import sqlite3
from datetime import date
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row


load_dotenv()

DATABASE_PATH = Path(__file__).with_name("certificates.sqlite3")
DatabaseError = (sqlite3.Error, psycopg.Error)
IntegrityError = (sqlite3.IntegrityError, psycopg.IntegrityError)


def _connect(database_path):
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        return psycopg.connect(database_url, sslmode="require", row_factory=dict_row)
    return sqlite3.connect(database_path)


def _execute(connection, query, parameters=()):
    if isinstance(connection, sqlite3.Connection):
        return connection.execute(query, parameters)
    return connection.execute(query.replace("?", "%s"), parameters)


def initialize_database(database_path=DATABASE_PATH):
    with _connect(database_path) as connection:
        if isinstance(connection, sqlite3.Connection):
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS certificates (
                    certificate_number TEXT PRIMARY KEY COLLATE NOCASE,
                    name TEXT NOT NULL,
                    date TEXT NOT NULL,
                    is_valid INTEGER NOT NULL DEFAULT 1
                        CHECK (is_valid IN (0, 1))
                )
                """,
            )
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS enquiries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    full_name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """,
            )
        else:
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS certificates (
                    certificate_number TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date DATE NOT NULL
                )
                """,
            )
            _execute(
                connection,
                """
                CREATE TABLE IF NOT EXISTS enquiries (
                    id BIGSERIAL PRIMARY KEY,
                    full_name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """,
            )
        if isinstance(connection, sqlite3.Connection):
            columns = {
                row[1]
                for row in _execute(connection, "PRAGMA table_info(certificates)").fetchall()
            }
            if "certificate_number" in columns:
                _execute(
                    connection,
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS certificates_number_ci_unique
                    ON certificates (lower(certificate_number))
                    """,
                )


def find_certificate(certificate_number, database_path=DATABASE_PATH):
    initialize_database(database_path)
    with _connect(database_path) as connection:
        if isinstance(connection, sqlite3.Connection):
            connection.row_factory = sqlite3.Row
            columns = {
                row["name"]
                for row in _execute(connection, "PRAGMA table_info(certificates)").fetchall()
            }
        else:
            columns = None

        validity_column = ", is_valid" if columns is not None and "is_valid" in columns else ""
        try:
            record = _execute(
                connection,
                f"""
                SELECT certificate_number, name, date{validity_column}
                FROM certificates
                WHERE UPPER(TRIM(certificate_number)) = UPPER(TRIM(?))
                """,
                (certificate_number.strip(),),
            ).fetchone()
        except sqlite3.OperationalError as error:
            if "no such column: certificate_number" not in str(error).lower():
                raise
            record = _execute(
                connection,
                f"""
                SELECT certificate_id, name, date{validity_column}
                FROM certificates
                WHERE UPPER(TRIM(certificate_id)) = UPPER(TRIM(?))
                """,
                (certificate_number.strip(),),
            ).fetchone()
        except psycopg.errors.UndefinedColumn as error:
            if error.diag is None or error.diag.column_name != "certificate_number":
                raise
            record = _execute(
                connection,
                """
                SELECT certificate_id, name, date
                FROM certificates
                WHERE UPPER(TRIM(certificate_id)) = UPPER(TRIM(?))
                """,
                (certificate_number.strip(),),
            ).fetchone()
    return dict(record) if record is not None else None


def add_certificate(
    certificate_number,
    student_name,
    issue_date,
    course,
    database_path=DATABASE_PATH,
):
    values = (certificate_number, student_name, issue_date, course)
    if any(not isinstance(value, str) or not value.strip() for value in values):
        raise ValueError("Certificate number, student name, course, and issue date are required.")
    date.fromisoformat(issue_date.strip())

    initialize_database(database_path)
    with _connect(database_path) as connection:
        _execute(
            connection,
            """
            INSERT INTO certificates
                (certificate_number, name, date)
            VALUES (?, ?, ?)
            """,
            (
                certificate_number.strip(),
                student_name.strip(),
                issue_date.strip(),
            ),
        )


def revoke_certificate(certificate_number, database_path=DATABASE_PATH):
    initialize_database(database_path)
    with _connect(database_path) as connection:
        cursor = _execute(
            connection,
            """
            UPDATE certificates
            SET is_valid = FALSE
            WHERE lower(certificate_number) = lower(?)
            """,
            (certificate_number.strip(),),
        )
    return cursor.rowcount == 1


def add_enquiry(full_name, email, phone, message, database_path=DATABASE_PATH):
    values = (full_name, email, phone, message)
    if any(not isinstance(value, str) or not value.strip() for value in values):
        raise ValueError("Name, email, phone, and message are required.")

    initialize_database(database_path)
    with _connect(database_path) as connection:
        query = """
            INSERT INTO enquiries (full_name, email, phone, message)
            VALUES (?, ?, ?, ?)
        """
        parameters = tuple(value.strip() for value in values)
        if isinstance(connection, sqlite3.Connection):
            cursor = _execute(connection, query, parameters)
            return cursor.lastrowid
        cursor = _execute(connection, query + " RETURNING id", parameters)
        return cursor.fetchone()["id"]


def list_enquiries(database_path=DATABASE_PATH):
    initialize_database(database_path)
    with _connect(database_path) as connection:
        if isinstance(connection, sqlite3.Connection):
            connection.row_factory = sqlite3.Row
        records = _execute(
            connection,
            """
            SELECT id, full_name, email, phone, message, created_at
            FROM enquiries
            ORDER BY id DESC
            """
        ).fetchall()
    return [dict(record) for record in records]
