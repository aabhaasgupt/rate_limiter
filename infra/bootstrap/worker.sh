cat > infra/bootstrap/worker.sh <<'EOF'
#!/usr/bin/env bash
set -euxo pipefail

JOIN_PARAMETER_NAME="${JOIN_PARAMETER_NAME}"

bash /opt/rate-limiter/bootstrap/common.sh

until aws ssm get-parameter \
  --name "${JOIN_PARAMETER_NAME}" \
  --query "Parameter.Value" \
  --output text > /tmp/kubeadm-join-command; do
  sleep 10
done

bash /tmp/kubeadm-join-command
bash /opt/rate-limiter/bootstrap/addons/provider-id.sh

echo "===== Bootstrap worker.sh completed successfully ====="
EOF