#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkingStack } from "../lib/networking-stack";
import { ClusterStack } from "../lib/cluster-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const networkingStack = new NetworkingStack(app, "NetworkingStack", {
  env,
});

new ClusterStack(app, "ClusterStack", {
  env,
  vpc: networkingStack.vpc,
});