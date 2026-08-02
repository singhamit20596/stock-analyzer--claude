import uvicorn
from main import app

if __name__ == "__main__":
    print("Starting Uvicorn Server on http://127.0.0.1:8080...", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8080)
