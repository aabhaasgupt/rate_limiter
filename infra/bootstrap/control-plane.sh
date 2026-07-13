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

# Configure kubectl for common login users
for USER_HOME in /home/ubuntu /home/ssm-user; do
  USER_NAME="$(basename "$USER_HOME")"

  mkdir -p "$USER_HOME/.kube"
  cp /etc/kubernetes/admin.conf "$USER_HOME/.kube/config"

  chown -R "$USER_NAME:$USER_NAME" "$USER_HOME/.kube" || true
  chmod 700 "$USER_HOME/.kube"
  chmod 600 "$USER_HOME/.kube/config"
done

# Upload kubeconfig for Jenkins
aws s3 cp \
  /etc/kubernetes/admin.conf \
  "s3://${BOOTSTRAP_BUCKET}/kubeconfig/admin.conf"

bash /opt/rate-limiter/bootstrap/addons/flannel.sh

kubeadm token create --print-join-command > /tmp/kubeadm-join-command

aws ssm delete-parameter \
  --name "${JOIN_PARAMETER_NAME}" || true

aws ssm put-parameter \
  --name "${JOIN_PARAMETER_NAME}" \
  --type "String" \
  --value "$(cat /tmp/kubeadm-join-command)" \
  --overwrite

bash /opt/rate-limiter/bootstrap/addons/helm.sh
bash /opt/rate-limiter/bootstrap/addons/aws-load-balancer-controller.sh

echo 'export KUBECONFIG=$HOME/.kube/config' >> /home/ssm-user/.bashrc
echo 'export KUBECONFIG=$HOME/.kube/config' >> /home/ubuntu/.bashrc

echo "===== Bootstrap control-plane.sh completed successfully ====="