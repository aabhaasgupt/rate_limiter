#!/usr/bin/env bash
set -euxo pipefail

export KUBECONFIG=/etc/kubernetes/admin.conf

kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml

kubectl rollout status daemonset/kube-flannel-ds -n kube-flannel --timeout=180s