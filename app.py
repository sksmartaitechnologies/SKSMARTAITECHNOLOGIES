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
WHATSAPP_CONTACT_URL = "https://wa.me/919361483073"
COURSES = (
    "Artificial Intelligence",
    "Machine Learning",
    "Deep Learning",
    "Data Science",
    "Data Analytics",
    "Business Analytics",
    "Full Stack Development",
    "Cloud Computing",
    "Cyber Security",
    "Digital Marketing",
    "Java Programming",
    "Python Programming",
    "Internet of Things (IoT)",
)
SERVICES = (
    "Website Building",
    "Mobile App Development",
    "Data Analytics",
    "Data Visualization",
    "Business Analytics",
    "Software Development",
    "AI Content",
    "Digital Marketing",
)
QUICK_OPTIONS = (
    "Courses & Internships",
    "₹49 Live Workshops",
    "Verify Certificate",
    "IT Solutions & Contact",
)
CHAT_SYSTEM_PROMPT = (
    "You are the helpful, concise website assistant for SK SMART AI TECHNOLOGIES. "
    "Answer using only these known business details and do not invent prices, schedules, "
    "guarantees, or services. Courses and internships are available in online and offline "
    "modes and cover Data Science, Artificial Intelligence (AI), Machine Learning, Deep "
    "Learning, Data Analytics, Full Stack Development, Cloud Computing, Digital Marketing, "
    "and Java Programming. Internship tracks include 1-, 3-, and 6-month options with "
    "hands-on projects, mentoring, and placement support. See /courses.html and "
    "/training.html. The 2-hour live workshops "
    "have a ₹49 registration fee and include a live session plus a verified e-certificate; "
    "see /training.html. To verify a certificate, enter its Certificate Number or scan the "
    "certificate QR code on /verify.html. IT solutions include website building, mobile app "
    "development, software development, data analytics, and digital marketing; see "
    "/services.html and /contact.html. Contact the team at +91 93614 83073 or "
    "sksmartaitechnologies@gmail.com. Keep replies focused and point visitors to the "
    "relevant page when useful."
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

    if re.search(r"(₹\s*49|2[- ]hour|live workshop|workshops?)", normalized):
        return {
            "reply": (
                "Our 2-hour live workshops have a ₹49 registration fee and include a live "
                "session plus a verified e-certificate. See /training.html for details. "
                "We also offer hands-on 1-, 3- and 6-month internship tracks with project "
                "mentoring and placement support."
            ),
        }
    if re.search(r"\b(fee|fees|price|pricing|cost|event|events|schedule)\b", normalized):
        return {
            "reply": (
                "The 2-hour live workshops cost ₹49 and include a live session plus a "
                "verified e-certificate. For course fees or upcoming dates, contact "
                "SK SMART AI TECHNOLOGIES at +91 93614 83073."
            ),
            "whatsapp_url": WHATSAPP_CONTACT_URL,
        }
    if re.search(r"\b(certificate|certificates|verify|verification)\b", normalized):
        return {
            "reply": (
                "Enter your certificate number or scan the certificate QR code on "
                "/verify.html to check it against the official SK SMART AI TECHNOLOGIES registry."
            ),
            "action": "verify_certificate",
        }
    if re.search(r"\b(internship|internships|bootcamp|placement)\b", normalized):
        return {
            "reply": (
                "Our courses and internships are available online and offline. Topics include "
                "Data Science, AI, Machine Learning, Deep Learning, Data Analytics, Full Stack "
                "Development, Cloud Computing, Digital Marketing, and Java Programming. See "
                "/courses.html and /training.html for details."
            ),
            "options": QUICK_OPTIONS,
        }
    if re.search(r"\b(course|courses|class|classes|learn|training program)\b", normalized):
        return {
            "reply": "Here is our course list:\n• " + "\n• ".join(COURSES),
        }
    if re.search(r"\b(python|java|machine learning|data science|cyber security)\b", normalized):
        return {
            "reply": "Here is our course list:\n• " + "\n• ".join(COURSES),
        }
    if re.search(r"\b(service|services|enterprise|solution|solutions|website|mobile app|software|cloud|automation)\b", normalized):
        return {
            "reply": (
                "SK SMART AI TECHNOLOGIES offers website building, mobile app development, "
                "software development, data analytics, and digital marketing. "
                "Here are our core services:\n• " + "\n• ".join(SERVICES)
                + "\nFor enquiries, call +91 93614 83073 or email "
                "sksmartaitechnologies@gmail.com."
            ),
        }
    if re.search(r"\b(contact|phone|call|whatsapp)\b", normalized):
        return {
            "reply": (
                "Contact SK SMART AI TECHNOLOGIES at +91 93614 83073 or "
                "sksmartaitechnologies@gmail.com."
            ),
            "whatsapp_url": WHATSAPP_CONTACT_URL,
        }

    return {
        "reply": (
            "I can help with SK SMART AI TECHNOLOGIES courses, IT solutions, "
            "internships and workshops, certificate verification, or contacting our team."
        ),
        "options": QUICK_OPTIONS,
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
