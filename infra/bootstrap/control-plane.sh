#!/usr/bin/env bash
set -euxo pipefail

JOIN_PARAMETER_NAME="${JOIN_PARAMETER_NAME}"

bash /opt/rate-limiter/bootstrap/common.sh

kubeadm init --pod-network-cidr=10.244.0.0/16

mkdir -p /root/.kube
cp /etc/kubernetes/admin.conf /root/.kube/config
# Configure kubectl for common login users too
for USER_HOME in /home/ubuntu /home/ssm-user; do
  if [ -d "$USER_HOME" ]; then
    mkdir -p "$USER_HOME/.kube"
    cp /etc/kubernetes/admin.conf "$USER_HOME/.kube/config"
    chown -R "$(basename "$USER_HOME"):$(basename "$USER_HOME")" "$USER_HOME/.kube" || true
  fi
done

export KUBECONFIG=/etc/kubernetes/admin.conf

aws ssm put-parameter \
  --name "/rate-limiter/k8s/kubeconfig" \
  --type "SecureString" \
  --value "$(cat /etc/kubernetes/admin.conf)" \
  --overwrite

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

echo "===== Bootstrap control-plane.sh completed successfully ====="