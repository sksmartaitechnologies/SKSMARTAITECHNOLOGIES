import http.client
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import PurePosixPath
from urllib.parse import parse_qsl, urlsplit

import psycopg
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

from certificate_store import (
    DATABASE_PATH,
    DatabaseError,
    add_enquiry,
    find_certificate,
)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__)
SITE_PAGES = {
    "about",
    "careers",
    "contact",
    "courses",
    "index",
    "services",
    "training",
    "users",
    "verify",
}
STATIC_EXTENSIONS = {
    ".css",
    ".gif",
    ".html",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".otf",
    ".png",
    ".svg",
    ".ttf",
    ".webp",
    ".woff",
    ".woff2",
}
COURSES = (
    "Data Science",
    "Artificial Intelligence (AI)",
    "Machine Learning",
    "Deep Learning",
    "Data Analytics",
    "Full Stack Development",
    "Cloud Computing",
    "Digital Marketing",
    "Java Programming",
)
CHAT_SYSTEM_PROMPT = (
    "You are the professional, welcoming assistant for SK SMART AI TECHNOLOGIES. Give "
    "clear, helpful answers in a natural tone, using only the facts in this prompt. Never "
    "display raw file paths or file extensions. Link to pages using Markdown and these "
    "clean paths: [Courses](/courses), [Training](/training), "
    "[Verify Certificate Page](/verify), [Services Page](/services), "
    "[Contact Page](/contact). Courses and internships are available Online and Offline "
    "and cover Data Science, Artificial Intelligence (AI), Machine Learning, Deep Learning, "
    "Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, and Java "
    "Programming. Course and internship fees vary by selected program, duration, and "
    "training mode. Eligible internship candidates may receive stipend opportunities based "
    "on performance and project role. For exact fees and the syllabus, direct visitors to "
    "submit their details on the Contact Page, or review Courses and Training. For "
    "registration, explain these steps: explore programs on Courses or Training; submit "
    "the registration/enquiry form on Contact with academic details and preferred domain; "
    "then the team will reach out to confirm enrollment and schedule details. For "
    "certificate verification, ask visitors to enter their Certificate Number directly in "
    "chat or use the Verify Certificate Page to enter the ID or scan the certificate QR "
    "code. IT solutions include custom website development, mobile app development, "
    "software development, data analytics, and digital marketing; direct business "
    "enquiries to Services or Contact. Do not invent fees, eligibility outcomes, or "
    "schedules."
)

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
        }
    },
)


@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:filename>")
def site_file(filename):
    path = PurePosixPath(filename)
    if any(part.startswith(".") for part in path.parts):
        abort(404)
    if not path.suffix and filename in SITE_PAGES:
        filename = f"{filename}.html"
        path = PurePosixPath(filename)
    if path.suffix.lower() not in STATIC_EXTENSIONS:
        abort(404)
    return send_from_directory(BASE_DIR, filename)


def build_chat_reply(message):
    normalized = message.casefold()

    if re.search(r"\b(fee|fees|cost|pricing|price|stipend|stipends|salary|payment)\b", normalized):
        return {
            "reply": (
                "Course and internship fees vary by selected program, duration, and training "
                "mode (Online or Offline). Eligible internship candidates may also receive "
                "stipend opportunities based on performance and project role. For the exact "
                "fee structure and syllabus, please submit your details on the "
                "[Contact Page](/contact), or explore [Courses](/courses) and "
                "[Training](/training)."
            ),
        }
    if re.search(
        r"\b(apply|application|register|registration|admission|enroll|enrollment|"
        r"enrol|enrolment|process)\b",
        normalized,
    ):
        return {
            "reply": (
                "To get started: 1) Explore programs on [Courses](/courses) or "
                "[Training](/training). 2) Submit the registration/enquiry form on the "
                "[Contact Page](/contact) with your academic details and preferred domain. "
                "3) Our team will reach out to confirm enrollment and schedule details."
            ),
        }
    if re.search(r"\b(certificate|certificates|verify|verification)\b", normalized):
        return {
            "reply": (
                "Please enter your Certificate Number directly in this chat, or use the "
                "[Verify Certificate Page](/verify) to enter your ID or scan your "
                "certificate QR code."
            ),
            "action": "verify_certificate",
        }
    if re.search(r"\b(internship|internships|bootcamp|placement)\b", normalized):
        return {
            "reply": (
                "Our Online and Offline courses and internships cover Data Science, "
                "Artificial Intelligence (AI), Machine Learning, Deep Learning, Data "
                "Analytics, Full Stack Development, Cloud Computing, Digital Marketing, "
                "and Java Programming. Explore [Courses](/courses) and "
                "[Training](/training) to find a program that suits you."
            ),
        }
    if re.search(r"\b(course|courses|class|classes|learn|training program)\b", normalized):
        return {
            "reply": (
                "SK SMART AI TECHNOLOGIES offers Online and Offline programs in:\n• "
                + "\n• ".join(COURSES)
                + "\nExplore [Courses](/courses) and [Training](/training) for program details."
            ),
        }
    if re.search(
        r"\b(java|machine learning|deep learning|data science|data analytics|"
        r"cloud computing|full stack|digital marketing|artificial intelligence)\b",
        normalized,
    ):
        return {
            "reply": (
                "SK SMART AI TECHNOLOGIES offers Online and Offline programs in:\n• "
                + "\n• ".join(COURSES)
                + "\nExplore [Courses](/courses) and [Training](/training) for program details."
            ),
        }
    if re.search(r"\b(service|services|enterprise|solution|solutions|website|mobile app|software|cloud|automation)\b", normalized):
        return {
            "reply": (
                "SK SMART AI TECHNOLOGIES provides custom website development, mobile app "
                "development, software development, data analytics, and digital marketing. "
                "Learn more on the [Services Page](/services) or connect through the "
                "[Contact Page](/contact)."
            ),
        }
    if re.search(r"\b(contact|phone|call|whatsapp)\b", normalized):
        return {
            "reply": "For assistance, please use the [Contact Page](/contact).",
        }

    return {
        "reply": (
            "Hello! I can help with our courses and internships, certificate verification, "
            "or IT solutions. Explore [Courses](/courses), [Training](/training), "
            "[Verify Certificate Page](/verify), [Services Page](/services), or "
            "[Contact Page](/contact)."
        ),
    }


def sanitized_chat_history(history):
    if not isinstance(history, list):
        return []
    messages = []
    for item in history[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append(
                {
                    "role": "user" if role == "user" else "model",
                    "parts": [{"text": content.strip()[:2000]}],
                }
            )
    return messages


def gemini_chat_reply(message, history=None):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    payload = {
        "systemInstruction": {"parts": [{"text": CHAT_SYSTEM_PROMPT}]},
        "contents": sanitized_chat_history(history)
        + [{"role": "user", "parts": [{"text": message}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512},
    }
    request = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-3.5-flash-lite:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (
        http.client.HTTPException,
        urllib.error.URLError,
        TimeoutError,
        OSError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as error:
        app.logger.warning("Gemini chat request failed; using built-in response: %s", error)
        return None

    try:
        reply = "".join(
            part.get("text", "")
            for part in result["candidates"][0]["content"]["parts"]
            if isinstance(part.get("text"), str)
        )
    except (KeyError, IndexError, TypeError, AttributeError) as error:
        app.logger.warning("Gemini chat response was invalid; using built-in response: %s", error)
        return None
    return reply.strip() if isinstance(reply, str) and reply.strip() else None


@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send a JSON request with a message."}), 400

    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Please enter a message."}), 400

    message = message.strip()
    external_reply = gemini_chat_reply(message, data.get("history"))
    if external_reply:
        return jsonify({"reply": external_reply})
    return jsonify(build_chat_reply(message))


@app.post("/api/enquiries")
def create_enquiry():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send your name, email, phone, and message."}), 400

    fields = ("full_name", "email", "phone", "message")
    if any(
        not isinstance(data.get(field), str) or not data[field].strip()
        for field in fields
    ):
        return jsonify({"error": "Please complete all enquiry fields."}), 400

    try:
        add_enquiry(
            *(data[field] for field in fields),
            database_path=DATABASE_PATH,
        )
    except DatabaseError:
        app.logger.exception("Enquiry could not be saved.")
        return jsonify({"error": "Your enquiry could not be saved. Please try again."}), 500

    return jsonify(
        {
            "success": True,
            "message": "Thank you. Your enquiry has been received.",
        }
    ), 201


@app.post("/api/register")
def create_registration():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "Send a JSON request with all registration fields."}), 400

    values = (
        data.get("firstName", data.get("first_name")),
        data.get("lastName", data.get("last_name")),
        data.get("email"),
        data.get("phone"),
        data.get("course"),
        data.get("status", data.get("current_status")),
    )
    if any(not isinstance(value, str) or not value.strip() for value in values):
        return jsonify({"success": False, "error": "Please complete all registration fields."}), 400

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        return jsonify({"success": False, "error": "DATABASE_URL is not configured."}), 503

    try:
        with psycopg.connect(database_url, sslmode="require") as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
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
                    """
                )
                cursor.execute(
                    """
                    INSERT INTO registrations
                        (first_name, last_name, email, phone, course, current_status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    tuple(value.strip() for value in values),
                )
            conn.commit()
    except psycopg.Error:
        app.logger.exception("Registration could not be saved.")
        return jsonify({"success": False, "error": "Unable to save registration. Please try again later."}), 500

    return jsonify(
        {
            "success": True,
            "message": "Thank you! Our team will contact you shortly.",
        }
    ), 200


def extract_certificate_number(value):
    if not isinstance(value, str) or not value.strip():
        return ""

    value = value.strip()
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    is_url = bool(parsed.scheme or parsed.netloc or "/" in value or "?" in value)
    for key, parameter_value in parse_qsl(parsed.query, keep_blank_values=True):
        if key.casefold() == "id" and parameter_value.strip():
            return parameter_value.strip()
    if is_url:
        return next((part for part in reversed(parsed.path.split("/")) if part), "")
    return value


def verify_certificate_number(certificate_number):
    certificate_number = extract_certificate_number(certificate_number)
    if not certificate_number:
        return jsonify({"error": "Please enter your certificate number."}), 400

    try:
        record = find_certificate(certificate_number, DATABASE_PATH)
    except DatabaseError:
        app.logger.exception("Certificate database lookup failed.")
        return jsonify({"error": "Certificate verification is temporarily unavailable."}), 500

    if record is None or record.get("is_valid") is False or record.get("is_valid") == 0:
        return jsonify({"verified": False})

    return jsonify(
        {
            "verified": True,
            "certificate_number": record.get("certificate_number", record.get("certificate_id")),
            "name": record["name"],
            "date": record["date"],
        }
    )


@app.post("/api/verify")
@app.post("/api/certificates/verify")
def verify_certificate():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send a JSON request with a certificate number."}), 400
    return verify_certificate_number(data.get("certificate_number", data.get("id")))


@app.get("/api/verify")
def verify_certificate_from_query():
    submitted_value = next(
        (
            value
            for key, value in request.args.items()
            if key.casefold() in {"id", "certificate_number"}
        ),
        "",
    )
    return verify_certificate_number(submitted_value)


@app.get("/api/verify/<path:certificate_input>")
def verify_certificate_from_url(certificate_input):
    return verify_certificate_number(certificate_input)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
