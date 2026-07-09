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

until bash /tmp/kubeadm-join-command; do
  echo "kubeadm join failed; retrying in 20 seconds..."
  sleep 20

  aws ssm get-parameter \
    --name "${JOIN_PARAMETER_NAME}" \
    --query "Parameter.Value" \
    --output text > /tmp/kubeadm-join-command
done

cat /tmp/kubeadm-join-command

bash /opt/rate-limiter/bootstrap/addons/provider-id.sh

echo "===== Bootstrap worker.sh completed successfully ====="