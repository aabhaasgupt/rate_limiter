cat > infra/bootstrap/control-plane.sh <<'EOF'
#!/usr/bin/env bash
set -euxo pipefail

JOIN_PARAMETER_NAME="${JOIN_PARAMETER_NAME}"

bash /opt/rate-limiter/bootstrap/common.sh

kubeadm init --pod-network-cidr=10.244.0.0/16

mkdir -p /root/.kube
cp /etc/kubernetes/admin.conf /root/.kube/config

export KUBECONFIG=/etc/kubernetes/admin.conf

bash /opt/rate-limiter/bootstrap/addons/flannel.sh
bash /opt/rate-limiter/bootstrap/addons/helm.sh
bash /opt/rate-limiter/bootstrap/addons/aws-load-balancer-controller.sh

kubeadm token create --print-join-command > /tmp/kubeadm-join-command

aws ssm put-parameter \
  --name "${JOIN_PARAMETER_NAME}" \
  --type "String" \
  --value "$(cat /tmp/kubeadm-join-command)" \
  --overwrite

echo "===== Bootstrap control-plane.sh completed successfully ====="
EOF