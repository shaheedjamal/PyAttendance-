import os
from backend import create_app

app = create_app()

if __name__ == "__main__":
    os.makedirs("instance", exist_ok=True)
    os.makedirs("reports", exist_ok=True)
    app.run(host="127.0.0.1", port=5000, debug=os.environ.get("FLASK_DEBUG", "1") == "1")
