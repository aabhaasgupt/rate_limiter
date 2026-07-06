import * as ec2 from "aws-cdk-lib/aws-ec2";

export function createK8sNodeUserData(): ec2.UserData {
  const userData = ec2.UserData.forLinux();

  userData.addCommands(
    "set -eux",

    // Disable swap
    "swapoff -a",
    "sed -i '/ swap / s/^/#/' /etc/fstab",

    // Kernel modules
    "cat <<EOF > /etc/modules-load.d/k8s.conf\noverlay\nbr_netfilter\nEOF",
    "modprobe overlay",
    "modprobe br_netfilter",

    // Sysctl settings
    "cat <<EOF > /etc/sysctl.d/k8s.conf\nnet.bridge.bridge-nf-call-iptables = 1\nnet.bridge.bridge-nf-call-ip6tables = 1\nnet.ipv4.ip_forward = 1\nEOF",
    "sysctl --system",

    // Base packages
    "apt-get update",
    "apt-get install -y apt-transport-https ca-certificates curl gpg conntrack",

    // containerd
    "apt-get install -y containerd",
    "mkdir -p /etc/containerd",
    "containerd config default > /etc/containerd/config.toml",
    "sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml",
    "systemctl restart containerd",
    "systemctl enable containerd",

    // Kubernetes apt repo
    "mkdir -p /etc/apt/keyrings",
    "curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg",
    "echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' > /etc/apt/sources.list.d/kubernetes.list",

    // Kubernetes packages
    "apt-get update",
    "apt-get install -y kubelet kubeadm kubectl",
    "apt-mark hold kubelet kubeadm kubectl"
  );

  return userData;
}