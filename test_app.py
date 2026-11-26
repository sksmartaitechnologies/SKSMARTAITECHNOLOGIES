import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock
from unittest.mock import patch

import app
from certificate_store import add_certificate, list_enquiries, revoke_certificate


class ChatbotTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "certificates.sqlite3"
        self.database_url_patch = patch.dict(
            os.environ,
            {"DATABASE_URL": "", "GEMINI_API_KEY": ""},
        )
        self.database_url_patch.start()
        self.database_patch = patch.object(app, "DATABASE_PATH", self.database_path)
        self.database_patch.start()
        self.client = app.app.test_client()

    def tearDown(self):
        self.database_patch.stop()
        self.database_url_patch.stop()
        self.temp_dir.cleanup()

    def test_chat_fallback_covers_the_requested_topics_without_options(self):
        response = self.client.post("/api/chat", json={"message": "What can I do?"})

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("options", response.get_json())
        self.assertIn("courses and internships", response.get_json()["reply"])
        self.assertIn("[Verify Certificate Page](/verify)", response.get_json()["reply"])
        self.assertNotIn(".html", response.get_json()["reply"])

    def test_chat_falls_back_to_builtin_answer_without_gemini_key(self):
        response = self.client.post(
            "/api/chat",
            json={"message": "Do you have internships?"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("online and offline", response.get_json()["reply"].casefold())
        self.assertIn("[Training](/training)", response.get_json()["reply"])
        self.assertNotIn(".html", response.get_json()["reply"])

    def test_chat_fallback_explains_fees_and_registration_with_friendly_links(self):
        fees = self.client.post(
            "/api/chat", json={"message": "What are the internship fees and stipend?"}
        ).get_json()["reply"]
        registration = self.client.post(
            "/api/chat", json={"message": "How do I register?"}
        ).get_json()["reply"]
        verification = self.client.post(
            "/api/chat", json={"message": "How do I verify a certificate?"}
        ).get_json()["reply"]
        services = self.client.post(
            "/api/chat", json={"message": "Tell me about IT solutions"}
        ).get_json()["reply"]

        self.assertIn("fees vary by selected program, duration", fees)
        self.assertIn("stipend opportunities based on performance and project role", fees)
        self.assertIn("[Contact Page](/contact)", fees)
        self.assertIn("academic details and preferred domain", registration)
        self.assertIn("confirm enrollment and schedule details", registration)
        self.assertIn("[Verify Certificate Page](/verify)", verification)
        self.assertIn("custom website development", services)
        for reply in (fees, registration, verification, services):
            self.assertNotIn(".html", reply)

    def test_chat_falls_back_when_gemini_request_times_out(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}):
            with patch("app.urllib.request.urlopen", side_effect=TimeoutError("timed out")):
                response = self.client.post(
                    "/api/chat",
                    json={"message": "Tell me about online and offline courses"},
                )

        self.assertEqual(response.status_code, 200)
        self.assertIn("Data Science", response.get_json()["reply"])

    def test_chat_falls_back_when_gemini_rate_limits(self):
        error = app.urllib.error.HTTPError(
            "https://generativelanguage.googleapis.com/",
            429,
            "Too Many Requests",
            {},
            None,
        )
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}):
            with patch("app.urllib.request.urlopen", side_effect=error):
                response = self.client.post(
                    "/api/chat",
                    json={"message": "Tell me about online and offline courses"},
                )

        self.assertEqual(response.status_code, 200)
        self.assertIn("Data Science", response.get_json()["reply"])

    def test_chat_calls_gemini_api_with_conversation_history(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def read(self):
                return json.dumps(
                    {"candidates": [{"content": {"parts": [{"text": "Gemini answer"}]}}]}
                ).encode("utf-8")

        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}):
            with patch("app.urllib.request.urlopen", return_value=FakeResponse()) as urlopen:
                response = self.client.post(
                    "/api/chat",
                    json={
                        "message": "Tell me about courses",
                        "history": [
                            {"role": "user", "content": "Hello"},
                            {"role": "assistant", "content": "Welcome"},
                        ],
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"reply": "Gemini answer"})
        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-3.5-flash-lite:generateContent",
        )
        self.assertEqual(request.get_header("X-goog-api-key"), "test-key")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 8)
        payload = json.loads(request.data)
        self.assertEqual(payload["contents"][0]["role"], "user")
        self.assertEqual(payload["contents"][1]["role"], "model")
        self.assertEqual(payload["contents"][2]["parts"][0]["text"], "Tell me about courses")
        self.assertIn("Data Science", payload["systemInstruction"]["parts"][0]["text"])
        self.assertIn("certificate QR code", payload["systemInstruction"]["parts"][0]["text"])
        self.assertIn("custom website development", payload["systemInstruction"]["parts"][0]["text"])
        self.assertIn("stipend opportunities", payload["systemInstruction"]["parts"][0]["text"])
        self.assertIn("academic details and preferred domain", payload["systemInstruction"]["parts"][0]["text"])
        self.assertNotIn(".html", payload["systemInstruction"]["parts"][0]["text"])

    def test_every_site_page_is_served(self):
        for page in app.SITE_PAGES:
            response = self.client.get(f"/{page}.html")
            try:
                self.assertEqual(response.status_code, 200)
            finally:
                response.close()

    def test_selected_pages_are_available_at_clean_urls(self):
        for page in ("careers", "verify"):
            response = self.client.get(f"/{page}")
            try:
                self.assertEqual(response.status_code, 200)
            finally:
                response.close()

    def test_native_chat_widget_is_available_without_botpress_or_intercom(self):
        pages = (
            "about",
            "careers",
            "contact",
            "courses",
            "index",
            "services",
            "training",
            "verify",
        )
        for page in pages:
            response = self.client.get(f"/{page}.html")
            try:
                self.assertIn(b'id="chatbotToggleBtn"', response.data)
                self.assertIn(b'id="chatbotPopup"', response.data)
                self.assertIn(b'id="chatMessages"', response.data)
                self.assertIn(b'id="chatForm"', response.data)
                self.assertIn(
                    b"Hello! Welcome to SK SMART AI TECHNOLOGIES. How can I assist you "
                    b"today with our courses, internships, certificate verification, or IT solutions?",
                    response.data,
                )
                self.assertNotIn(b'chat-quick-reply', response.data)
                self.assertNotIn(b'<iframe', response.data)
                self.assertNotIn(b'botpress.cloud', response.data)
                self.assertNotIn(b'window.intercomSettings', response.data)
                self.assertNotIn(b'widget.intercom.io', response.data)
            finally:
                response.close()

    def test_static_assets_are_served_without_exposing_project_files(self):
        for asset in ("style.css", "script.js"):
            response = self.client.get(f"/{asset}")
            try:
                self.assertEqual(response.status_code, 200)
            finally:
                response.close()

        self.assertEqual(self.client.get("/.env").status_code, 404)
        self.assertEqual(self.client.get("/package.json").status_code, 404)

    def test_courses_and_services_return_site_lists(self):
        courses = self.client.post("/api/chat", json={"message": "List courses"})
        services = self.client.post("/api/chat", json={"message": "Show services"})

        self.assertIn("Machine Learning", courses.get_json()["reply"])
        self.assertIn("Cloud Computing", courses.get_json()["reply"])
        self.assertIn("custom website development", services.get_json()["reply"])
        self.assertIn("mobile app development", services.get_json()["reply"])
        self.assertNotIn(".html", courses.get_json()["reply"])
        self.assertNotIn(".html", services.get_json()["reply"])

    def test_verification_intent_asks_for_certificate_number(self):
        response = self.client.post(
            "/api/chat", json={"message": "I want to verify my certificate"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["action"], "verify_certificate")
        self.assertIn("Certificate Number directly in this chat", response.get_json()["reply"])

    def test_contact_enquiry_is_saved_to_database(self):
        enquiry = {
            "full_name": "Example Student",
            "email": "student@example.com",
            "phone": "9361483073",
            "message": "I want to know about Python course fees.",
        }

        response = self.client.post("/api/enquiries", json=enquiry)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.get_json(),
            {
                "success": True,
                "message": "Thank you. Your enquiry has been received.",
            },
        )
        saved = list_enquiries(self.database_path)
        self.assertEqual(len(saved), 1)
        self.assertEqual(
            {key: saved[0][key] for key in enquiry},
            enquiry,
        )

    def test_contact_enquiry_requires_all_fields(self):
        response = self.client.post(
            "/api/enquiries",
            json={"full_name": "Example Student", "email": "student@example.com"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(list_enquiries(self.database_path), [])

    def test_registration_requires_database_url(self):
        response = self.client.post(
            "/api/register",
            json={
                "firstName": "Example",
                "lastName": "Student",
                "email": "student@example.com",
                "phone": "9361483073",
                "course": "Python Programming",
                "status": "Studying",
            },
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {"success": False, "error": "DATABASE_URL is not configured."},
        )

    def test_registration_creates_table_inserts_fields_and_commits(self):
        connection = MagicMock()
        cursor = MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        registration = {
            "firstName": " Example ",
            "lastName": " Student ",
            "email": "student@example.com",
            "phone": "9361483073",
            "course": "Python Programming",
            "status": "Studying",
        }

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test/db"}):
            with patch("app.psycopg.connect", return_value=connection) as connect:
                response = self.client.post("/api/register", json=registration)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "success": True,
                "message": "Thank you! Our team will contact you shortly.",
            },
        )
        connect.assert_called_once_with("postgresql://test/db", sslmode="require")
        self.assertIn("CREATE TABLE IF NOT EXISTS registrations", cursor.execute.call_args_list[0].args[0])
        self.assertIn("INSERT INTO registrations", cursor.execute.call_args_list[1].args[0])
        self.assertEqual(
            cursor.execute.call_args_list[1].args[1],
            ("Example", "Student", "student@example.com", "9361483073", "Python Programming", "Studying"),
        )
        connection.commit.assert_called_once_with()

    def test_registration_returns_json_when_database_fails(self):
        registration = {
            "first_name": "Example",
            "last_name": "Student",
            "email": "student@example.com",
            "phone": "9361483073",
            "course": "Python Programming",
            "current_status": "Studying",
        }

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://test/db"}):
            with patch(
                "app.psycopg.connect",
                side_effect=app.psycopg.OperationalError("database unavailable"),
            ):
                response = self.client.post("/api/register", json=registration)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.get_json(),
            {
                "success": False,
                "error": "Unable to save registration. Please try again later.",
            },
        )

    def test_plain_id_and_qr_url_return_only_updated_certificate_fields(self):
        add_certificate(
            "SKSAIDM202602",
            "Example Student",
            "2026-03-15",
            "Python Programming",
            self.database_path,
        )

        for submitted_value in (
            "SKSAIDM202602",
            "HTTPS://SKSMARTAITECHNOLOGIES.COM/?ID=SKSAIDM202602",
        ):
            with self.subTest(submitted_value=submitted_value):
                response = self.client.post(
                    "/api/verify",
                    json={"certificate_number": submitted_value},
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.get_json(),
                    {
                        "verified": True,
                        "certificate_number": "SKSAIDM202602",
                        "name": "Example Student",
                        "date": "2026-03-15",
                    },
                )

        query_response = self.client.get(
            "/api/verify?iD=SKSAIDM202602"
        )
        self.assertEqual(query_response.status_code, 200)
        self.assertEqual(query_response.get_json()["verified"], True)

    def test_certificate_id_fallback_is_used_for_older_test_database(self):
        with sqlite3.connect(self.database_path) as connection:
            connection.execute(
                """
                CREATE TABLE certificates (
                    certificate_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "INSERT INTO certificates (certificate_id, name, date) VALUES (?, ?, ?)",
                ("SKSAIDM202602", "Example Student", "2026-03-15"),
            )

        response = self.client.post(
            "/api/verify",
            json={
                "certificate_number":
                    "https://www.sksmartaitechnologies.com/verify.html?id=SKSAIDM202602"
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "verified": True,
                "certificate_number": "SKSAIDM202602",
                "name": "Example Student",
                "date": "2026-03-15",
            },
        )

    def test_unknown_and_revoked_certificates_are_not_valid(self):
        add_certificate(
            "SK-REVOKED-001",
            "Example Student",
            "2026-03-15",
            "Python Programming",
            self.database_path,
        )
        self.assertTrue(revoke_certificate("SK-REVOKED-001", self.database_path))

        unknown = self.client.post(
            "/api/certificates/verify", json={"certificate_number": "not-real"}
        )
        revoked = self.client.post(
            "/api/certificates/verify",
            json={"certificate_number": "SK-REVOKED-001"},
        )

        self.assertEqual(unknown.get_json(), {"verified": False})
        self.assertEqual(revoked.get_json(), {"verified": False})

    def test_certificate_verification_requires_a_number(self):
        response = self.client.post("/api/certificates/verify", json={})

        self.assertEqual(response.status_code, 400)
        self.assertIn("certificate number", response.get_json()["error"])

    def test_chat_requires_a_nonempty_message(self):
        response = self.client.post("/api/chat", json={"message": " "})

        self.assertEqual(response.status_code, 400)

    def test_local_frontend_can_call_chat_api_from_live_server(self):
        response = self.client.post(
            "/api/chat",
            json={"message": "List courses"},
            headers={"Origin": "http://127.0.0.1:5500"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["Access-Control-Allow-Origin"],
            "http://127.0.0.1:5500",
        )


if __name__ == "__main__":
    unittest.main()
