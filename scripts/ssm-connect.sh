#!/usr/bin/env bash

###############################################################################
# ssm-connect.sh
#
# Connects to an EC2 instance using AWS Systems Manager (SSM) based on the
# instance's Name tag.
#
# Why?
# ----
# We intentionally avoid using EC2 Instance IDs directly because they are
# ephemeral and difficult to remember. Instead, every instance is tagged with
# a stable Name (e.g. "k8s-control-plane"), and this script performs the lookup.
#
# Prerequisites
# -------------
# - AWS CLI installed and configured
# - Permission to:
#     - ec2:DescribeInstances
#     - ssm:StartSession
# - EC2 instance must:
#     - be running
#     - have the AmazonSSMManagedInstanceCore IAM policy attached
#     - have the SSM Agent installed and running
#
# Usage
# -----
#
#   ./scripts/ssm-connect.sh k8s-control-plane
#
#   ./scripts/ssm-connect.sh k8s-worker-1
#
#   ./scripts/ssm-connect.sh k8s-worker-2
#
###############################################################################

set -euo pipefail

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: ./scripts/ssm-connect.sh <instance-name>"
    exit 1
fi

INSTANCE_ID=$(aws ec2 describe-instances \
    --filters \
        "Name=tag:Name,Values=${NAME}" \
        "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].InstanceId" \
    --output text)

if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
    echo "No running instance found with Name tag '${NAME}'"
    exit 1
fi

echo "Connecting to ${NAME} (${INSTANCE_ID})..."

aws ssm start-session --target "$INSTANCE_ID"