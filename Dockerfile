from python:3.12-slim

workdir /app

copy requirements.txt .

RUN pip install -r --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8080

CMD ["python", "app.py"]