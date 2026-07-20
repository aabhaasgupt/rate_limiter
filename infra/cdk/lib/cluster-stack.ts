import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as fs from "fs";
import * as path from "path";
import * as s3 from "aws-cdk-lib/aws-s3";

import { clusterConfig, redisConfig } from "../config/config";
import {
  createK8sControlPlaneUserData,
  createK8sWorkerUserData,
} from "./user-data/bootstrap-user-data";

interface WorkerAutoScalingGroupConfig {
  idPrefix: string;
  instanceType: string;
  minCapacity: number;
  desiredCapacity: number;
  maxCapacity: number;
  instanceName: string;
  outputName: string;
}

interface ClusterStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  jenkinsSecurityGroup?: ec2.ISecurityGroup;
  bootstrapBucket?: s3.Bucket;
}

export class ClusterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClusterStackProps) {
    super(scope, id, props);

    const controlPlaneRole = this.createNodeRole(
      this,
      "ControlPlaneRole"
    );

    const workerRole = this.createNodeRole(
      this,
      "WorkerRole"
    );

    /*
     * The control plane uploads the kubeconfig to S3 so Jenkins can
     * download it during bootstrap.
     */
    props.bootstrapBucket?.grantReadWrite(controlPlaneRole);

    /*
     * Control plane permissions:
     * - publish the worker join command
     * - overwrite/delete stale join commands during a rebuild
     */
    controlPlaneRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ssm:PutParameter",
          "ssm:GetParameter",
          "ssm:DeleteParameter",
        ],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${clusterConfig.kubeadmJoinCommandParameterName}`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter${clusterConfig.kubeconfigParameterName}`,
        ],
      })
    );

    /*
     * Workers read the kubeadm join command from Parameter Store.
     */
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${clusterConfig.kubeadmJoinCommandParameterName}`,
        ],
      })
    );

    const k8sSecurityGroup = this.createK8sSecurityGroup(
      this,
      "K8sNodeSecurityGroup",
      props
    );

    /*
     * Keep the control plane as a standalone EC2 instance.
     */
    this.createK8sNode(
      this,
      "k8s-control-plane",
      clusterConfig.controlPlaneInstanceType,
      controlPlaneRole,
      k8sSecurityGroup,
      createK8sControlPlaneUserData(),
      props
    );

    /*
     * Workers are now managed by an Auto Scaling Group.
     */

    this.createWorkerAutoScalingGroup(
      {
        idPrefix: "K8sAppWorker",
        instanceType: clusterConfig.workerInstanceType,
        minCapacity: clusterConfig.minCapacity,
        desiredCapacity: clusterConfig.desiredCapacity,
        maxCapacity: clusterConfig.maxCapacity,
        instanceName: "k8s-app-worker",
        outputName: "K8sAppWorkerAutoScalingGroupName",
      },
      workerRole,
      k8sSecurityGroup,
      props
    );
    
    this.createWorkerAutoScalingGroup(
      {
        idPrefix: "K8sRedisWorker",
        instanceType: redisConfig.redisWorkerInstanceType,
        minCapacity: redisConfig.redisMinCapacity,
        desiredCapacity: redisConfig.redisDesiredCapacity,
        maxCapacity: redisConfig.redisMaxCapacity,
        instanceName: "k8s-redis-worker",
        outputName: "K8sRedisWorkerAutoScalingGroupName",
      },
      workerRole,
      k8sSecurityGroup,
      props
    );
  }

  private createWorkerAutoScalingGroup(
    config: WorkerAutoScalingGroupConfig,
    workerRole: iam.IRole,
    securityGroup: ec2.ISecurityGroup,
    props: ClusterStackProps
  ): autoscaling.AutoScalingGroup {
    const ubuntu = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    );

    const workerLaunchTemplate = new ec2.LaunchTemplate(
      this,
      `${config.idPrefix}LaunchTemplate`,
      {
        machineImage: ubuntu,

        instanceType: new ec2.InstanceType(
          config.instanceType
        ),

        securityGroup,

        role: workerRole,

        userData: createK8sWorkerUserData(),

        blockDevices: [
          {
            deviceName: "/dev/sda1",
            volume: ec2.BlockDeviceVolume.ebs(
              clusterConfig.nodeDiskSizeGb,
              {
                volumeType: ec2.EbsDeviceVolumeType.GP3,
                deleteOnTermination: true,
              }
            ),
          },
        ],

        /*
         * Require IMDSv2 for instance metadata access.
         */
        requireImdsv2: true,
      }
    );

    const workerAsg = new autoscaling.AutoScalingGroup(
      this,
      `${config.idPrefix}AutoScalingGroup`,
      {
        vpc: props.vpc,

        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },

        launchTemplate: workerLaunchTemplate,

        /*
         * Keep cost low while learning.
         *
         * One worker normally runs. We can manually scale to two
         * to validate replacement and scale-out behavior.
         */
        minCapacity: config.minCapacity,
        desiredCapacity: config.desiredCapacity,
        maxCapacity: config.maxCapacity,

        healthCheck: autoscaling.HealthCheck.ec2({
          grace: cdk.Duration.minutes(10),
        }),

        /*
         * Prevent CDK from unexpectedly resetting manually changed
         * desired capacity during later deployments.
         */
        ignoreUnmodifiedSizeProperties: true,
      }
    );

    cdk.Tags.of(workerLaunchTemplate).add(
      "Project",
      clusterConfig.clusterName
    );

    cdk.Tags.of(workerAsg).add(
      "Name",
      config.instanceName
    );

    cdk.Tags.of(workerAsg).add(
      "Project",
      clusterConfig.clusterName
    );

    new cdk.CfnOutput(
      this,
      config.outputName,
      {
        value: workerAsg.autoScalingGroupName,
      }
    );

    return workerAsg;
  }

  private createK8sNode(
    scope: Construct,
    name: string,
    instanceType: string,
    role: iam.IRole,
    securityGroup: ec2.ISecurityGroup,
    userData: ec2.UserData,
    props: ClusterStackProps
  ): ec2.Instance {
    const ubuntu = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    );

    const instance = new ec2.Instance(scope, name, {
      vpc: props.vpc,

      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },

      instanceType: new ec2.InstanceType(instanceType),

      machineImage: ubuntu,

      securityGroup,

      role,

      userData,

      requireImdsv2: true,

      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(
            clusterConfig.nodeDiskSizeGb,
            {
              volumeType: ec2.EbsDeviceVolumeType.GP3,
              deleteOnTermination: true,
            }
          ),
        },
      ],
    });

    cdk.Tags.of(instance).add("Name", name);
    cdk.Tags.of(instance).add(
      "Project",
      clusterConfig.clusterName
    );

    new cdk.CfnOutput(scope, `${name}PublicIp`, {
      value: instance.instancePublicIp,
    });

    new cdk.CfnOutput(scope, `${name}PrivateIp`, {
      value: instance.instancePrivateIp,
    });

    return instance;
  }

  private createK8sSecurityGroup(
    scope: Construct,
    id: string,
    props: ClusterStackProps
  ): ec2.SecurityGroup {
    const k8sSecurityGroup = new ec2.SecurityGroup(
      scope,
      id,
      {
        vpc: props.vpc,
        description:
          "Security group for self-managed Kubernetes nodes",
        allowAllOutbound: true,
      }
    );

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

    /*
     * Control-plane and worker nodes need to communicate freely
     * with one another for Kubernetes networking and cluster traffic.
     */
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

  private createNodeRole(
    scope: Construct,
    id: string
  ): iam.Role {
    const role = new iam.Role(scope, id, {
      assumedBy: new iam.ServicePrincipal(
        "ec2.amazonaws.com"
      ),
    });

    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonSSMManagedInstanceCore"
      )
    );

    const lbControllerPolicyJson =
      this.getALBPolicyFromJson(
        "../config/aws-load-balancer-controller-policy.json"
      );

    role.attachInlinePolicy(
      new iam.Policy(
        scope,
        `AwsALBControllerPolicyFor${id}`,
        {
          document: iam.PolicyDocument.fromJson(
            lbControllerPolicyJson
          ),
        }
      )
    );

    return role;
  }

  private getALBPolicyFromJson(
    pathToJson: string
  ): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(
        path.join(__dirname, pathToJson),
        "utf8"
      )
    );
  }
}