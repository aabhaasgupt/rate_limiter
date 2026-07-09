export const clusterConfig = {
    clusterName: "rate-limiter",
  
    workerCount: 1,
  
    controlPlaneInstanceType: "t3.medium",
    workerInstanceType: "t3.small",
  
    nodeDiskSizeGb: 20,
  
    sshAllowedIp: "24.5.184.50/32",

    allowGithubWebhook: true,
    kubeadmJoinCommandParameterName: "/rate-limiter/k8s/join-command",
    kubeconfigParameterName: "/rate-limiter/k8s/kubeconfig",
    bootstrapBucketName: "rate-limiter-bootstrap-aabhaasg",
  };