## What is a Container?

### What problem does it solve?

A container provides an isolated execution environment for one or more Linux processes without requiring a full virtual machine.

### Mental model

```
container
    =
namespaces
+ cgroups
+ isolated filesystem
+ one or more Linux processes
```

---

### Example

Suppose you run:

```bash
python app.py
```

Without a container:

```
Host

PID 1      systemd
PID 42     sshd
PID 300    containerd
PID 1001   python app.py
```

The Flask process can see all host processes.

Now run the same application inside a container:

```bash
docker run flask-app
```

Inside the container:

```
PID 1
python app.py
```

The Flask application believes it is the only process running.

On the host, however, it is still just another Linux process:

```
Host

PID 24873
python app.py
```

The container is simply giving the process a different view of the operating system.

---

### Key takeaways

- A container is **not** a virtual machine.
- The application inside a container is still a normal Linux process.
- Namespaces determine **what the process can see**.
- Cgroups determine **how many resources the process can use**.
- `runc` creates the isolated environment before starting the process.



_____________________________
## Instructinos

### 1. To deploy a docker image
```bash
docker build -t <dockerhub-username>/rate-limiter-api:v1 ./app
# docker build -t aabhaasgupt/rate-limiter-api:v1 ./app
```

### 2. To push a docker image
```bash
docker push <dockerhub-username>/rate-limiter-api:v1
# docker push aabhaasgupt/rate-limiter-api:v1
```

### For the linux platform we need to build and push like this
```bash
docker buildx build \
  --platform linux/amd64 \
  -t aabhaasgupt/rate-limiter-api:v1 \
  ./app \
  --push
```