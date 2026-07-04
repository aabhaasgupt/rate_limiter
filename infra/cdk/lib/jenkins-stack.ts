import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { clusterConfig } from "../config/config";

interface JenkinsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class JenkinsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: JenkinsStackProps) {
    super(scope, id, props);

    const jenkinsSecurityGroup = new ec2.SecurityGroup(this, "JenkinsSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for Jenkins EC2",
      allowAllOutbound: true,
    });

    jenkinsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(clusterConfig.sshAllowedIp),
      ec2.Port.tcp(8080),
      "Jenkins UI from my IP"
    );

    const jenkinsRole = new iam.Role(this, "JenkinsRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    jenkinsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    const ubuntu = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    );

    const userData = ec2.UserData.forLinux();

    userData.addCommands(
      "set -eux",
      "apt-get update",
      "apt-get install -y fontconfig openjdk-21-jre wget gpg",
      "mkdir -p /etc/apt/keyrings",
      "wget -O /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key",
      "echo 'deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/' > /etc/apt/sources.list.d/jenkins.list",
      "apt-get update",
      "apt-get install -y jenkins",
      "systemctl enable jenkins",
      "systemctl start jenkins"
    );

    const instance = new ec2.Instance(this, "JenkinsInstance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType("t3.small"),
      machineImage: ubuntu,
      securityGroup: jenkinsSecurityGroup,
      role: jenkinsRole,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(20),
        },
      ],
    });

    cdk.Tags.of(instance).add("Name", "jenkins");
    cdk.Tags.of(instance).add("Project", clusterConfig.clusterName);

    new cdk.CfnOutput(this, "JenkinsPublicIp", {
      value: instance.instancePublicIp,
    });
  }
}