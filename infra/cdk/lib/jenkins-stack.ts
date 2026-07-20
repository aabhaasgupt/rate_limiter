import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { clusterConfig } from "../config/config";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as fs from "fs";
import * as path from "path";
import { jenkinsConfig } from "../config/config"

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
          `arn:aws:ssm:${this.region}:${this.account}:parameter/rate-limiter/jenkins/*`,
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

    const initGroovyPath = path.join(__dirname, "../../jenkins/init.groovy");

    const initGroovy = fs.readFileSync(initGroovyPath, "utf8");

    const userData = ec2.UserData.forLinux();
    
    // ## TODO: CDK cleanup

    // - Move Jenkins Docker installation into Jenkins EC2 User Data.
    // - Move Jenkins kubectl installation into Jenkins EC2 User Data.
    // - Add CDK security group rule:
    //   - JenkinsSecurityGroup → K8sNodeSecurityGroup on TCP 6443
    // - Avoid manual AWS Console changes.
    userData.addCommands(
      "set -eux",
    
      // Java + basics
      "apt-get update",
      "apt-get install -y fontconfig openjdk-21-jre wget gpg unzip curl",
    
      // Jenkins repo + install
      "mkdir -p /etc/apt/keyrings",
      "wget -O /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key",
      "echo 'deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/' > /etc/apt/sources.list.d/jenkins.list",
      "apt-get update",
      "apt-get install -y jenkins",
      "systemctl enable jenkins",
    
      // Jenkins plugins
      "mkdir -p /var/lib/jenkins/plugins",
      "curl -L https://github.com/jenkinsci/plugin-installation-manager-tool/releases/download/2.13.2/jenkins-plugin-manager-2.13.2.jar -o /tmp/jenkins-plugin-manager.jar",
      "cat >/tmp/plugins.txt <<'PLUGINS_EOF'\ncredentials\nworkflow-aggregator\ngit\ndocker-workflow\ngithub\ngithub-branch-source\nPLUGINS_EOF",
      "java -jar /tmp/jenkins-plugin-manager.jar --war /usr/share/java/jenkins.war --plugin-file /tmp/plugins.txt --plugin-download-directory /var/lib/jenkins/plugins",
      "chown -R jenkins:jenkins /var/lib/jenkins/plugins",
    
      // Docker + Git
      "apt-get install -y docker.io git",
      "systemctl enable docker",
      "systemctl start docker",
      "usermod -aG docker jenkins",
    
      // kubectl
      "curl -LO https://dl.k8s.io/release/v1.31.14/bin/linux/amd64/kubectl",
      "install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl",
      "rm kubectl",
    
      // AWS CLI
      "curl 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o '/tmp/awscliv2.zip'",
      "unzip -q /tmp/awscliv2.zip -d /tmp",
      "/tmp/aws/install",
    
      // Kubernetes config for Jenkins
      "mkdir -p /var/lib/jenkins/.kube",
      `until aws s3 cp s3://${clusterConfig.bootstrapBucketName}/kubeconfig/admin.conf /var/lib/jenkins/.kube/config; do echo 'Waiting for kubeconfig...'; sleep 10; done`,
      "chown -R jenkins:jenkins /var/lib/jenkins/.kube",
    
      // DockerHub secrets
      "aws ssm get-parameter --name '/rate-limiter/jenkins/dockerhub-username' --with-decryption --query 'Parameter.Value' --output text > /tmp/dockerhub-user",
      "aws ssm get-parameter --name '/rate-limiter/jenkins/dockerhub-token' --with-decryption --query 'Parameter.Value' --output text > /tmp/dockerhub-token",
    
      // Groovy init script
      "mkdir -p /var/lib/jenkins/init.groovy.d",
      `cat >/var/lib/jenkins/init.groovy.d/init.groovy <<'JENKINS_INIT_EOF'\n${initGroovy}\nJENKINS_INIT_EOF`,
      "chown -R jenkins:jenkins /var/lib/jenkins/init.groovy.d",
    
      // Override the Jenkins to skip first time auth and plugin setup from UI
      "mkdir -p /etc/systemd/system/jenkins.service.d",
      "cat >/etc/systemd/system/jenkins.service.d/override.conf <<'EOF'\n[Service]\nEnvironment=\"JAVA_OPTS=-Djenkins.install.runSetupWizard=false\"\nEOF",
      "systemctl daemon-reload",

      // Start Jenkins and restart once for plugin/init reliability
      "systemctl start jenkins",
      "sleep 30",
      "systemctl restart jenkins",
      "sleep 30",
    
      // Verify Kubernetes access
      "sudo -u jenkins KUBECONFIG=/var/lib/jenkins/.kube/config kubectl get nodes"
    );

    const instance = new ec2.Instance(this, "JenkinsInstance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(jenkinsConfig.jenkinsWorkerInstanceType),
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