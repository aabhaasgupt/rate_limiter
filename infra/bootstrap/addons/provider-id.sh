cat > infra/bootstrap/addons/provider-id.sh <<'EOF'
#!/usr/bin/env bash
set -euxo pipefail

export KUBECONFIG=/etc/kubernetes/kubelet.conf

INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
AZ=$(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone)
PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)

PROVIDER_ID="aws:///${AZ}/${INSTANCE_ID}"

NODE_NAME=$(kubectl get nodes -o wide --no-headers | awk -v ip="${PRIVATE_IP}" '$6 == ip {print $1}')

if [[ -z "${NODE_NAME}" ]]; then
  echo "Could not find Kubernetes node for private IP ${PRIVATE_IP}"
  exit 1
fi

kubectl patch node "${NODE_NAME}" \
  -p "{\"spec\":{\"providerID\":\"${PROVIDER_ID}\"}}"

echo "Patched ${NODE_NAME} with providerID ${PROVIDER_ID}"
EOF

chmod +x infra/bootstrap/addons/provider-id.sh