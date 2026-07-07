#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG_PATH:-/var/lib/jenkins/.kube/config}"
KUBECTL="kubectl --kubeconfig=${KUBECONFIG_PATH}"

echo "Using kubeconfig: ${KUBECONFIG_PATH}"
echo

NODE_NAMES=$(${KUBECTL} get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')

for NODE_NAME in ${NODE_NAMES}; do
  echo "Patching providerID for ${NODE_NAME}..."

  INSTANCE_INFO=$(aws ec2 describe-instances \
    --filters \
      "Name=tag:Name,Values=${NODE_NAME}" \
      "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].[InstanceId,Placement.AvailabilityZone]" \
    --output text)

  if [[ -z "${INSTANCE_INFO}" ]]; then
    echo "No running EC2 instance found with Name tag '${NODE_NAME}'"
    exit 1
  fi

  INSTANCE_ID=$(echo "${INSTANCE_INFO}" | awk '{print $1}')
  AZ=$(echo "${INSTANCE_INFO}" | awk '{print $2}')

  PROVIDER_ID="aws:///${AZ}/${INSTANCE_ID}"

  echo "  InstanceId:  ${INSTANCE_ID}"
  echo "  AZ:          ${AZ}"
  echo "  ProviderID:  ${PROVIDER_ID}"

  ${KUBECTL} patch node "${NODE_NAME}" \
    -p "{\"spec\":{\"providerID\":\"${PROVIDER_ID}\"}}"

  echo
done

echo "Final providerIDs:"
${KUBECTL} get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" => "}{.spec.providerID}{"\n"}{end}'