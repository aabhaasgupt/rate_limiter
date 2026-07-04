## Kubernetes Architecture

- Kubernetes is an orchestrator, not a container runtime.
- kubelet communicates with a container runtime through the CRI.
- containerd is responsible for pulling images and starting containers.
- Pods are Kubernetes abstractions; containerd only understands containers.

_________________

## Container Runtime (containerd)
### What problem does it solve?

Kubernetes does not know how to run Linux containers. It delegates that responsibility to a container runtime.

### Mental model
```bash
kubectl
    │
API Server
    │
kubelet
    │
CRI
    │
containerd
    │
runc
    │
Linux Kernel
```

### Key takeaways

Kubernetes orchestrates containers but does not create them.
containerd is responsible for pulling images, creating containers, and managing their lifecycle.
The kubelet communicates with containerd through the Container Runtime Interface (CRI).
The same OCI image can be run by different runtimes (containerd, CRI-O, Docker Engine, etc.).
```bash
Commands used
sudo apt-get install -y containerd
containerd config default
sudo systemctl status containerd
```
_______________

## How does `kubeadm init` bootstrap a cluster?

```bash
sudo kubeadm init
```

### What problem does it solve?

Creates the initial Kubernetes control plane on a machine.

### Mental model

```text
kubeadm
    ↓
Generates certificates
Generates configs
Writes static Pod manifests
    ↓
kubelet notices manifests
    ↓
containerd starts
    - API Server
    - Scheduler
    - Controller Manager
    - etcd
```

### Key takeaways

- `kubeadm` does not keep running after initialization.
- The control plane components are Static Pods.
- kubelet watches `/etc/kubernetes/manifests`.
- containerd actually starts the control plane containers.


_______________


