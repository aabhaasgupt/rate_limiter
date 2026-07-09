import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as fs from "fs";
import * as path from "path";
import { clusterConfig } from "../../config/config";

export function createBootstrapUserData(entryScriptName: string): ec2.UserData {
  const userData = ec2.UserData.forLinux();

  const bootstrapDir = path.join(__dirname, "../../../bootstrap");

  const commonScript = fs.readFileSync(
    path.join(bootstrapDir, "common.sh"),
    "utf8"
  );

  const helmScript = fs.readFileSync(
    path.join(bootstrapDir, "addons", "helm.sh"),
    "utf8"
  );
  
  const flannelScript = fs.readFileSync(
    path.join(bootstrapDir, "addons", "flannel.sh"),
    "utf8"
  );
  
  const awsLoadBalancerControllerScript = fs.readFileSync(
    path.join(bootstrapDir, "addons", "aws-load-balancer-controller.sh"),
    "utf8"
  );

  const providerIdScript = fs.readFileSync(
    path.join(bootstrapDir, "addons", "provider-id.sh"),
    "utf8"
  );

  const entryScript = fs
    .readFileSync(path.join(bootstrapDir, entryScriptName), "utf8")
    .replace("${JOIN_PARAMETER_NAME}", clusterConfig.kubeadmJoinCommandParameterName);

  userData.addCommands(
    "set -eux",
    "mkdir -p /opt/rate-limiter/bootstrap",
    "mkdir -p /opt/rate-limiter/bootstrap/addons",
    `cat > /opt/rate-limiter/bootstrap/common.sh <<'EOF'\n${commonScript}\nEOF`,
    `cat > /opt/rate-limiter/bootstrap/${entryScriptName} <<'EOF'\n${entryScript}\nEOF`,
    `cat > /opt/rate-limiter/bootstrap/addons/helm.sh <<'EOF'\n${helmScript}\nEOF`,
    `cat > /opt/rate-limiter/bootstrap/addons/flannel.sh <<'EOF'\n${flannelScript}\nEOF`,
    `cat > /opt/rate-limiter/bootstrap/addons/aws-load-balancer-controller.sh <<'EOF'\n${awsLoadBalancerControllerScript}\nEOF`,
    `cat > /opt/rate-limiter/bootstrap/addons/provider-id.sh <<'EOF'\n${providerIdScript}\nEOF`,
    "chmod +x /opt/rate-limiter/bootstrap/*.sh",
    `bash /opt/rate-limiter/bootstrap/${entryScriptName}`
  );

  return userData;
}

export function createK8sControlPlaneUserData(): ec2.UserData {
  return createBootstrapUserData("control-plane.sh");
}

export function createK8sWorkerUserData(): ec2.UserData {
  return createBootstrapUserData("worker.sh");
}