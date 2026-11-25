import re
from pathlib import PurePosixPath

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

from certificate_store import (
    DATABASE_PATH,
    DatabaseError,
    add_enquiry,
    find_certificate,
)


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
    "Services",
    "Verify a certificate",
    "Fees and events",
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
    return send_from_directory(app.root_path, "index.html")


@app.get("/<path:filename>")
def site_file(filename):
    path = PurePosixPath(filename)
    if any(part.startswith(".") for part in path.parts):
        abort(404)
    if path.suffix.lower() not in STATIC_EXTENSIONS:
        abort(404)
    return send_from_directory(app.root_path, filename)


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
            "reply": "Please enter your certificate number and I will check it against our certificate database.",
            "action": "verify_certificate",
        }
    if re.search(r"\b(course|courses|class|classes|learn|training program)\b", normalized):
        return {
            "reply": "Here is our course list:\n• " + "\n• ".join(COURSES),
        }
    if re.search(r"\b(python|java|machine learning|data science|cyber security)\b", normalized):
        return {
            "reply": "Here is our course list:\n• " + "\n• ".join(COURSES),
        }
    if re.search(r"\b(service|services|website|mobile app|software development)\b", normalized):
        return {
            "reply": "Here are our services:\n• " + "\n• ".join(SERVICES),
        }
    if re.search(r"\b(contact|phone|call|whatsapp)\b", normalized):
        return {
            "reply": "Contact SK SMART AI TECHNOLOGIES at 9361483073.",
            "whatsapp_url": WHATSAPP_CONTACT_URL,
        }

    return {
        "reply": "How can I help? Choose one of the options below.",
        "options": QUICK_OPTIONS,
    }


@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Send a JSON request with a message."}), 400

    message = data.get("message")
    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Please enter a message."}), 400

    return jsonify(build_chat_reply(message.strip()))


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

    return jsonify({"message": "Thank you. Your enquiry has been received."}), 201


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
