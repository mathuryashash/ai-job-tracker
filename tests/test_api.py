import os
import sys
import pytest
from fastapi.testclient import TestClient

# Adjust path to find src
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "src"))

# Mock environment variables for testing
os.environ["DATABASE_URL"] = "postgresql://postgres:postgres@localhost:5432/test_resume_tracker"
os.environ["GROQ_API_KEY"] = "gsk_test_key"

import sys
import src.db as db
db.init_db = lambda: None  # Prevent connecting to a real DB on startup
sys.modules["db"] = db     # Prevent separate "db" import collision

from src.main import app
client = TestClient(app)

def test_health_endpoint():
    """
    Verifies that the /health API endpoint returns correct status.
    """
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "service": "AI Resume & Job Tracker"}

def test_db_schemas_exist():
    """
    Verifies that table creation helper queries are correctly defined in db.py.
    """
    # Simply check that db helper function attributes are callable
    assert callable(db.get_connection)
    assert callable(db.init_db)
    assert callable(db.save_resume)
    assert callable(db.save_job_application)

def test_api_applications_crud_routes(monkeypatch):
    """
    Tests GET and POST /api/applications endpoints using mock database helpers.
    """
    mock_app_id = 99
    mock_apps_list = [
        {
            "id": 1,
            "company_name": "Google",
            "position_title": "Software Engineer",
            "status": "todo",
            "cover_letter": "Dear Hirer...",
            "job_description": "We need SEs."
        }
    ]

    # Monkeypatch the database saves and gets to bypass real database connection in unit tests
    monkeypatch.setattr(db, "save_job_application", lambda **kwargs: mock_app_id)
    monkeypatch.setattr(db, "get_job_applications", lambda: mock_apps_list)
    monkeypatch.setattr(db, "update_job_application_status", lambda app_id, status: None)
    monkeypatch.setattr(db, "delete_job_application", lambda app_id: None)

    # 1. Test GET applications
    get_resp = client.get("/api/applications")
    assert get_resp.status_code == 200
    assert get_resp.json()["success"] is True
    assert get_resp.json()["data"] == mock_apps_list

    # 2. Test POST create application
    payload = {
        "company_name": "Netflix",
        "position_title": "Senior developer",
        "job_description": "Coding python",
        "status": "todo"
    }
    post_resp = client.post("/api/applications", json=payload)
    assert post_resp.status_code == 200
    assert post_resp.json()["success"] is True
    assert post_resp.json()["application_id"] == mock_app_id

    # 3. Test PUT update status
    put_resp = client.put(f"/api/applications/{mock_app_id}", json={"status": "applied"})
    assert put_resp.status_code == 200
    assert put_resp.json()["success"] is True

    # 4. Test DELETE application
    del_resp = client.delete(f"/api/applications/{mock_app_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True
