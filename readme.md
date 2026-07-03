# Instructions

## Build the Docker image

```bash
docker build -t rate-limiter-api:local .
```

## List Docker images

```bash
docker images
```

## Run the Docker container

```bash
docker run --rm -p 8080:8080 rate-limiter-api:local
```

## Test the app locally

```bash
curl http://127.0.0.1/health
curl http://127.0.0.1/limit
```
