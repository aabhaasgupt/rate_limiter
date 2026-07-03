# Instructions
________________________________

## Phase 1: Docker setup

## 1. Build the Docker image

```bash
docker build -t rate-limiter-api:local .
```

## 2. List Docker images

```bash
docker images
```

## 3. Run the Docker container

```bash
docker run --rm -p 8080:8080 rate-limiter-api:local
```

## 4. Test the app locally

```bash
curl http://127.0.0.1/health
curl http://127.0.0.1/limit
```

________________________________
## Phase 2: K8s and KIND setup

## 5. Create a local Kubernetes cluster
```bash
kind create cluster --name rate-limiter-local
```

## 6. Load your Docker image into kind (we alredy built the docker image in step 2). Simply load that into Kubernetes.
```bash
kind load docker-image rate-limiter-api:local --name rate-limiter-local
```

## 7. Apply the deployment
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

## 8. Delete the single node cluster
```bash
kind delete cluster --name rate-limiter-local
```

## 9. Create a multi-node cluster
```bash
kind create cluster --name rate-limiter-local --config ./k8s/kind-multinode.yaml
```

## 10. Apply the deployment again
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```