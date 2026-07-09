#!/usr/bin/env bash
set -euxo pipefail

export KUBECONFIG=/etc/kubernetes/admin.conf

CLUSTER_NAME="${CLUSTER_NAME:-rate-limiter}"
REGION="${REGION:-us-east-1}"

VPC_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=k8s-control-plane" \
  --query "Reservations[].Instances[].VpcId" \
  --output text)

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --create-namespace \
  --set clusterName="${CLUSTER_NAME}" \
  --set region="${REGION}" \
  --set vpcId="${VPC_ID}" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller

kubectl rollout status deployment/aws-load-balancer-controller -n kube-system --timeout=300s || true