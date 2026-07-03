from flask import Flask;

app = Flask(__name__)


@app.get("/limit")
def get_limit():
    return {"decision": "allow"}

@app.get("/health")
def get_health():
    return {"status": "healthy"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
