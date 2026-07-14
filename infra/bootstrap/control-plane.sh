#!/usr/bin/env bash
set -euxo pipefail

JOIN_PARAMETER_NAME="${JOIN_PARAMETER_NAME}"
BOOTSTRAP_BUCKET="${BOOTSTRAP_BUCKET}"

bash /opt/rate-limiter/bootstrap/common.sh

kubeadm init --pod-network-cidr=10.244.0.0/16

export KUBECONFIG=/etc/kubernetes/admin.conf

# Configure kubectl for root
mkdir -p /root/.kube
cp /etc/kubernetes/admin.conf /root/.kube/config
chmod 700 /root/.kube
chmod 600 /root/.kube/config

# Configure kubectl for ubuntu, if present
if id ubuntu >/dev/null 2>&1; then
  mkdir -p /home/ubuntu/.kube
  cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config
  chown -R ubuntu:ubuntu /home/ubuntu/.kube
  chmod 700 /home/ubuntu/.kube
  chmod 600 /home/ubuntu/.kube/config
fi

# Create ssm-user now so kubeconfig ownership is deterministic
if ! id ssm-user >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash ssm-user
fi

mkdir -p /home/ssm-user/.kube
cp /etc/kubernetes/admin.conf /home/ssm-user/.kube/config
chown -R ssm-user:ssm-user /home/ssm-user
chmod 700 /home/ssm-user/.kube
chmod 600 /home/ssm-user/.kube/config

# Upload kubeconfig for Jenkins
aws s3 cp \
  /etc/kubernetes/admin.conf \
  "s3://${BOOTSTRAP_BUCKET}/kubeconfig/admin.conf"

# Install cluster networking
bash /opt/rate-limiter/bootstrap/addons/flannel.sh

# Publish worker join command
kubeadm token create --print-join-command > /tmp/kubeadm-join-command

aws ssm delete-parameter \
  --name "${JOIN_PARAMETER_NAME}" || true

aws ssm put-parameter \
  --name "${JOIN_PARAMETER_NAME}" \
  --type "String" \
  --value "$(cat /tmp/kubeadm-join-command)" \
  --overwrite

# Install remaining add-ons
bash /opt/rate-limiter/bootstrap/addons/helm.sh
bash /opt/rate-limiter/bootstrap/addons/aws-load-balancer-controller.sh

echo "===== Bootstrap control-plane.sh completed successfully ====="