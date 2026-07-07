#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-rate-limiter}"
REGION="${REGION:-us-east-1}"

VPC_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=k8s-control-plane" \
  --query "Reservations[].Instances[].VpcId" \
  --output text)

if ! command -v helm >/dev/null 2>&1; then
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

helm repo add eks https://aws.github.io/eks-charts || true
helm repo update

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --create-namespace \
  --set clusterName="${CLUSTER_NAME}" \
  --set region="${REGION}" \
  --set vpcId="${VPC_ID}" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller

kubectl rollout status deployment/aws-load-balancer-controller -n kube-system