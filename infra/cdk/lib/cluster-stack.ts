import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { clusterConfig } from "../config/config";
import { createK8sControlPlaneUserData, createK8sWorkerUserData } from "./user-data/bootstrap-user-data";
import * as fs from "fs";
import * as path from "path";

interface ClusterStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  jenkinsSecurityGroup?: ec2.ISecurityGroup;
}

export class ClusterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClusterStackProps) {
    super(scope, id, props);

    const controlPlaneRole = this.createNodeRole(this, "ControlPlaneRole");
    const workerRole = this.createNodeRole(this, "WorkerRole");

    controlPlaneRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:PutParameter", "ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${clusterConfig.kubeadmJoinCommandParameterName}`,
        ],
      })
    );
    
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${clusterConfig.kubeadmJoinCommandParameterName}`,
        ],
      })
    );

    const k8sSecurityGroup = this.createK8sSecurityGroup(this, "K8sNodeSecurityGroup", props);

    this.createK8sNode(this, 
      "k8s-control-plane", 
      clusterConfig.controlPlaneInstanceType, 
      controlPlaneRole, 
      k8sSecurityGroup, 
      createK8sControlPlaneUserData(), 
      props);

    for (let i = 1; i <= clusterConfig.workerCount; i++) {
      this.createK8sNode(this, 
        `k8s-worker-${i}`, 
        clusterConfig.workerInstanceType, 
        workerRole, 
        k8sSecurityGroup, 
        createK8sWorkerUserData(), 
        props);
    }
  }

  private createK8sNode(
    scope: Construct, 
    name: string, 
    instanceType: string, 
    role: iam.IRole, 
    securityGroup: ec2.ISecurityGroup,
    userData: ec2.UserData,
    props: ClusterStackProps) {
    const ubuntu = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    );
    
    const instance = new ec2.Instance(scope, name, {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: ubuntu,
      securityGroup: securityGroup,
      role: role,
      userData: userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(clusterConfig.nodeDiskSizeGb),
        },
      ],
    });

    cdk.Tags.of(instance).add("Name", name);
    cdk.Tags.of(instance).add("Project", clusterConfig.clusterName);

    new cdk.CfnOutput(scope, `${name}PublicIp`, {
      value: instance.instancePublicIp,
    });

    new cdk.CfnOutput(scope, `${name}PrivateIp`, {
      value: instance.instancePrivateIp,
    });

    return instance;
  };

  private createK8sSecurityGroup(scope: Construct, id: string, props: ClusterStackProps) {
    const k8sSecurityGroup = new ec2.SecurityGroup(scope, id, {
      vpc: props.vpc,
      description: "Security group for self-managed Kubernetes nodes",
      allowAllOutbound: true,
    });

    k8sSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(clusterConfig.sshAllowedIp),
      ec2.Port.tcp(22),
      "SSH from my IP"
    );

    k8sSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(clusterConfig.sshAllowedIp),
      ec2.Port.tcp(6443),
      "Kubernetes API from my IP"
    );

    k8sSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(clusterConfig.sshAllowedIp),
      ec2.Port.tcpRange(30000, 32767),
      "NodePort access from my IP"
    );

    k8sSecurityGroup.addIngressRule(
      k8sSecurityGroup,
      ec2.Port.allTraffic(),
      "Allow all traffic between Kubernetes nodes"
    );

    if (props.jenkinsSecurityGroup) {
      k8sSecurityGroup.addIngressRule(
        props.jenkinsSecurityGroup,
        ec2.Port.tcp(6443),
        "Allow Jenkins to access Kubernetes API server"
      );
    }

    return k8sSecurityGroup;
  }

  private createNodeRole(scope: Construct, id: string, policies?: Record<string, iam.PolicyDocument>[]) {
    const role = new iam.Role(scope, id, {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
  
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const lbControllerPolicyJson = this.getALBPolicyFromJson("../config/aws-load-balancer-controller-policy.json");
    role.attachInlinePolicy(
      new iam.Policy(scope, `AwsALBControllerPolicyFor${id}`, {
        document: iam.PolicyDocument.fromJson(lbControllerPolicyJson),
      })
    );

    return role;
  }

  private getALBPolicyFromJson(pathToJson: string) {
    return JSON.parse(
      fs.readFileSync(
        path.join(__dirname, pathToJson),
        "utf8"
      )
    );
  }
}