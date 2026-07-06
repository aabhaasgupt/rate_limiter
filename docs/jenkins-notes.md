## Jenkins CI/CD Notes

### What problem does Jenkins solve?

Jenkins automates repetitive build and deployment steps.

Instead of manually doing:

```text
git pull
docker build
docker push
kubectl apply
```

Jenkins can run those steps automatically when code changes.

---

### Mental model

```text
GitHub
  ↓ webhook
Jenkins
  ↓
Checkout repo
  ↓
Build Docker image
  ↓
Push image to Docker Hub
  ↓
Update Kubernetes deployment
```

---

### Key takeaways

- Jenkins is a **job runner/orchestrator**.
- A `Jenkinsfile` keeps the pipeline in Git instead of hidden in the Jenkins UI.
- Jenkins needs Docker to build images.
- Jenkins needs Docker Hub credentials to push images.
- Jenkins needs `kubectl` + kubeconfig to deploy to Kubernetes.
- Jenkins is just another Kubernetes client.
- For now we used `admin.conf`; later we should replace it with a limited ServiceAccount/RBAC setup.

---

### GitHub webhook flow

```text
git push
  ↓
GitHub webhook
  ↓
http://<jenkins-public-ip>:8080/github-webhook/
  ↓
Jenkins pipeline starts
```

Both sides are required:

- GitHub must know **where to send** the event.
- Jenkins must know **which job should handle** the event.

---

### Current pipeline flow

```text
Developer pushes code
  ↓
GitHub triggers Jenkins
  ↓
Jenkins reads Jenkinsfile
  ↓
Builds linux/amd64 Docker image
  ↓
Pushes image to Docker Hub
  ↓
Runs kubectl set image
  ↓
Kubernetes performs rolling update
```

---

### Docker image tagging

We use Jenkins build numbers:

```text
aabhaasgupt/rate-limiter-api:v<BUILD_NUMBER>
```

Example:

```text
aabhaasgupt/rate-limiter-api:v12
```

Later we may also tag with Git SHA for better traceability:

```text
aabhaasgupt/rate-limiter-api:<git-sha>
```

---

### Important commands

Test Jenkins can access Kubernetes:

```bash
sudo -u jenkins kubectl get nodes
```

Update Kubernetes deployment image manually:

```bash
kubectl set image deployment/rate-limiter-api \
  rate-limiter-api=aabhaasgupt/rate-limiter-api:v<BUILD_NUMBER>
```

Watch rollout:

```bash
kubectl rollout status deployment/rate-limiter-api
```

---

### Security notes

Current shortcuts:

- Jenkins uses copied Kubernetes `admin.conf`.
- Jenkins UI is exposed on port `8080`.
- GitHub webhook required opening Jenkins to external traffic.

Good enough for learning, but not production.

Later cleanup:

- Replace `admin.conf` with Kubernetes ServiceAccount + Role + RoleBinding.
- Move Docker/kubectl installation into CDK User Data.
- Add Jenkins → Kubernetes API security group rule in CDK.
- Avoid manual AWS Console changes.
- Restrict Jenkins exposure instead of leaving `8080` open broadly.

---

### CDK TODOs

```text
- Install Docker on Jenkins EC2 through User Data.
- Install kubectl on Jenkins EC2 through User Data.
- Add JenkinsSecurityGroup → K8sNodeSecurityGroup TCP 6443 rule.
- Consider persistent Jenkins home volume.
- Consider reverse proxy / ALB in front of Jenkins later.
```