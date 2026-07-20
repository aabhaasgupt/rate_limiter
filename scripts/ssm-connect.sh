#!/usr/bin/env bash

###############################################################################
# ssm-connect.sh
#
# Connects to a running EC2 instance through AWS Systems Manager Session
# Manager using the instance's Name tag.
#
# When multiple running instances share the same Name tag, such as nodes in an
# Auto Scaling Group, the script displays the matching instances and asks the
# user to choose one.
#
# Usage
# -----
#
#   ./scripts/ssm-connect.sh k8s-control-plane
#   ./scripts/ssm-connect.sh k8s-worker
#   ./scripts/ssm-connect.sh k8s-redis-worker
#
###############################################################################

set -euo pipefail

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: $0 <instance-name>"
    exit 1
fi

# Return one record per line:
#
# instance-id<TAB>private-ip<TAB>availability-zone
#
# Sorting by private IP makes the menu stable and easier to compare with
# `kubectl get nodes -o wide`.
INSTANCES=()

while IFS= read -r instance; do
    [[ -n "$instance" ]] && INSTANCES+=("$instance")
done < <(
    aws ec2 describe-instances \
        --filters \
            "Name=tag:Name,Values=${NAME}" \
            "Name=instance-state-name,Values=running" \
        --query \
            "Reservations[].Instances[].[InstanceId,PrivateIpAddress,Placement.AvailabilityZone]" \
        --output text |
    sort -k2
)

if [[ ${#INSTANCES[@]} -eq 0 ]]; then
    echo "No running instance found with Name tag '${NAME}'"
    exit 1
fi

if [[ ${#INSTANCES[@]} -eq 1 ]]; then
    SELECTED_INSTANCE="${INSTANCES[0]}"
else
    echo "Multiple running instances found with Name tag '${NAME}':"
    echo

    for index in "${!INSTANCES[@]}"; do
        IFS=$'\t' read -r instance_id private_ip availability_zone \
            <<< "${INSTANCES[$index]}"

        printf "  %d) %-20s  private-ip=%-15s  az=%s\n" \
            "$((index + 1))" \
            "$instance_id" \
            "$private_ip" \
            "$availability_zone"
    done

    echo

    while true; do
        read -r -p "Choose an instance [1-${#INSTANCES[@]}]: " selection

        if [[ "$selection" =~ ^[0-9]+$ ]] &&
           (( selection >= 1 && selection <= ${#INSTANCES[@]} )); then
            SELECTED_INSTANCE="${INSTANCES[$((selection - 1))]}"
            break
        fi

        echo "Invalid selection. Enter a number between 1 and ${#INSTANCES[@]}."
    done
fi

IFS=$'\t' read -r INSTANCE_ID PRIVATE_IP AVAILABILITY_ZONE \
    <<< "$SELECTED_INSTANCE"

echo
echo "Connecting to ${NAME}:"
echo "  Instance ID: ${INSTANCE_ID}"
echo "  Private IP:  ${PRIVATE_IP}"
echo "  AZ:          ${AVAILABILITY_ZONE}"
echo

aws ssm start-session --target "$INSTANCE_ID"