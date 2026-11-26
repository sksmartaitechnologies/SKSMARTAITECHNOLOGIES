import http.client
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import PurePosixPath

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
    "Courses",
    "IT solutions",
    "Internships and workshops",
    "Verify a certificate",
    "Contact",
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

    if re.search(r"\b(fee|fees|price|pricing|cost|event|events|schedule)\b", normalized):
        return {
            "reply": (
                "For current fees and upcoming events, contact SK SMART AI "
                "TECHNOLOGIES at 9361483073."
            ),
            "whatsapp_url": WHATSAPP_CONTACT_URL,
        }
    if re.search(r"\b(certificate|certificates|verify|verification)\b", normalized):
        return {
            "reply": (
                "Enter your certificate number or ID on the verification page to check it "
                "against the official SK SMART AI TECHNOLOGIES registry."
            ),
            "action": "verify_certificate",
        }
    if re.search(r"\b(internship|internships|workshop|workshops|bootcamp|placement)\b", normalized):
        return {
            "reply": (
                "We offer hands-on 1-, 3- and 6-month internship tracks, live workshops "
                "and bootcamps, project mentoring, and placement support. Contact us "
                "for the next batch schedule."
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
                "SK SMART AI TECHNOLOGIES delivers web and mobile applications, "
                "software and cloud platforms, applied AI, automation, and analytics. "
                "Here are our core services:\n• " + "\n• ".join(SERVICES)
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


def nvidia_chat_reply(message):
    api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not api_key:
        return None

    payload = {
        "model": os.environ.get("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct"),
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the assistant for SK SMART AI TECHNOLOGIES. Answer questions "
                    "about its courses, IT solutions, internships, workshops, certificate "
                    "verification, and contact details. Courses include "
                    f"{', '.join(COURSES)}. Core services include {', '.join(SERVICES)}. "
                    "The team offers 1-, 3- and 6-month internships and live workshops. "
                    "Contact: +91 93614 83073 or sksmartaitechnologies@gmail.com. "
                    "Be concise and do not invent specific prices or schedules; ask the "
                    "visitor to contact the team for current availability."
                ),
            },
            {"role": "user", "content": message},
        ],
        "temperature": 0.3,
        "max_tokens": 400,
        "stream": False,
    }
    request = urllib.request.Request(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
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
        app.logger.warning("NVIDIA chat request failed; using built-in response: %s", error)
        return None

    try:
        reply = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        app.logger.warning("NVIDIA chat response was invalid; using built-in response: %s", error)
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
    external_reply = nvidia_chat_reply(message)
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


@app.post("/api/certificates/verify")
def verify_certificate():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send a JSON request with a certificate number."}), 400

    certificate_number = data.get("certificate_number")
    if not isinstance(certificate_number, str) or not certificate_number.strip():
        return jsonify({"error": "Please enter your certificate number."}), 400

    try:
        record = find_certificate(certificate_number, DATABASE_PATH)
    except DatabaseError:
        app.logger.exception("Certificate database lookup failed.")
        return jsonify({"error": "Certificate verification is temporarily unavailable."}), 500

    if record is None or not record["is_valid"]:
        return jsonify({"valid": False})

    return jsonify(
        {
            "valid": True,
            "certificate_number": record["certificate_number"],
            "student_name": record["student_name"],
            "issue_date": record["issue_date"],
            "course": record["course"],
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
