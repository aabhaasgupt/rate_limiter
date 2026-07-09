import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { clusterConfig } from "../config/config";
import * as s3 from "aws-cdk-lib/aws-s3";

interface JenkinsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class JenkinsStack extends cdk.Stack {
  public readonly jenkinsSecurityGroup: ec2.ISecurityGroup;
  public readonly bootstrapBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: JenkinsStackProps) {
    super(scope, id, props);

    this.jenkinsSecurityGroup = new ec2.SecurityGroup(this, "JenkinsSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for Jenkins EC2",
      allowAllOutbound: true,
    });

    if (clusterConfig.allowGithubWebhook) {
        this.jenkinsSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(8080),
            "Temporary GitHub webhook access"
        );
    } else {
        this.jenkinsSecurityGroup.addIngressRule(
            ec2.Peer.ipv4(clusterConfig.sshAllowedIp),
            ec2.Port.tcp(8080),
            "Jenkins UI"
        );
    }

    const jenkinsRole = new iam.Role(this, "JenkinsRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    jenkinsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    jenkinsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${clusterConfig.kubeconfigParameterName}`,
        ],
      })
    );

    jenkinsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ec2:DescribeInstances"],
        resources: ["*"],
      })
    );
    
    this.bootstrapBucket = new s3.Bucket(this, "BootstrapBucket", {
      bucketName: clusterConfig.bootstrapBucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    this.bootstrapBucket.grantRead(jenkinsRole)

    const ubuntu = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    );

    const userData = ec2.UserData.forLinux();
    
    // ## TODO: CDK cleanup

    // - Move Jenkins Docker installation into Jenkins EC2 User Data.
    // - Move Jenkins kubectl installation into Jenkins EC2 User Data.
    // - Add CDK security group rule:
    //   - JenkinsSecurityGroup → K8sNodeSecurityGroup on TCP 6443
    // - Avoid manual AWS Console changes.
    userData.addCommands(
      "set -eux",
    
      // Install Java
      "apt-get update",
      "apt-get install -y fontconfig openjdk-21-jre wget gpg",
    
      // Install Jenkins
      "mkdir -p /etc/apt/keyrings",
      "wget -O /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key",
      "echo 'deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/' > /etc/apt/sources.list.d/jenkins.list",
      "apt-get update",
      "apt-get install -y jenkins",
      "systemctl enable jenkins",
      "systemctl start jenkins",
    
      // Docker
      "apt-get install -y docker.io git",
      "systemctl enable docker",
      "systemctl start docker",
      "usermod -aG docker jenkins",
    
      // kubectl
      "curl -LO https://dl.k8s.io/release/v1.31.14/bin/linux/amd64/kubectl",
      "install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl",
      "rm kubectl",
    
      // AWS CLI
      "apt-get install -y unzip curl",
      "curl 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o '/tmp/awscliv2.zip'",
      "unzip -q /tmp/awscliv2.zip -d /tmp",
      "/tmp/aws/install",
    
      // Configure kubectl for Jenkins
      "mkdir -p /var/lib/jenkins/.kube",
    
      `until aws s3 cp s3://${clusterConfig.bootstrapBucketName}/kubeconfig/admin.conf /var/lib/jenkins/.kube/config; do echo 'Waiting for kubeconfig...'; sleep 10; done`,
    
      "chown -R jenkins:jenkins /var/lib/jenkins/.kube",
    
      "sudo -u jenkins KUBECONFIG=/var/lib/jenkins/.kube/config kubectl get nodes"
    );

    const instance = new ec2.Instance(this, "JenkinsInstance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType("t3.small"),
      machineImage: ubuntu,
      securityGroup: this.jenkinsSecurityGroup,
      role: jenkinsRole,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(20),
        },
      ],
    });

    const elasticIp = new ec2.CfnEIP(this, "JenkinsElasticIp", {
        domain: "vpc",
        tags: [
          {
            key: "Name",
            value: "jenkins-eip",
          },
          {
            key: "Project",
            value: clusterConfig.clusterName,
          },
        ],
      });
      
    new ec2.CfnEIPAssociation(this, "JenkinsElasticIpAssociation", {
        eip: elasticIp.ref,
        instanceId: instance.instanceId,
    });

    cdk.Tags.of(instance).add("Name", "jenkins");
    cdk.Tags.of(instance).add("Project", clusterConfig.clusterName);

    new cdk.CfnOutput(this, "JenkinsPublicIpOutput", {
      value: instance.instancePublicIp,
    });

    new cdk.CfnOutput(this, "JenkinsElasticIpOutput", {
      value: elasticIp.ref,
    });
  }
}