# Infrastructure Redeployment Runbook

This document describes how to destroy and recreate the Distributed Rate Limiter infrastructure.

The infrastructure currently includes:

- VPC and networking
- Kubernetes control plane
- Kubernetes worker Auto Scaling Group
- Flannel networking
- AWS Load Balancer Controller
- Jenkins
- Docker
- kubectl
- Jenkins plugins
- Docker Hub credentials
- Jenkins pipeline job
- GitHub webhook integration

---

# Important Behavior

A CDK deployment recreates the infrastructure platform, but it does not automatically deploy the application.

After redeployment:

```text
CDK deploy
    ↓
Kubernetes cluster becomes ready
    ↓
Jenkins becomes ready
    ↓
Run Jenkins pipeline once
    ↓
Deployment, Service, and Ingress are created
    ↓
AWS ALB and target group are created
```

Future GitHub pushes trigger Jenkins automatically through the webhook.

---

# Prerequisites

Before redeploying, confirm:

- AWS CLI is authenticated.
- CDK dependencies are installed.
- CDK has already been bootstrapped for the AWS account and region.
- Docker Hub credentials exist in SSM.
- The configured S3 bootstrap bucket name is available.
- The configured Jenkins Elastic IP is not being used elsewhere.

Check AWS identity:

```bash
aws sts get-caller-identity
```

Check CDK:

```bash
cd infra/cdk
npx cdk --version
```

---

# Required SSM Parameters

The following Docker Hub parameters must already exist:

```text
/rate-limiter/jenkins/dockerhub-username
/rate-limiter/jenkins/dockerhub-token
```

Verify:

```bash
aws ssm get-parameter \
  --name "/rate-limiter/jenkins/dockerhub-username" \
  --with-decryption

aws ssm get-parameter \
  --name "/rate-limiter/jenkins/dockerhub-token" \
  --with-decryption
```

Do not print decrypted secrets in shared terminals or logs.

---

# Destroy Infrastructure

From the CDK directory:

```bash
cd infra/cdk
npm ci
npm run build
npx cdk list
```

Destroy the stacks in dependency-safe order.

Example:

```bash
npx cdk destroy JenkinsStack
npx cdk destroy ClusterStack
npx cdk destroy NetworkStack
```

The exact stack names may differ. Use:

```bash
npx cdk list
```

before destroying.

If the application ALB still exists, wait for the Ingress and AWS Load Balancer Controller resources to be removed before deleting the VPC.

---

# Deploy Infrastructure

Build the CDK project:

```bash
cd infra/cdk
npm ci
npm run build
```

Inspect changes:

```bash
npx cdk diff
```

Deploy stacks in dependency order:

```bash
npx cdk deploy NetworkStack
npx cdk deploy ClusterStack
npx cdk deploy JenkinsStack
```

Alternatively, deploy all stacks when dependencies are correctly defined:

```bash
npx cdk deploy --all
```

Do not run `cdk bootstrap` during every deployment. It is normally required only once per AWS account and region.

---

# Verify Control Plane Bootstrap

Connect to the control-plane EC2 instance through Session Manager.

Check cloud-init:

```bash
sudo cloud-init status --long
```

Expected:

```text
status: done
errors: []
```

Check Kubernetes:

```bash
kubectl get nodes
kubectl get pods -A
```

Expected:

- Control plane is `Ready`
- At least one worker is `Ready`
- Flannel pods are running
- CoreDNS pods are running
- AWS Load Balancer Controller is available

Verify the controller:

```bash
kubectl get deployment \
  -n kube-system \
  aws-load-balancer-controller
```

Expected:

```text
READY 2/2
```

---

# Verify Worker Auto Scaling Group

Find the Auto Scaling Group:

```bash
aws autoscaling describe-auto-scaling-groups \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'K8sWorker')].[AutoScalingGroupName,MinSize,DesiredCapacity,MaxSize]" \
  --output table
```

Expected initial configuration:

```text
Min:      1
Desired:  1
Max:      2
```

Verify the worker joined Kubernetes:

```bash
kubectl get nodes -o wide
```

If a worker does not join, inspect its bootstrap:

```bash
sudo cloud-init status --long
sudo journalctl -u cloud-final -n 150 --no-pager
sudo tail -150 /var/log/bootstrap.log
```

---

# Verify Jenkins

Connect to the Jenkins EC2 instance.

Check cloud-init:

```bash
sudo cloud-init status --long
```

Expected:

```text
status: done
errors: []
```

Check Jenkins:

```bash
sudo systemctl status jenkins --no-pager
```

Check initialization:

```bash
sudo journalctl -u jenkins --no-pager | \
  grep -E "Created Jenkins admin user|Created DockerHub credential|Created Jenkins pipeline job|Jenkins init.groovy completed"
```

Expected messages:

```text
Created Jenkins admin user
Created DockerHub credential: dockerhub-creds
Created Jenkins pipeline job: rate-limiter-pipeline
Jenkins init.groovy completed
```

Verify Docker:

```bash
sudo -u jenkins docker ps
```

Verify Kubernetes access:

```bash
sudo -u jenkins \
  KUBECONFIG=/var/lib/jenkins/.kube/config \
  kubectl get nodes
```

---

# Jenkins Login

Open:

```text
http://<JENKINS_ELASTIC_IP>:8080
```

Current development credentials:

```text
Username: admin
Password: admin
```

This is acceptable only while Jenkins port `8080` is restricted appropriately.

When GitHub webhook access is enabled, port `8080` may be publicly reachable. Jenkins authentication must remain enabled.

---

# Deploy the Application

A fresh CDK deployment does not automatically create the Kubernetes application resources.

Run the Jenkins job once:

```text
Jenkins
→ rate-limiter-pipeline
→ Build Now
```

The pipeline performs:

```text
Checkout repository
→ Build Docker image
→ Push image to Docker Hub
→ Apply Kubernetes manifests
→ Update Deployment image
→ Wait for rollout
→ Wait for ALB hostname
```

---

# Verify Application Deployment

From the control plane:

```bash
kubectl get deployment
kubectl get pods -o wide
kubectl get svc
kubectl get ingress
kubectl get targetgroupbindings -A
```

Expected resources:

```text
Deployment:
rate-limiter-api

Service:
rate-limiter-api-service

Ingress:
rate-limiter-api-ingress
```

Get the ALB hostname:

```bash
ALB_HOSTNAME=$(kubectl get ingress rate-limiter-api-ingress \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

echo "$ALB_HOSTNAME"
```

Test the application:

```bash
curl "http://${ALB_HOSTNAME}/health"
```

---

# Verify GitHub Webhook

In GitHub:

```text
Repository
→ Settings
→ Webhooks
→ Jenkins webhook
→ Recent Deliveries
```

Expected response:

```text
2xx
```

Test with an empty commit:

```bash
git commit --allow-empty -m "Test Jenkins webhook"
git push origin main
```

A new Jenkins build should start automatically.

The webhook URL should be:

```text
http://<JENKINS_ELASTIC_IP>:8080/github-webhook/
```

---

# Test Worker Scale-Out

Find the ASG name:

```bash
ASG_NAME=$(aws autoscaling describe-auto-scaling-groups \
  --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'K8sWorker')].AutoScalingGroupName | [0]" \
  --output text)
```

Scale to two workers:

```bash
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name "$ASG_NAME" \
  --desired-capacity 2
```

Watch nodes:

```bash
kubectl get nodes -w
```

Expected:

```text
1 control plane
2 workers
```

Check pod placement:

```bash
kubectl get pods -o wide
```

---

# Test Worker Scale-In

Scale back to one worker:

```bash
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name "$ASG_NAME" \
  --desired-capacity 1
```

Watch nodes:

```bash
kubectl get nodes -w
```

A terminated worker may remain as `NotReady`.

Remove a confirmed stale node:

```bash
kubectl delete node <terminated-node-name>
```

Graceful draining and automatic node cleanup are future improvements.

---

# Troubleshooting

## kubectl connects to localhost:8080

Error:

```text
The connection to the server localhost:8080 was refused
```

Check kubeconfig:

```bash
echo "$KUBECONFIG"
ls -l ~/.kube/config
```

On the control plane:

```bash
sudo KUBECONFIG=/etc/kubernetes/admin.conf kubectl get nodes
```

---

## kubeconfig permission denied

Check:

```bash
namei -l /home/ssm-user/.kube/config
```

Repair:

```bash
sudo chown -R ssm-user:ssm-user /home/ssm-user/.kube
sudo chmod 700 /home/ssm-user/.kube
sudo chmod 600 /home/ssm-user/.kube/config
```

---

## Control plane is NotReady

Check whether Flannel is installed:

```bash
kubectl get pods -n kube-flannel
```

Inspect bootstrap:

```bash
sudo cloud-init status --long
sudo journalctl -u cloud-final -n 150 --no-pager
sudo tail -150 /var/log/bootstrap.log
```

---

## Worker does not join

Verify join command exists:

```bash
aws ssm get-parameter \
  --name "/rate-limiter/k8s/join-command" \
  --query "Parameter.Value" \
  --output text
```

Inspect worker bootstrap:

```bash
sudo cloud-init status --long
sudo journalctl -u cloud-final -n 150 --no-pager
sudo tail -150 /var/log/bootstrap.log
```

---

## No ALB targets

Confirm application resources exist:

```bash
kubectl get pods
kubectl get svc
kubectl get ingress
kubectl get targetgroupbindings -A
```

After a fresh infrastructure deployment, run the Jenkins pipeline once.

---

# Current Manual Steps After Full Redeployment

After all CDK stacks are recreated:

1. Wait for the control plane and worker to become `Ready`.
2. Confirm AWS Load Balancer Controller is `2/2`.
3. Open Jenkins.
4. Confirm the pipeline job exists.
5. Confirm the GitHub webhook trigger remains configured.
6. Run `rate-limiter-pipeline` once.
7. Confirm the ALB hostname appears.
8. Test `/health`.

Subsequent GitHub pushes should trigger deployments automatically.