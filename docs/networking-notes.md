
## "How does a Pod get an IP?"

```text
Deployment created
      │
Scheduler picks Worker 1
      │
kubelet notices assignment
      │
containerd creates Pod sandbox
      │
container runtime invokes CNI
      │
IPAM assigns 10.244.1.2
      │
Flannel configures networking
      │
kubelet updates Pod Status
      │
EndpointSlice controller watches Pod
      │
EndpointSlice updated
      │
kube-proxy watches EndpointSlice
      │
Linux iptables/IPVS rules updated
```

Every component is watching the API Server instead of talking directly to another component.

_________________________________

## Kubernetes Service Networking and Testing

### What problem does it solve?

Kubernetes Pods are ephemeral—they can be created, deleted, or moved between nodes, causing their IP addresses to change. A **Service** provides a stable network endpoint that routes traffic to the appropriate Pods.

---

### Mental Model

#### Traffic from outside the cluster

```text
Laptop / Browser
        │
        ▼
Worker Public IP:NodePort
        │
        ▼
kube-proxy (Linux networking rules)
        │
        ▼
Kubernetes Service
        │
        ▼
Pod IP:containerPort
        │
        ▼
Flask Application
```

#### Traffic from inside the cluster

```text
Pod / Node
      │
      ▼
ClusterIP (or Service DNS)
      │
      ▼
Kubernetes Service
      │
      ▼
Pod IP:containerPort
      │
      ▼
Flask Application
```

---

### Ports in our setup

| Component | Port | Purpose |
|-----------|------|---------|
| Flask Application | `8080` | Port the application listens on inside the container |
| `containerPort` | `8080` | Metadata indicating the application's listening port |
| Service `targetPort` | `8080` | Port on the Pod that receives traffic |
| Service `port` | `80` | Stable port exposed by the Service inside the cluster |
| NodePort | `30080` | Port exposed on every Kubernetes node for external access |

---

### How a request flows

A request from your laptop follows this path:

```text
Browser
    │
    ▼
Worker Public IP:30080
    │
    ▼
Linux Kernel
    │
    ▼
iptables/IPVS rules (programmed by kube-proxy)
    │
    ▼
Kubernetes Service
    │
    ▼
One of the matching Pods
    │
    ▼
Flask (/health or /limit)
```

Notice that **kube-proxy is not in the data path**. It only programs the Linux networking rules.

---

### Key Takeaways

- Every Pod has a unique IP within the cluster.
- Pod IPs are ephemeral and should never be used directly by applications.
- A Service provides a stable virtual IP (ClusterIP).
- `ClusterIP` is only reachable from inside the cluster.
- `NodePort` exposes the Service on every Kubernetes node.
- kube-proxy watches the API Server and configures Linux networking (iptables/IPVS); it does **not** forward packets itself.
- The Linux kernel performs the actual packet forwarding.

---

## Testing the Application

### 1. Verify Pods

```bash
kubectl get pods -o wide
```

---

### 2. Verify the Service

```bash
kubectl get svc
```

---

### 3. Verify EndpointSlices

```bash
kubectl get endpointslices
```

This shows which Pod IPs back the Service.

---

### 4. Test a Pod directly (inside the cluster)

```bash
curl http://<pod-ip>:8080/health
curl http://<pod-ip>:8080/limit
```

Example:

```bash
curl http://10.244.1.2:8080/health
```

---

### 5. Test the Service (inside the cluster)

Using the ClusterIP:

```bash
curl http://<cluster-ip>/health
```

or using the Service DNS:

```bash
curl http://rate-limiter-api-service/health
```

---

### 6. Test the NodePort (from any Kubernetes node)

```bash
curl http://127.0.0.1:30080/health
```

or

```bash
curl http://<worker-private-ip>:30080/health
```

---

### 7. Test from your laptop

```bash
curl http://<worker-public-ip>:30080/health
curl http://<worker-public-ip>:30080/limit
```

Example:

```bash
curl http://98.92.190.172:30080/health
```

---

## Why can't I access the ClusterIP from my laptop?

The ClusterIP is a **virtual IP** that exists only inside the Kubernetes cluster.

```text
Laptop
    │
    ▼
Internet
    │
    ✗
10.96.x.x (ClusterIP)
```

Your laptop has no route to the Kubernetes Service network (`10.96.0.0/16` by default), so packets to a ClusterIP are dropped before they ever reach your cluster.

To access an application from outside the cluster, you need one of:

- **NodePort**
- **LoadBalancer**
- **Ingress** (typically backed by a cloud load balancer)

---

## Summary

| Method | Reachable From | Typical Usage |
|---------|----------------|---------------|
| Pod IP | Inside the cluster | Debugging only |
| ClusterIP | Inside the cluster | Service-to-service communication |
| Service DNS | Inside the cluster | Preferred method for applications |
| NodePort | Outside the cluster | Development and learning |
| LoadBalancer / Ingress | Outside the cluster | Production environments |