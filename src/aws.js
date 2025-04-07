const {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  waitUntilInstanceRunning,
} = require('@aws-sdk/client-ec2');

const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  if (config.input.runnerHomeDir) {
    return [
      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
      'source pre-runner-script.sh',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  }

  return [
    '#!/bin/bash',
    'mkdir actions-runner && cd actions-runner',
    `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
    'source pre-runner-script.sh',
    'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
    'curl -O -L https://github.com/actions/runner/releases/download/v2.313.0/actions-runner-linux-${RUNNER_ARCH}-2.313.0.tar.gz',
    'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.313.0.tar.gz',
    'export RUNNER_ALLOW_RUNASROOT=1',
    `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
    './run.sh',
  ];
}

function buildMarketOptions() {
  if (config.input.marketType === 'spot') {
    return {
      MarketType: config.input.marketType,
      SpotOptions: {
        SpotInstanceType: 'one-time',
      },
    };
  }

  return undefined;
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new EC2Client({});

  const userData = buildUserDataScript(githubRegistrationToken, label);
  const {
    launchTemplateName,
    launchTemplateVersion = '$Default',
  } = config.input;

  let params = {
    MinCount: 1,
    MaxCount: 1,
    TagSpecifications: config.tagSpecifications,
  };

  if (launchTemplateName) {
    params.LaunchTemplate = {
      LaunchTemplateName: launchTemplateName,
      Version: launchTemplateVersion,
    };
  } else {
    params = {
      ...params,
      ImageId: config.input.ec2ImageId,
      InstanceType: config.input.ec2InstanceType,
      UserData: Buffer.from(userData.join('\n')).toString('base64'),
      SubnetId: config.input.subnetId,
      SecurityGroupIds: [config.input.securityGroupId],
      IamInstanceProfile: { Name: config.input.iamRoleName },
      InstanceMarketOptions: buildMarketOptions(),
    };
  }

  try {
    const result = await ec2.send(new RunInstancesCommand(params));
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new EC2Client({});

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.send(new TerminateInstancesCommand(params));
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new EC2Client({});

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await waitUntilInstanceRunning(
        { client: ec2, maxWaitTime: 120 },
        params
    );

    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
