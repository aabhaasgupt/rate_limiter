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

# Configure kubectl for ubuntu if the user exists
if id ubuntu >/dev/null 2>&1; then
  mkdir -p /home/ubuntu/.kube
  cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config
  chown -R ubuntu:ubuntu /home/ubuntu/.kube
  chmod 700 /home/ubuntu/.kube
  chmod 600 /home/ubuntu/.kube/config

  echo 'export KUBECONFIG=$HOME/.kube/config' >> /home/ubuntu/.bashrc
  chown ubuntu:ubuntu /home/ubuntu/.bashrc
fi

# Create a helper that configures kubectl for ssm-user
# after the SSM agent creates that user.
cat >/usr/local/bin/configure-ssm-kubectl.sh <<'SSM_KUBECTL_EOF'
#!/usr/bin/env bash
set -euo pipefail

if ! id ssm-user >/dev/null 2>&1; then
  exit 1
fi

mkdir -p /home/ssm-user/.kube
cp /etc/kubernetes/admin.conf /home/ssm-user/.kube/config

chown -R ssm-user:ssm-user /home/ssm-user/.kube
chmod 700 /home/ssm-user/.kube
chmod 600 /home/ssm-user/.kube/config

touch /home/ssm-user/.bashrc

if ! grep -qxF 'export KUBECONFIG=$HOME/.kube/config' /home/ssm-user/.bashrc; then
  echo 'export KUBECONFIG=$HOME/.kube/config' >> /home/ssm-user/.bashrc
fi

chown ssm-user:ssm-user /home/ssm-user/.bashrc

echo "Configured kubectl for ssm-user"
SSM_KUBECTL_EOF

chmod +x /usr/local/bin/configure-ssm-kubectl.sh

# Run after amazon-ssm-agent is available and wait for ssm-user to exist
cat >/etc/systemd/system/configure-ssm-kubectl.service <<'SSM_SERVICE_EOF'
[Unit]
Description=Configure kubectl for ssm-user
After=amazon-ssm-agent.service
Requires=amazon-ssm-agent.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'for i in $(seq 1 60); do /usr/local/bin/configure-ssm-kubectl.sh && exit 0; sleep 5; done; exit 1'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SSM_SERVICE_EOF

systemctl daemon-reload
systemctl enable configure-ssm-kubectl.service
systemctl start configure-ssm-kubectl.service

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

echo "===== Bootstrap control-plane.sh completed successfully ====="