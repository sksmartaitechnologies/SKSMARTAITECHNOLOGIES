import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app
from certificate_store import add_certificate, list_enquiries, revoke_certificate


class ChatbotTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "certificates.sqlite3"
        self.database_url_patch = patch.dict(
            os.environ,
            {"DATABASE_URL": "", "NVIDIA_API_KEY": ""},
        )
        self.database_url_patch.start()
        self.database_patch = patch.object(app, "DATABASE_PATH", self.database_path)
        self.database_patch.start()
        self.client = app.app.test_client()

    def tearDown(self):
        self.database_patch.stop()
        self.database_url_patch.stop()
        self.temp_dir.cleanup()

    def test_chat_opens_with_courses_services_verification_and_fees(self):
        response = self.client.post("/api/chat", json={"message": "What can I do?"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["options"],
            ["Courses", "IT solutions", "Internships and workshops", "Verify a certificate", "Contact"],
        )

    def test_chat_falls_back_to_builtin_answer_without_nvidia_key(self):
        response = self.client.post(
            "/api/chat",
            json={"message": "Do you have internships and workshops?"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("1-, 3- and 6-month internship tracks", response.get_json()["reply"])

    def test_chat_falls_back_when_nvidia_request_times_out(self):
        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-key"}):
            with patch("app.urllib.request.urlopen", side_effect=TimeoutError("timed out")):
                response = self.client.post(
                    "/api/chat",
                    json={"message": "Tell me about workshops"},
                )

        self.assertEqual(response.status_code, 200)
        self.assertIn("workshops", response.get_json()["reply"])

    def test_chat_calls_nvidia_api_when_key_is_configured(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def read(self):
                return json.dumps(
                    {"choices": [{"message": {"content": "External answer"}}]}
                ).encode("utf-8")

        with patch.dict(os.environ, {"NVIDIA_API_KEY": "test-key"}):
            with patch("app.urllib.request.urlopen", return_value=FakeResponse()) as urlopen:
                response = self.client.post(
                    "/api/chat",
                    json={"message": "Tell me about courses"},
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"reply": "External answer"})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://integrate.api.nvidia.com/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 8)

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

    def test_chatbot_is_available_on_existing_chatbot_pages(self):
        for page in ("about", "contact", "courses", "index", "services", "training"):
            response = self.client.get(f"/{page}.html")
            try:
                self.assertIn(b'id="chatbotToggleBtn"', response.data)
                self.assertIn(b'id="chatUserInput"', response.data)
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
        self.assertIn("Internet of Things (IoT)", courses.get_json()["reply"])
        self.assertIn("Website Building", services.get_json()["reply"])
        self.assertIn("Mobile App Development", services.get_json()["reply"])

    def test_verification_intent_asks_for_certificate_number(self):
        response = self.client.post(
            "/api/chat", json={"message": "I want to verify my certificate"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["action"], "verify_certificate")
        self.assertIn("certificate number", response.get_json()["reply"])

    def test_fee_questions_return_whatsapp_contact(self):
        response = self.client.post(
            "/api/chat", json={"message": "What are the course fees?"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("fees", response.get_json()["reply"])
        self.assertEqual(
            response.get_json()["whatsapp_url"], "https://wa.me/919361483073"
        )

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

    def test_valid_certificate_returns_database_details(self):
        add_certificate(
            "SK-REAL-001",
            "Example Student",
            "2026-03-15",
            "Python Programming",
            self.database_path,
        )

        response = self.client.post(
            "/api/certificates/verify",
            json={"certificate_number": "sk-real-001"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "valid": True,
                "certificate_number": "SK-REAL-001",
                "student_name": "Example Student",
                "issue_date": "2026-03-15",
                "course": "Python Programming",
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

        self.assertEqual(unknown.get_json(), {"valid": False})
        self.assertEqual(revoked.get_json(), {"valid": False})

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
