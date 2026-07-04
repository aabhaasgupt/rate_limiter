import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from "aws-cdk-lib/aws-ec2";

// import * as sqs from 'aws-cdk-lib/aws-sqs';


export class NetworkingStack extends cdk.Stack {
  public vpc: ec2.IVpc;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", {
      isDefault: true,
    });
  }
}
