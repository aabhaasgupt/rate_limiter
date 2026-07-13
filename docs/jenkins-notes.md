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

__________________

# Automation done

# Bootstrap Automation

## Problem Solved

Previously, provisioning the infrastructure required multiple manual steps after every deployment:

- Initialize the Kubernetes control plane.
- Join worker nodes.
- Configure `kubectl` on Jenkins.
- Install Jenkins plugins.
- Unlock Jenkins and complete the setup wizard.
- Create the admin user.
- Configure DockerHub credentials.
- Create the pipeline job.

All of these steps are now fully automated using **CDK**, **EC2 UserData**, **Jenkins init.groovy**, **S3**, and **SSM Parameter Store**.

---

# Architecture

```text
                    CDK Deploy
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ▼                                 ▼
 Control Plane EC2                  Jenkins EC2
        │                                 │
        │ kubeadm init                    │ Install Jenkins
        │                                 │ Install Plugins
        │ Install Flannel                 │ Install Docker
        │ Install ALB Controller          │ Install kubectl
        │                                 │ Install AWS CLI
        │                                 │
        │ Upload admin.conf ─────────────►│ Download admin.conf
        │            (S3)                 │
        │                                 │
        │                                 │ init.groovy
        │                                 │   ├── Disable setup wizard
        │                                 │   ├── Create admin user
        │                                 │   ├── Create DockerHub credential
        │                                 │   └── Create pipeline job
        ▼                                 ▼
     Ready Cluster                  Ready Jenkins
```

---

# Bootstrap Responsibilities

## Control Plane

Responsible for:

- Installing containerd
- Installing Kubernetes components
- Running `kubeadm init`
- Configuring kubectl
- Installing Flannel
- Installing Helm
- Installing AWS Load Balancer Controller
- Generating worker join command
- Uploading `admin.conf` to S3
- Publishing join command to SSM Parameter Store

---

## Worker

Responsible for:

- Installing containerd
- Installing Kubernetes components
- Reading join command from SSM
- Joining the cluster automatically

---

## Jenkins

Responsible for:

- Installing Java
- Installing Docker
- Installing Git
- Installing kubectl
- Installing AWS CLI
- Installing required Jenkins plugins
- Downloading kubeconfig from S3
- Disabling the Jenkins setup wizard
- Creating the admin user
- Creating DockerHub credentials
- Creating the pipeline job

---

# Design Decisions

## 1. S3 instead of SSM for kubeconfig

### Initial Design

Store `admin.conf` in Parameter Store.

### Problem

Parameter Store Standard tier supports only **4096 bytes**.

Our kubeconfig is approximately **5.6 KB**.

Cloud-init failed with:

```
ValidationException:
Standard tier parameters support a maximum parameter value of 4096 characters
```

### Solution

Store kubeconfig in S3.

Control Plane:

```
admin.conf
      │
      ▼
   S3 Bucket
```

Jenkins:

```
S3
 │
 ▼
downloads admin.conf
 │
 ▼
/var/lib/jenkins/.kube/config
```

Advantages:

- No size limitation
- Easy bootstrap
- Cheap
- Simple

---

## 2. Plugins must exist before Jenkins starts

`init.groovy` depends on Jenkins plugins.

Incorrect order:

```
Start Jenkins
        │
        ▼
Run init.groovy
        │
        ▼
Plugin classes missing
        │
        ▼
Groovy fails
```

Correct order:

```
Install Jenkins
        │
        ▼
Install Plugins
        │
        ▼
Copy init.groovy
        │
        ▼
Start Jenkins
        │
        ▼
Restart Jenkins
        │
        ▼
Groovy executes
```

---

## 3. Disable Setup Wizard

Instead of manually:

- Unlock Jenkins
- Install plugins
- Create admin user

we configure:

```bash
JAVA_OPTS=-Djenkins.install.runSetupWizard=false
```

This allows Jenkins to boot directly into the login page.

---

## 4. Jenkins Configuration via init.groovy

Instead of configuring Jenkins manually through the UI, we configure it on startup.

Current responsibilities:

- Create admin user
- Configure authorization
- Create DockerHub credentials
- Create pipeline job

Benefits:

- Infrastructure as Code
- Reproducible
- No manual configuration

---

## 5. Jenkins Authentication

Current setup:

```
username: admin
password: admin
```

Reason:

- Learning project
- Jenkins Security Group allows access only from my IP
- Easy to destroy and recreate

Future improvement:

- Store password in SSM
- Generate password automatically
- Rotate credentials

---

# Bootstrap Flow

```text
CDK Deploy
     │
     ▼
Launch EC2
     │
     ▼
Cloud-init
     │
     ├───────────────┐
     ▼               ▼
Control Plane      Jenkins
     │               │
     ▼               ▼
Uploads kubeconfig  Downloads kubeconfig
     │               │
     ▼               ▼
Stores Join Cmd     Installs Plugins
     │               │
     ▼               ▼
Worker Joins     init.groovy executes
                     │
                     ▼
            Ready Jenkins
```

---

# Automation Achieved

## Kubernetes

✅ Control plane bootstraps automatically

✅ Worker joins automatically

✅ Flannel installs automatically

✅ Helm installs automatically

✅ AWS Load Balancer Controller installs automatically

---

## Jenkins

✅ Java installed

✅ Docker installed

✅ Git installed

✅ kubectl installed

✅ AWS CLI installed

✅ Plugins installed automatically

✅ Setup wizard disabled

✅ Admin user created automatically

✅ DockerHub credentials created automatically

✅ kubeconfig downloaded automatically

✅ Kubernetes access configured automatically

✅ Pipeline job created automatically

---

# Key Learnings

- Cloud-init execution order matters.
- Jenkins plugins must be installed before startup.
- `init.groovy` runs after plugins load.
- S3 is better than SSM for larger bootstrap artifacts.
- Jenkins should be treated as immutable infrastructure.
- EC2 UserData is sufficient to bootstrap an entire Jenkins server.
- `init.groovy` is the preferred way to configure Jenkins during first boot.

---

# Useful Commands

## Cluster

```bash
kubectl get nodes

kubectl get pods -A

kubectl get svc

kubectl get ingress

kubectl get targetgroupbindings -A
```

---

## Worker Bootstrap

```bash
sudo journalctl -u cloud-final

sudo tail -f /var/log/bootstrap.log
```

---

## Jenkins

```bash
sudo journalctl -u jenkins

sudo systemctl restart jenkins

sudo -u jenkins \
KUBECONFIG=/var/lib/jenkins/.kube/config \
kubectl get nodes

sudo -u jenkins docker ps
```

---

# Current Status

## Kubernetes

- ✅ Cluster bootstraps automatically
- ✅ Worker joins automatically
- ✅ Networking configured automatically
- ✅ ALB Controller installed automatically

---

## Jenkins

- ✅ Fully bootstrapped automatically
- ✅ No setup wizard
- ✅ Plugins installed automatically
- ✅ Admin user created automatically
- ✅ DockerHub credentials configured automatically
- ✅ Pipeline job created automatically
- ✅ Connected to Kubernetes automatically

---

# Next Milestone

Implement a complete CI/CD pipeline.

```text
Developer
    │
    ▼
GitHub
    │
    ▼
Jenkins Pipeline
    │
    ├── Checkout Source
    ├── Run Tests
    ├── Build Docker Image
    ├── Push to DockerHub
    ├── Update Kubernetes Deployment
    └── Wait for Rollout
             │
             ▼
        Kubernetes
             │
             ▼
        AWS ALB
             │
             ▼
         Live Application
```

This will complete the first end-to-end automated deployment workflow for the Distributed Rate Limiter project.

