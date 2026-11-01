"""Entry point for hosting the app online (e.g. PythonAnywhere).

Online, a password is always required and login cookies are HTTPS-only.
Set the password first with:  python3 app.py set-password
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("JOBCOST_REQUIRE_PASSWORD", "1")
os.environ.setdefault("JOBCOST_SECURE_COOKIES", "1")

from app import create_app  # noqa: E402

application = create_app()
