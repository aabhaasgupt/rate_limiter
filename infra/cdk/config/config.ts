export const clusterConfig = {
    clusterName: "rate-limiter",
  
    workerCount: 2,
  
    controlPlaneInstanceType: "t3.medium",
    workerInstanceType: "t3.small",
  
    nodeDiskSizeGb: 20,
  
    sshAllowedIp: "24.5.184.50/32",

    allowGithubWebhook: true,
  };