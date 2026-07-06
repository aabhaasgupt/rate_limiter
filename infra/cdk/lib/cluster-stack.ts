import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { clusterConfig } from "../config/config";
import { createK8sNodeUserData } from "./user-data/k8s-node-user-data";

interface ClusterStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  jenkinsSecurityGroup?: ec2.ISecurityGroup;
}

export class ClusterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClusterStackProps) {
    super(scope, id, props);

    const k8sSecurityGroup = new ec2.SecurityGroup(this, "K8sNodeSecurityGroup", {
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

    const nodeRole = new iam.Role(this, "K8sNodeRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    nodeRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const ubuntu = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    );

    const createK8sNode = (name: string, instanceType: string) => {
      const instance = new ec2.Instance(this, name, {
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        instanceType: new ec2.InstanceType(instanceType),
        machineImage: ubuntu,
        securityGroup: k8sSecurityGroup,
        role: nodeRole,
        userData: createK8sNodeUserData(),
        blockDevices: [
          {
            deviceName: "/dev/sda1",
            volume: ec2.BlockDeviceVolume.ebs(clusterConfig.nodeDiskSizeGb),
          },
        ],
      });

      cdk.Tags.of(instance).add("Name", name);
      cdk.Tags.of(instance).add("Project", clusterConfig.clusterName);

      new cdk.CfnOutput(this, `${name}PublicIp`, {
        value: instance.instancePublicIp,
      });

      new cdk.CfnOutput(this, `${name}PrivateIp`, {
        value: instance.instancePrivateIp,
      });

      return instance;
    };

    createK8sNode(
      "k8s-control-plane",
      clusterConfig.controlPlaneInstanceType
    );

    for (let i = 1; i <= clusterConfig.workerCount; i++) {
      createK8sNode(`k8s-worker-${i}`, clusterConfig.workerInstanceType);
    }
  }
}