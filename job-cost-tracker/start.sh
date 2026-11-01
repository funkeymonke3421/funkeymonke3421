#!/usr/bin/env sh
# Mac / Linux launcher.
cd "$(dirname "$0")" || exit 1
python3 -m pip install --disable-pip-version-check -q -r requirements.txt || exit 1
exec python3 app.py --open
