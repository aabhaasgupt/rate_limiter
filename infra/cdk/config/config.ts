export const clusterConfig = {
    clusterName: "rate-limiter",
  
    workerCount: 1,
  
    controlPlaneInstanceType: "t3.small",
    workerInstanceType: "t3.micro",
  
    nodeDiskSizeGb: 20,
  
    sshAllowedIp: "24.5.184.50/32",

    allowGithubWebhook: true,
    kubeadmJoinCommandParameterName: "/rate-limiter/k8s/join-command",
    kubeconfigParameterName: "/rate-limiter/k8s/kubeconfig",
    bootstrapBucketName: "rate-limiter-bootstrap-aabhaasg",

    minCapacity: 1,
    desiredCapacity: 1,
    maxCapacity: 3,
  };

  export const jenkinsConfig = {
    jenkinsWorkerInstanceType: "t3.micro",
  }

  export const redisConfig = {
    redisWorkerInstanceType: "t3.micro",

    redisMinCapacity: 3,
    redisDesiredCapacity: 3,
    redisMaxCapacity: 3,
  }